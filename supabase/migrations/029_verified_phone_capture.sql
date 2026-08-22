-- Phone numbers for customers and providers are accepted only after the user
-- proves possession with the platform verification challenge.

alter table public.providers alter column mobile drop not null;

create table public.phone_verification_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique check (phone ~ '^\+9665[0-9]{8}$'),
  code_hash text not null check (length(code_hash) = 64),
  code_salt text not null check (length(code_salt) >= 32),
  expires_at timestamptz not null,
  resend_after timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index phone_verification_challenges_expiry_idx
  on public.phone_verification_challenges(expires_at);

alter table public.phone_verification_challenges enable row level security;
revoke all on table public.phone_verification_challenges from public, anon, authenticated;
grant all on table public.phone_verification_challenges to service_role;

create or replace function public.sync_verified_auth_phone()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.phone is not null and new.phone_confirmed_at is not null then
    new.raw_user_meta_data := jsonb_set(
      coalesce(new.raw_user_meta_data, '{}'::jsonb),
      '{mobile}',
      to_jsonb(new.phone),
      true
    );
    update public.profiles set mobile = new.phone, updated_at = now() where id = new.id;
    update public.providers set mobile = new.phone, updated_at = now() where owner_profile_id = new.id;
  elsif new.phone is null then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'mobile';
    update public.profiles set mobile = null, updated_at = now() where id = new.id;
    update public.providers set mobile = null, updated_at = now() where owner_profile_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_verified_auth_phone() from public, anon, authenticated;

drop trigger if exists sync_verified_auth_phone_on_auth_user on auth.users;
create trigger sync_verified_auth_phone_on_auth_user
before update of phone, phone_confirmed_at on auth.users
for each row execute function public.sync_verified_auth_phone();

-- New customer/provider profiles must not inherit an application or form phone
-- before Auth confirms it. Contractor onboarding retains its existing behavior.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, role, username, full_name, mobile, email)
  values (
    new.id,
    'customer',
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    case
      when new.phone is not null and new.phone_confirmed_at is not null then new.phone
      when new.raw_user_meta_data ->> 'onboarding_role' = 'contractor'
        then nullif(btrim(new.raw_user_meta_data ->> 'mobile'), '')
      else null
    end,
    new.email
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create or replace function public.clear_unverified_provider_phone(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if exists (select 1 from auth.users where id = p_user_id and phone_confirmed_at is null) then
    update public.profiles set mobile = null, updated_at = now() where id = p_user_id;
    update public.providers set mobile = null, updated_at = now() where owner_profile_id = p_user_id;
  end if;
end;
$$;

revoke execute on function public.clear_unverified_provider_phone(uuid) from public, anon, authenticated;
grant execute on function public.clear_unverified_provider_phone(uuid) to service_role;

-- Exact one-time cleanup scope: active or pending customer/provider identities
-- whose Auth phone has never been confirmed. Application history is preserved.
create temporary table phone_cleanup_candidates on commit drop as
select u.id
from auth.users u
join public.profiles p on p.id = u.id
where u.phone_confirmed_at is null
  and (
    p.role in ('customer', 'provider')
    or exists (
      select 1 from public.user_roles ur
      where ur.profile_id = u.id
        and ur.role in ('customer', 'provider')
        and ur.revoked_at is null
    )
  );

update public.providers pr
set mobile = null, updated_at = now()
where pr.owner_profile_id in (select id from phone_cleanup_candidates);

update public.profiles p
set mobile = null, updated_at = now()
where p.id in (select id from phone_cleanup_candidates);

delete from auth.identities i
where i.user_id in (select id from phone_cleanup_candidates)
  and i.provider = 'phone';

update auth.users u
set
  phone = null,
  phone_change = '',
  phone_change_token = '',
  phone_change_sent_at = null,
  raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) - 'mobile',
  raw_app_meta_data = (
    case
      when coalesce(u.raw_app_meta_data, '{}'::jsonb) ->> 'provider' = 'phone' and u.email is not null
        then jsonb_set(coalesce(u.raw_app_meta_data, '{}'::jsonb), '{provider}', '"email"'::jsonb, true)
      when coalesce(u.raw_app_meta_data, '{}'::jsonb) ->> 'provider' = 'phone'
        then coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'provider'
      else coalesce(u.raw_app_meta_data, '{}'::jsonb)
    end
  ) || jsonb_build_object(
    'providers',
    coalesce(
      (
        select jsonb_agg(provider_name)
        from jsonb_array_elements_text(coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)) as providers(provider_name)
        where provider_name <> 'phone'
      ),
      '[]'::jsonb
    )
  ),
  updated_at = now()
where u.id in (select id from phone_cleanup_candidates);
