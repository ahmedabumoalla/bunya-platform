begin;

-- Forward-only migration from the previously deployed 001 baseline.
-- Abort before any DDL when the expected baseline is not present.
do $$
declare
  v_missing text;
begin
  select string_agg(required_name, ', ' order by required_name)
    into v_missing
  from (values
    ('public.profiles'),
    ('public.user_roles'),
    ('public.provider_applications'),
    ('public.contractor_applications'),
    ('public.providers'),
    ('public.contractor_profiles'),
    ('public.admin_users'),
    ('public.admin_roles')
  ) as required(required_name)
  where to_regclass(required_name) is null;

  if v_missing is not null then
    raise exception '002 onboarding preflight failed; missing baseline relations: %', v_missing;
  end if;

  if to_regclass('public.account_onboarding_deliveries') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'must_change_password'
     ) then
    raise exception '002 onboarding preflight failed; onboarding schema is already present or partially applied';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid in ('public.provider_applications'::regclass, 'public.contractor_applications'::regclass)
      and attname = 'applicant_profile_id' and attnotnull and not attisdropped
  ) then
    raise exception '002 onboarding preflight failed; applicant_profile_id must be nullable for public applications';
  end if;

  if to_regprocedure('public.admin_has_permission(text)') is null
     or to_regclass('public.admin_role_permissions') is null
     or to_regclass('public.admin_permissions') is null
     or to_regclass('public.join_request_reviews') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.outbox_events') is null then
    raise exception '002 onboarding preflight failed; required administration/audit baseline is incomplete';
  end if;
end
$$;

alter table public.profiles
  add column must_change_password boolean not null default false,
  add column temporary_password_issued_at timestamptz,
  add column temporary_password_expires_at timestamptz,
  add column password_changed_at timestamptz,
  add constraint profiles_temporary_password_window check (
    (not must_change_password)
    or (
      temporary_password_issued_at is not null
      and temporary_password_expires_at is not null
      and temporary_password_expires_at > temporary_password_issued_at
    )
  );

comment on column public.profiles.must_change_password is
  'Server-managed gate for accounts issued a temporary password; no password material is stored.';

-- Existing profiles are preserved and explicitly retain normal access.
update public.profiles
set must_change_password = false
where must_change_password is distinct from false;

alter table public.provider_applications
  add column public_idempotency_key text;

alter table public.contractor_applications
  add column public_idempotency_key text;

alter table public.provider_applications
  add constraint provider_applications_idempotency_format check (
    public_idempotency_key is null
    or public_idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'
  );

alter table public.contractor_applications
  add constraint contractor_applications_idempotency_format check (
    public_idempotency_key is null
    or public_idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'
  );

create unique index provider_applications_public_idempotency_idx
  on public.provider_applications (public_idempotency_key)
  where public_idempotency_key is not null;

create unique index contractor_applications_public_idempotency_idx
  on public.contractor_applications (public_idempotency_key)
  where public_idempotency_key is not null;

create table public.account_onboarding_deliveries (
  id uuid primary key default gen_random_uuid(),
  application_kind text not null,
  application_id uuid not null,
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  provisioning_status text not null default 'not_started',
  email_delivery_status text not null default 'pending',
  whatsapp_delivery_status text not null default 'pending',
  email_provider_reference text,
  whatsapp_provider_reference text,
  delivery_attempts integer not null default 0,
  provisioned_at timestamptz,
  last_delivery_at timestamptz,
  last_delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_onboarding_application_kind check (
    application_kind in ('provider', 'contractor')
  ),
  constraint account_onboarding_provisioning_status check (
    provisioning_status in (
      'not_started', 'creating_auth', 'provisioned', 'credentials_pending',
      'credentials_sent', 'credentials_partially_sent', 'credentials_failed'
    )
  ),
  constraint account_onboarding_email_status check (
    email_delivery_status in ('pending', 'sent', 'failed', 'not_configured')
  ),
  constraint account_onboarding_whatsapp_status check (
    whatsapp_delivery_status in ('pending', 'sent', 'failed', 'not_configured')
  ),
  constraint account_onboarding_delivery_attempts check (delivery_attempts >= 0),
  constraint account_onboarding_error_sanitized check (
    last_delivery_error is null or length(last_delivery_error) <= 500
  ),
  constraint account_onboarding_delivery_time check (
    last_delivery_at is null or last_delivery_at >= created_at
  ),
  unique (application_kind, application_id)
);

