-- Server-mediated, short-lived maintenance. No tokens or credentials in this table.
create table public.admin_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_auth_session_id uuid not null,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  target_auth_session_id uuid not null unique,
  reason text not null check (char_length(btrim(reason)) between 8 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (actor_profile_id <> target_profile_id),
  check (expires_at > created_at and expires_at <= created_at + interval '16 minutes'),
  check (ended_at is null or ended_at >= created_at)
);
create index admin_impersonation_actor_time_idx on public.admin_impersonation_sessions(actor_profile_id, created_at desc);
create index admin_impersonation_target_time_idx on public.admin_impersonation_sessions(target_profile_id, created_at desc);
alter table public.admin_impersonation_sessions enable row level security;
revoke all on public.admin_impersonation_sessions from public, anon, authenticated, service_role;
grant select, insert, update on public.admin_impersonation_sessions to service_role;

alter table public.audit_logs
  add column delegated_by_profile_id uuid references public.profiles(id) on delete set null,
  add column impersonation_session_id uuid references public.admin_impersonation_sessions(id) on delete restrict;
create index audit_logs_impersonation_idx on public.audit_logs(impersonation_session_id, occurred_at desc) where impersonation_session_id is not null;
create index if not exists audit_logs_actor_time_idx on public.audit_logs(actor_profile_id, occurred_at desc);

create function public.impersonation_participants_allowed(p_actor uuid, p_target uuid, p_actor_session uuid, p_target_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor <> p_target
    and exists (
      select 1 from public.admin_users a
      join public.admin_roles r on r.id = a.role_id and r.role_key = 'super_admin'
      join public.profiles p on p.id = a.profile_id and p.is_active and not p.must_change_password
      join public.user_roles u on u.profile_id = p.id and u.role = 'admin' and u.revoked_at is null
      where a.profile_id = p_actor and a.is_active
    )
    and exists(select 1 from auth.sessions s where s.id = p_actor_session and s.user_id = p_actor)
    and exists(select 1 from auth.sessions s where s.id = p_target_session and s.user_id = p_target)
    and exists(select 1 from public.profiles p where p.id = p_target and p.is_active and not p.must_change_password and p.role <> 'admin')
    and exists(select 1 from public.user_roles u where u.profile_id = p_target and u.revoked_at is null and u.is_primary and u.role <> 'admin')
    and not exists(select 1 from public.user_roles u where u.profile_id = p_target and u.role = 'admin' and u.revoked_at is null)
    and not exists(select 1 from public.admin_users a where a.profile_id = p_target and a.is_active)
$$;
revoke all on function public.impersonation_participants_allowed(uuid,uuid,uuid,uuid) from public, anon, authenticated;

create function public.validate_admin_impersonation(p_id uuid, p_actor uuid, p_actor_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_impersonation_sessions s
    where s.id = p_id and s.actor_profile_id = p_actor and s.actor_auth_session_id = p_actor_session
      and s.ended_at is null and s.expires_at > now()
      and public.impersonation_participants_allowed(s.actor_profile_id,s.target_profile_id,s.actor_auth_session_id,s.target_auth_session_id))
$$;
revoke all on function public.validate_admin_impersonation(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.validate_admin_impersonation(uuid,uuid,uuid) to service_role;

create function public.guard_impersonation_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not public.impersonation_participants_allowed(new.actor_profile_id,new.target_profile_id,new.actor_auth_session_id,new.target_auth_session_id) then
      raise exception 'Maintenance participants are not authorized' using errcode='42501';
    end if;
    -- Serialize starts by operator, preventing parallel/nested grants.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.actor_profile_id::text, 83));
    if exists(select 1 from public.admin_impersonation_sessions s where s.actor_profile_id=new.actor_profile_id and s.ended_at is null and s.expires_at>now()) then
      raise exception 'A maintenance session is already active' using errcode='42501';
    end if;
  elsif (to_jsonb(new) - 'ended_at') is distinct from (to_jsonb(old) - 'ended_at') or old.ended_at is not null or new.ended_at is null then
    raise exception 'Maintenance authorization is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_impersonation_session() from public, anon, authenticated;
