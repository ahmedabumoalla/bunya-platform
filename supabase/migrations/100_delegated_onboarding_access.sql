-- One-use, server-created authorization for a specific Auth token issuance.
-- Pending/expired onboarding credentials remain blocked for ordinary sessions.
create table private.admin_impersonation_mint_requests (
  id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_auth_session_id uuid not null,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  nonce_hash text not null unique check (nonce_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '90 seconds',
  consumed_session_id uuid unique,
  consumed_at timestamptz,
  check (actor_profile_id <> target_profile_id),
  check (expires_at > created_at and expires_at <= created_at + interval '90 seconds'),
  check ((consumed_session_id is null) = (consumed_at is null))
);
create index admin_impersonation_mint_actor_idx on private.admin_impersonation_mint_requests(actor_profile_id, expires_at);
alter table private.admin_impersonation_mint_requests enable row level security;
revoke all on private.admin_impersonation_mint_requests from public, anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema private to service_role, supabase_auth_admin;
grant select, delete on private.admin_impersonation_mint_requests to service_role;

-- Only the target's pending-password guard is relaxed, within delegated access.
-- The original operator must still be the active, fully onboarded Ahmed account.
create or replace function private.admin_impersonation_target_allowed(p_actor uuid, p_actor_session uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_actor = '8b9f3886-e1b8-4816-9fbb-d425b0753255'::uuid and p_actor <> p_target
    and exists (
      select 1 from public.admin_users a
      join public.admin_roles r on r.id = a.role_id and r.role_key = 'super_admin'
      join public.profiles p on p.id = a.profile_id and p.is_active and not p.must_change_password
      join public.user_roles u on u.profile_id = p.id and u.role = 'admin' and u.revoked_at is null
      where a.profile_id = p_actor and a.is_active
    )
    and exists(select 1 from auth.sessions s where s.id = p_actor_session and s.user_id = p_actor)
    and exists(select 1 from public.profiles p where p.id = p_target and p.is_active)
    and exists (
      select 1 from public.user_roles u
      where u.profile_id = p_target and u.revoked_at is null and u.is_primary
        and (u.role <> 'admin' or exists(select 1 from public.admin_users a where a.profile_id = p_target and a.is_active))
    ), false)
$$;
revoke all on function private.admin_impersonation_target_allowed(uuid,uuid,uuid) from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.impersonation_participants_allowed(p_actor uuid, p_target uuid, p_actor_session uuid, p_target_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.admin_impersonation_target_allowed(p_actor, p_actor_session, p_target)
    and exists(select 1 from auth.sessions s where s.id = p_target_session and s.user_id = p_target)
$$;
revoke all on function public.impersonation_participants_allowed(uuid,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.prepare_admin_impersonation(p_id uuid, p_actor uuid, p_actor_session uuid, p_target uuid, p_nonce_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or not private.admin_impersonation_target_allowed(p_actor, p_actor_session, p_target) then
    raise exception 'Maintenance participants are not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text, 83));
  if exists(select 1 from public.admin_impersonation_sessions s where s.actor_profile_id = p_actor and s.ended_at is null and s.expires_at > statement_timestamp()) then
    raise exception 'A maintenance session is already active' using errcode = '42501';
  end if;
  delete from private.admin_impersonation_mint_requests where actor_profile_id = p_actor and expires_at <= statement_timestamp();
  if exists(select 1 from private.admin_impersonation_mint_requests r where r.actor_profile_id = p_actor and r.consumed_at is null and r.expires_at > statement_timestamp()) then
    raise exception 'Maintenance token preparation is already active' using errcode = '42501';
  end if;
  insert into private.admin_impersonation_mint_requests(id,actor_profile_id,actor_auth_session_id,target_profile_id,nonce_hash)
  values(p_id,p_actor,p_actor_session,p_target,p_nonce_hash);
end;
$$;
revoke all on function public.prepare_admin_impersonation(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.prepare_admin_impersonation(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.cancel_admin_impersonation_prepare(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.admin_impersonation_mint_requests where id = p_id
$$;
revoke all on function public.cancel_admin_impersonation_prepare(uuid) from public, anon, authenticated;
grant execute on function public.cancel_admin_impersonation_prepare(uuid) to service_role;

-- Auth creates its session before invoking this hook in the same transaction.
-- The server supplies a random nonce only in verifyOtp's User-Agent; neither
-- editable user metadata nor a target-wide time window can authorize a bypass.
create or replace function private.consume_admin_impersonation_mint(event jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (event->>'user_id')::uuid;
  v_session_id uuid := nullif(event->'claims'->>'session_id','')::uuid;
  v_agent text;
  v_request private.admin_impersonation_mint_requests;
  v_exp bigint;
begin
  if v_session_id is null then return null; end if;
  -- Never refresh or re-mint a maintenance session, even after onboarding ends.
  if exists(select 1 from public.admin_impersonation_sessions where target_auth_session_id = v_session_id) then
    raise exception 'Maintenance sessions cannot issue additional tokens' using errcode = '42501';
  end if;
  if coalesce(event->>'authentication_method','') not in ('otp','magiclink') then return null; end if;
  select s.user_agent into v_agent from auth.sessions s where s.id = v_session_id and s.user_id = v_user_id;
  if v_agent is null or v_agent !~ '^bunya-maintenance/[a-f0-9]{64}$' then return null; end if;
  select * into v_request from private.admin_impersonation_mint_requests
    where nonce_hash = encode(sha256(convert_to(substr(v_agent,19),'UTF8')),'hex');
  if not found then return null; end if;

  -- Use the same lock order as preparation and the existing grant guard.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_request.actor_profile_id::text,83));
  select * into v_request from private.admin_impersonation_mint_requests where id = v_request.id for update;
  if not found or v_request.consumed_at is not null or v_request.expires_at <= statement_timestamp()
     or v_request.target_profile_id is distinct from v_user_id
     or not private.admin_impersonation_target_allowed(v_request.actor_profile_id,v_request.actor_auth_session_id,v_user_id) then
    raise exception 'Maintenance token preparation is invalid or expired' using errcode = '42501';
  end if;
  v_exp := least((event->'claims'->>'exp')::bigint, floor(extract(epoch from statement_timestamp()))::bigint + 900);
  if v_exp is null or v_exp <= extract(epoch from statement_timestamp()) then
    raise exception 'Maintenance token expiry is invalid' using errcode = '42501';
  end if;
  update private.admin_impersonation_mint_requests set consumed_session_id = v_session_id, consumed_at = statement_timestamp() where id = v_request.id;
  insert into public.admin_impersonation_sessions(id,actor_profile_id,actor_auth_session_id,target_profile_id,target_auth_session_id,reason,created_at,expires_at)
  values(v_request.id,v_request.actor_profile_id,v_request.actor_auth_session_id,v_user_id,v_session_id,'دخول إداري بالنيابة',statement_timestamp(),to_timestamp(v_exp));
  return v_exp;
end;
$$;
revoke all on function private.consume_admin_impersonation_mint(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.consume_admin_impersonation_mint(jsonb) to supabase_auth_admin;

-- Preserve migration089's normal-login expiry enforcement and claim handling.
-- Only the one exact Auth session just bound to an audited grant is exempt.
create or replace function public.onboarding_access_token_hook(event jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare p record; v_claims jsonb := event->'claims'; v_user_id uuid := (event->>'user_id')::uuid; v_exp bigint;
begin
  v_exp := private.consume_admin_impersonation_mint(event);
  if v_exp is not null then
    return jsonb_build_object('claims',jsonb_set(v_claims,'{exp}',to_jsonb(v_exp)));
  end if;
  select role,must_change_password,temporary_password_expires_at into p from public.profiles where id = v_user_id;
  if found and p.role in ('provider','contractor') and p.must_change_password then
    if p.temporary_password_expires_at is null or p.temporary_password_expires_at <= statement_timestamp() then
      return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','انتهت صلاحية كلمة المرور المؤقتة. اطلب من الإدارة إعادة إرسال بيانات الدخول.'));
    end if;
    v_exp := floor(extract(epoch from p.temporary_password_expires_at))::bigint;
    if (v_claims->>'exp')::bigint > v_exp then v_claims := jsonb_set(v_claims,'{exp}',to_jsonb(v_exp)); end if;
  end if;
  return jsonb_build_object('claims',v_claims);
end;
$$;
revoke all on function public.onboarding_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.onboarding_access_token_hook(jsonb) to supabase_auth_admin;