comment on table public.account_onboarding_deliveries is
  'Provisioning and masked provider-delivery state only; never stores passwords, reset tokens, or message bodies.';

create index account_onboarding_delivery_status_idx
  on public.account_onboarding_deliveries (provisioning_status, last_delivery_at);

create index account_onboarding_application_idx
  on public.account_onboarding_deliveries (application_kind, application_id);

create trigger account_onboarding_deliveries_set_updated_at
before update on public.account_onboarding_deliveries
for each row execute function public.set_updated_at();

alter table public.account_onboarding_deliveries enable row level security;

create policy account_onboarding_admin_read
on public.account_onboarding_deliveries
for select to authenticated
using (public.admin_has_permission('reviews.manage'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'join-applications',
  'join-applications',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally no storage.objects policy for anon/authenticated uploads.
-- The server-side service role owns submission uploads and short-lived signed URLs.

create or replace function public.finalize_provider_application_approval(
  p_application_id uuid,
  p_auth_user_id uuid,
  p_reviewer_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_application public.provider_applications%rowtype;
  v_provider_id uuid;
  v_admin_user_id uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Approval reason is required';
  end if;

  select au.id into v_admin_user_id
  from public.admin_users au
  join public.admin_roles ar on ar.id = au.role_id
  where au.profile_id = p_reviewer_id
    and au.is_active
    and (
      ar.role_key = 'super_admin'
      or exists (
        select 1
        from public.admin_role_permissions arp
        join public.admin_permissions ap on ap.id = arp.permission_id
        where arp.role_id = ar.id and ap.permission_key = 'reviews.manage'
      )
    );

  if v_admin_user_id is null then
    raise exception 'Reviewer is not authorized';
  end if;

  select * into v_application
  from public.provider_applications
  where id = p_application_id
  for update;

  if not found or v_application.status not in ('pending', 'needs_changes') then
    raise exception 'Application is not approvable';
  end if;

  if exists (select 1 from public.providers where application_id = p_application_id)
     or exists (
       select 1 from public.account_onboarding_deliveries
       where application_kind = 'provider' and application_id = p_application_id
     ) then
    raise exception 'Application was already provisioned';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id)
     or not exists (select 1 from public.profiles where id = p_auth_user_id) then
    raise exception 'Auth user/profile is not ready';
  end if;

  if exists (
    select 1 from public.profiles
    where id <> p_auth_user_id
      and (lower(email) = lower(v_application.email) or mobile = v_application.mobile)
  ) then
    raise exception 'Application identity conflicts with an existing profile';
  end if;

  update public.profiles
  set role = 'provider',
      username = v_application.requested_username,
      full_name = v_application.contact_name,
      mobile = v_application.mobile,
      email = lower(v_application.email),
      is_active = true,
      must_change_password = true,
      temporary_password_issued_at = now(),
      temporary_password_expires_at = now() + interval '72 hours',
      password_changed_at = null,
      updated_at = now()
  where id = p_auth_user_id;

  delete from public.customer_profiles where profile_id = p_auth_user_id;
  delete from public.user_roles
  where profile_id = p_auth_user_id and role = 'customer' and revoked_at is null;
  update public.user_roles
  set is_primary = false
  where profile_id = p_auth_user_id and revoked_at is null;

  insert into public.user_roles (profile_id, role, is_primary, granted_by)
  values (p_auth_user_id, 'provider', true, p_reviewer_id)
  on conflict (profile_id, role) where revoked_at is null
  do update set is_primary = true, granted_by = excluded.granted_by;

  insert into public.providers (
    owner_profile_id, application_id, company_name, contact_name, mobile, email,
    google_maps_url, latitude, longitude, status, reviewed_by, reviewed_at, review_notes
  ) values (
    p_auth_user_id, v_application.id, v_application.company_name,
    v_application.contact_name, v_application.mobile, lower(v_application.email),
    v_application.google_maps_url, v_application.latitude, v_application.longitude,
    'approved', p_reviewer_id, now(), p_reason
  ) returning id into v_provider_id;

  insert into public.provider_profiles (provider_id, username, delivery_available)
  values (v_provider_id, v_application.requested_username, v_application.delivery_available);

  insert into public.provider_members (provider_id, profile_id, member_role, is_active)
  values (v_provider_id, p_auth_user_id, 'owner', true);

  insert into public.provider_settings (provider_id, delivery_available)
  values (v_provider_id, v_application.delivery_available);

  update public.provider_applications
  set applicant_profile_id = p_auth_user_id,
      status = 'approved',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      review_notes = p_reason,
      updated_at = now()
  where id = v_application.id;

  insert into public.account_onboarding_deliveries (
    application_kind, application_id, auth_user_id, provisioning_status, provisioned_at
  ) values ('provider', v_application.id, p_auth_user_id, 'credentials_pending', now());

  insert into public.join_request_reviews (
    admin_user_id, request_kind, request_id, outcome, reason
  ) values (v_admin_user_id, 'provider', v_application.id, 'approved', p_reason);

  insert into public.audit_logs (
    actor_profile_id, entity_table, entity_id, action, new_data
  ) values (
    p_reviewer_id, 'provider_applications', v_application.id,
    'provider_account_provisioned',
    jsonb_build_object('auth_user_id', p_auth_user_id, 'provider_id', v_provider_id)
  );

  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'provider', v_provider_id, 'provider_account_provisioned',
    jsonb_build_object('application_id', v_application.id, 'auth_user_id', p_auth_user_id)
  );

  return v_provider_id;
end
$$;

create or replace function public.finalize_contractor_application_approval(
  p_application_id uuid,
  p_auth_user_id uuid,
  p_reviewer_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_application public.contractor_applications%rowtype;
  v_contractor_id uuid;
  v_admin_user_id uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Approval reason is required';
  end if;

  select au.id into v_admin_user_id
  from public.admin_users au
  join public.admin_roles ar on ar.id = au.role_id
  where au.profile_id = p_reviewer_id
    and au.is_active
    and (
      ar.role_key = 'super_admin'
      or exists (
        select 1
        from public.admin_role_permissions arp
        join public.admin_permissions ap on ap.id = arp.permission_id
        where arp.role_id = ar.id and ap.permission_key = 'reviews.manage'
      )
    );

  if v_admin_user_id is null then
    raise exception 'Reviewer is not authorized';
  end if;

  select * into v_application
  from public.contractor_applications
  where id = p_application_id
  for update;

  if not found or v_application.status not in ('pending', 'needs_changes') then
    raise exception 'Application is not approvable';
  end if;

  if exists (select 1 from public.contractor_profiles where application_id = p_application_id)
     or exists (
       select 1 from public.account_onboarding_deliveries
       where application_kind = 'contractor' and application_id = p_application_id
     ) then
    raise exception 'Application was already provisioned';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id)
     or not exists (select 1 from public.profiles where id = p_auth_user_id) then
    raise exception 'Auth user/profile is not ready';
  end if;

  if exists (
    select 1 from public.profiles
    where id <> p_auth_user_id
      and (lower(email) = lower(v_application.email) or mobile = v_application.mobile)
  ) then
    raise exception 'Application identity conflicts with an existing profile';
  end if;

  update public.profiles
  set role = 'contractor',
      full_name = v_application.contractor_name,
      mobile = v_application.mobile,
      email = lower(v_application.email),
      is_active = true,
      must_change_password = true,
      temporary_password_issued_at = now(),
      temporary_password_expires_at = now() + interval '72 hours',
      password_changed_at = null,
      updated_at = now()
  where id = p_auth_user_id;

  delete from public.customer_profiles where profile_id = p_auth_user_id;
  delete from public.user_roles
  where profile_id = p_auth_user_id and role = 'customer' and revoked_at is null;
  update public.user_roles
  set is_primary = false
  where profile_id = p_auth_user_id and revoked_at is null;

  insert into public.user_roles (profile_id, role, is_primary, granted_by)
  values (p_auth_user_id, 'contractor', true, p_reviewer_id)
  on conflict (profile_id, role) where revoked_at is null
  do update set is_primary = true, granted_by = excluded.granted_by;

  insert into public.contractor_profiles (
    profile_id, application_id, display_name, commercial_name, phone, email,
    approval_status, directory_visible, subscription_active
  ) values (
    p_auth_user_id, v_application.id, v_application.contractor_name,
    v_application.contractor_name, v_application.mobile, lower(v_application.email),
    'approved', false, false
  ) returning id into v_contractor_id;

  insert into public.contractor_profile_specialties (profile_id, specialty_name, sort_order)
  select v_contractor_id, specialty_name, row_number() over (order by created_at)::integer
  from public.contractor_specialties
  where application_id = v_application.id;

  insert into public.contractor_profile_regions (profile_id, region_name)
  select v_contractor_id, region_name
  from public.contractor_work_regions
  where application_id = v_application.id;

  update public.contractor_documents
  set contractor_profile_id = v_contractor_id
  where application_id = v_application.id and contractor_profile_id is null;

  update public.contractor_applications
  set applicant_profile_id = p_auth_user_id,
      status = 'approved',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      review_notes = p_reason,
      updated_at = now()
  where id = v_application.id;

  insert into public.account_onboarding_deliveries (
    application_kind, application_id, auth_user_id, provisioning_status, provisioned_at
  ) values ('contractor', v_application.id, p_auth_user_id, 'credentials_pending', now());

  insert into public.join_request_reviews (
    admin_user_id, request_kind, request_id, outcome, reason
  ) values (v_admin_user_id, 'contractor', v_application.id, 'approved', p_reason);

  insert into public.audit_logs (
    actor_profile_id, entity_table, entity_id, action, new_data
  ) values (
    p_reviewer_id, 'contractor_applications', v_application.id,
    'contractor_account_provisioned',
    jsonb_build_object('auth_user_id', p_auth_user_id, 'contractor_profile_id', v_contractor_id)
  );

  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'contractor', v_contractor_id, 'contractor_account_provisioned',
    jsonb_build_object('application_id', v_application.id, 'auth_user_id', p_auth_user_id)
  );

  return v_contractor_id;