create trigger guard_impersonation_session before insert or update on public.admin_impersonation_sessions for each row execute function public.guard_impersonation_session();

create function public.current_impersonation_session()
returns public.admin_impersonation_sessions language plpgsql stable security definer set search_path = '' as $$
declare v_session public.admin_impersonation_sessions; v_id text; v_jwt jsonb := auth.jwt();
begin
  if v_jwt->>'role' = 'service_role' then
    v_id := nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-bunya-impersonation';
    if v_id is not null then select * into v_session from public.admin_impersonation_sessions where id=v_id::uuid; end if;
    if v_id is not null and v_session.id is null then raise exception 'Unknown maintenance session' using errcode='42501'; end if;
  else
    select * into v_session from public.admin_impersonation_sessions where target_auth_session_id=nullif(v_jwt->>'session_id','')::uuid;
    if v_session.id is not null and auth.uid() is distinct from v_session.target_profile_id then raise exception 'Invalid maintenance identity' using errcode='42501'; end if;
  end if;
  if v_session.id is not null and not public.validate_admin_impersonation(v_session.id,v_session.actor_profile_id,v_session.actor_auth_session_id) then
    raise exception 'Maintenance session expired or revoked' using errcode='42501';
  end if;
  return v_session;
end;
$$;
revoke all on function public.current_impersonation_session() from public, anon, authenticated;

create function public.attribute_impersonation_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.admin_impersonation_sessions;
begin
  -- Lifecycle events are inserted only by the private table's trigger and retain provenance after expiry.
  if new.entity_table='admin_impersonation_sessions' and new.action in ('maintenance_started','maintenance_ended') then return new; end if;
  s := public.current_impersonation_session();
  if s.id is not null then
    new.actor_profile_id := s.target_profile_id;
    new.delegated_by_profile_id := s.actor_profile_id;
    new.impersonation_session_id := s.id;
    new.reason := coalesce(new.reason,s.reason);
  end if;
  return new;
end;
$$;
revoke all on function public.attribute_impersonation_audit() from public, anon, authenticated;
create trigger attribute_impersonation_audit before insert on public.audit_logs for each row execute function public.attribute_impersonation_audit();

create function public.audit_impersonation_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_profile_id,delegated_by_profile_id,impersonation_session_id,entity_table,entity_id,action,reason,sensitivity)
  values(new.target_profile_id,new.actor_profile_id,new.id,'admin_impersonation_sessions',new.id::text,
    case when tg_op='INSERT' then 'maintenance_started' else 'maintenance_ended' end,new.reason,'critical');
  return new;
end;
$$;
revoke all on function public.audit_impersonation_lifecycle() from public, anon, authenticated;
create trigger audit_impersonation_lifecycle after insert or update on public.admin_impersonation_sessions for each row execute function public.audit_impersonation_lifecycle();

-- Cover delegated writes even on tables without an existing audit trigger. No payloads,
-- document contents, passwords or tokens are copied into these supplementary events.
create function public.audit_delegated_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.admin_impersonation_sessions; v_row jsonb;
begin
  s := public.current_impersonation_session();
  if s.id is not null then
    v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action)
    values(s.target_profile_id,tg_table_name,coalesce(v_row->>'id',v_row->>'profile_id',v_row->>'provider_id','record'),lower(tg_op));
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_delegated_change() from public, anon, authenticated;
do $$ declare t record; e record; events text[]; begin
  for t in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname not in ('audit_logs','admin_impersonation_sessions')
  loop
    events := array[]::text[];
    for e in select * from (values ('insert',4),('update',16),('delete',8)) v(event_name,event_flag) loop
      if not exists(select 1 from pg_trigger tr join pg_proc p on p.oid=tr.tgfoid
        where tr.tgrelid=t.oid and not tr.tgisinternal and tr.tgenabled in ('O','A')
          and p.proname='audit_sensitive_row' and (tr.tgtype::int & e.event_flag) <> 0) then
        events := array_append(events,e.event_name);
      end if;
    end loop;
    if cardinality(events)>0 then
      execute format('create trigger audit_delegated_change after %s on public.%I for each row execute function public.audit_delegated_change()',array_to_string(events,' or '),t.relname);
    end if;
  end loop;
end $$;
