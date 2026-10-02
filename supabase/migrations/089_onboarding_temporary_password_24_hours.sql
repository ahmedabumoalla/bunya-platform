begin;

-- Only a one-way fingerprint is retained, never the password or Auth's bcrypt
-- hash. This prevents completing onboarding without changing the Auth password.
create table public.onboarding_password_fingerprints (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  password_fingerprint text not null check(password_fingerprint ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null
);
alter table public.onboarding_password_fingerprints enable row level security;
revoke all on public.onboarding_password_fingerprints from public,anon,authenticated;
grant select,insert,update,delete on public.onboarding_password_fingerprints to service_role;

-- Existing pending credentials are never renewed or extended by this migration.
-- Their original issue time remains authoritative; no Auth password is changed.
insert into public.onboarding_password_fingerprints(profile_id,password_fingerprint,issued_at)
select p.id,encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex'),p.temporary_password_issued_at
from public.profiles p join auth.users u on u.id=p.id
where p.role in ('provider','contractor') and p.must_change_password
  and p.temporary_password_issued_at is not null and nullif(u.encrypted_password,'') is not null;
update public.profiles set temporary_password_expires_at=least(temporary_password_expires_at,temporary_password_issued_at+interval '24 hours')
where role in ('provider','contractor') and must_change_password and temporary_password_issued_at is not null;

create or replace function public.guard_onboarding_password_metadata()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_scoped boolean; v_issued boolean;
begin
  v_scoped:=coalesce(new.role in ('provider','contractor'),false);
  if tg_op='INSERT' then
    if v_scoped and new.must_change_password and current_user not in ('postgres','service_role') then
      raise exception 'Temporary password metadata requires server workflow' using errcode='42501';
    end if;
    v_issued:=new.must_change_password;
  else
    if (v_scoped or old.role in ('provider','contractor'))
      and (new.must_change_password,new.temporary_password_issued_at,new.temporary_password_expires_at,new.password_changed_at)
        is distinct from (old.must_change_password,old.temporary_password_issued_at,old.temporary_password_expires_at,old.password_changed_at)
      and current_user not in ('postgres','service_role') then
      raise exception 'Temporary password metadata requires server workflow' using errcode='42501';
    end if;
    v_issued:=new.must_change_password and (
      not old.must_change_password or new.role is distinct from old.role
      or new.temporary_password_issued_at is distinct from old.temporary_password_issued_at
    );
  end if;
  if v_scoped and v_issued then
    new.temporary_password_issued_at:=statement_timestamp();
    new.temporary_password_expires_at:=new.temporary_password_issued_at+interval '24 hours';
    new.password_changed_at:=null;
  elsif v_scoped and new.must_change_password then
    -- Trusted maintenance may shorten expiry, but cannot extend the issue window.
    new.temporary_password_expires_at:=least(new.temporary_password_expires_at,new.temporary_password_issued_at+interval '24 hours');
  end if;
  return new;
end $$;
revoke all on function public.guard_onboarding_password_metadata() from public,anon,authenticated;
create trigger profiles_guard_onboarding_password before insert or update on public.profiles
  for each row execute function public.guard_onboarding_password_metadata();

create or replace function public.snapshot_onboarding_password_fingerprint()
returns trigger language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_issued boolean; v_fingerprint text;
begin
  if not coalesce(new.role in ('provider','contractor'),false) then
    if tg_op='UPDATE' then
      if old.role in ('provider','contractor') then delete from public.onboarding_password_fingerprints where profile_id=new.id; end if;
    end if;
    return new;
  end if;
  if not new.must_change_password then
    delete from public.onboarding_password_fingerprints where profile_id=new.id;
    return new;
  end if;
  if tg_op='INSERT' then v_issued:=true;
  else v_issued:=not old.must_change_password or new.role is distinct from old.role or new.temporary_password_issued_at is distinct from old.temporary_password_issued_at;
  end if;
  if v_issued then
    select encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex') into v_fingerprint from auth.users u where u.id=new.id and nullif(u.encrypted_password,'') is not null;
    if v_fingerprint is null then raise exception 'Auth password is required before temporary credential issuance' using errcode='23514'; end if;
    insert into public.onboarding_password_fingerprints(profile_id,password_fingerprint,issued_at)
    values(new.id,v_fingerprint,new.temporary_password_issued_at)
    on conflict(profile_id) do update set password_fingerprint=excluded.password_fingerprint,issued_at=excluded.issued_at;
  end if;
  return new;
end $$;
revoke all on function public.snapshot_onboarding_password_fingerprint() from public,anon,authenticated;
create trigger profiles_snapshot_onboarding_password after insert or update on public.profiles
  for each row execute function public.snapshot_onboarding_password_fingerprint();

create or replace function public.complete_temporary_password_change()
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare p public.profiles%rowtype; v_current text; v_issued text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id=auth.uid() for update;
  if not found or not p.must_change_password then raise exception 'Password change is not pending'; end if;
  if p.role in ('provider','contractor') then
    if p.temporary_password_expires_at is null or p.temporary_password_expires_at<=statement_timestamp() then
      raise exception 'Temporary password has expired; request new credentials from the administrator' using errcode='42501';
    end if;
    select password_fingerprint into v_issued from public.onboarding_password_fingerprints where profile_id=p.id;
    select encode(sha256(convert_to(u.encrypted_password,'UTF8')),'hex') into v_current from auth.users u where u.id=p.id and nullif(u.encrypted_password,'') is not null;
    if v_issued is null or v_current is null or v_issued=v_current then
      raise exception 'Change the Auth password before completing onboarding' using errcode='42501';
    end if;
  end if;
  update public.profiles set must_change_password=false,password_changed_at=statement_timestamp(),temporary_password_expires_at=null,updated_at=statement_timestamp() where id=p.id;
  update public.provider_drivers d set must_change_password=false,status='active',updated_at=now()
  from public.provider_driver_accounts a where a.driver_id=d.id and a.auth_user_id=p.id and d.status='must_change_password';
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
  values(p.id,'profiles',p.id,'temporary_password_changed','{}'::jsonb);
end $$;
revoke all on function public.complete_temporary_password_change() from public,anon;
grant execute on function public.complete_temporary_password_change() to authenticated;

-- Supabase Auth calls this before issuing access tokens, including refreshes.
-- The Auth service receives only the columns needed to enforce this deadline.
grant usage on schema public to supabase_auth_admin;
grant select(id,role,must_change_password,temporary_password_expires_at) on public.profiles to supabase_auth_admin;
create policy profiles_auth_onboarding_hook_select on public.profiles for select to supabase_auth_admin using(true);
create or replace function public.onboarding_access_token_hook(event jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p record; v_claims jsonb:=event->'claims'; v_user_id uuid:=(event->>'user_id')::uuid; v_exp bigint;
begin
  select role,must_change_password,temporary_password_expires_at into p from public.profiles where id=v_user_id;
  if found and p.role in ('provider','contractor') and p.must_change_password then
    if p.temporary_password_expires_at is null or p.temporary_password_expires_at<=statement_timestamp() then
      return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','انتهت صلاحية كلمة المرور المؤقتة. اطلب من الإدارة إعادة إرسال بيانات الدخول.'));
    end if;
    v_exp:=floor(extract(epoch from p.temporary_password_expires_at))::bigint;
    if (v_claims->>'exp')::bigint>v_exp then v_claims:=jsonb_set(v_claims,'{exp}',to_jsonb(v_exp)); end if;
  end if;
  return jsonb_build_object('claims',v_claims);
end $$;
revoke all on function public.onboarding_access_token_hook(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.onboarding_access_token_hook(jsonb) to supabase_auth_admin;

commit;