end
$$;

create or replace function public.mark_onboarding_credentials_delivery(
  p_application_kind text,
  p_application_id uuid,
  p_email_status text,
  p_whatsapp_status text,
  p_email_reference text,
  p_whatsapp_reference text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_sanitized_error text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_application_kind not in ('provider', 'contractor')
     or p_email_status not in ('pending', 'sent', 'failed', 'not_configured')
     or p_whatsapp_status not in ('pending', 'sent', 'failed', 'not_configured') then
    raise exception 'Invalid delivery state';
  end if;

  v_status := case
    when p_email_status = 'sent' and p_whatsapp_status = 'sent' then 'credentials_sent'
    when p_email_status = 'sent' or p_whatsapp_status = 'sent' then 'credentials_partially_sent'
    else 'credentials_failed'
  end;

  -- Keep only a bounded, single-line diagnostic. Callers must not pass message/password data.
  v_sanitized_error := nullif(left(regexp_replace(coalesce(p_error, ''), '[\r\n\t]+', ' ', 'g'), 500), '');

  update public.account_onboarding_deliveries
  set provisioning_status = v_status,
      email_delivery_status = p_email_status,
      whatsapp_delivery_status = p_whatsapp_status,
      email_provider_reference = nullif(left(p_email_reference, 255), ''),
      whatsapp_provider_reference = nullif(left(p_whatsapp_reference, 255), ''),
      delivery_attempts = delivery_attempts + 1,
      last_delivery_at = now(),
      last_delivery_error = v_sanitized_error,
      updated_at = now()
  where application_kind = p_application_kind and application_id = p_application_id;

  if not found then
    raise exception 'Onboarding record not found';
  end if;
end
$$;

create or replace function public.complete_temporary_password_change()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now(),
      temporary_password_expires_at = null,
      updated_at = now()
  where id = auth.uid() and must_change_password;

  if not found then
    raise exception 'Password change is not pending';
  end if;

  insert into public.audit_logs (
    actor_profile_id, entity_table, entity_id, action, new_data
  ) values (
    auth.uid(), 'profiles', auth.uid(), 'temporary_password_changed', '{}'::jsonb
  );
end
$$;

-- PostgreSQL grants new functions to PUBLIC by default; close that gap explicitly.
revoke execute on function public.finalize_provider_application_approval(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_contractor_application_approval(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.mark_onboarding_credentials_delivery(text, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.complete_temporary_password_change()
  from public, anon;

grant execute on function public.finalize_provider_application_approval(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.finalize_contractor_application_approval(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.mark_onboarding_credentials_delivery(text, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.complete_temporary_password_change()
  to authenticated;

commit;
