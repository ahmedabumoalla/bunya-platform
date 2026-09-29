begin;

alter table public.provider_applications
  add column company_name_en text,
  add column service_cities text[] not null default '{}',
  add column joining_policy_id uuid references public.platform_policies(id) on delete restrict,
  add column joining_policy_version integer,
  add column joining_policy_title text,
  add column joining_policy_body jsonb,
  add column joining_policy_updated_at timestamptz,
  add column joining_policy_accepted_at timestamptz,
  alter column contact_name drop not null,
  drop constraint provider_applications_contact_not_blank,
  drop column discount_code;
alter table public.providers
  add column company_name_en text,
  add column service_cities text[] not null default '{}',
  alter column contact_name drop not null;
alter table public.provider_application_documents add column is_current boolean not null default true;
create unique index provider_join_current_document_type_idx on public.provider_application_documents(application_id,document_type)
  where is_current and document_type in ('commercial_registration','municipal_license','national_address','vat_certificate');
create index provider_application_joining_policy_idx on public.provider_applications(joining_policy_id) where joining_policy_id is not null;

create or replace function public.validate_provider_join_details()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_policy public.platform_policies%rowtype; v_accept boolean;
begin
  new.company_name := regexp_replace(btrim(new.company_name),'\s+',' ','g');
  new.company_name_en := nullif(regexp_replace(btrim(new.company_name_en),'\s+',' ','g'),'');
  new.contact_name := nullif(regexp_replace(btrim(new.contact_name),'\s+',' ','g'),'');
  if tg_op='INSERT' then v_accept:=true;
  else
    v_accept := (old.status='needs_changes' and new.status='pending')
      or (new.joining_policy_id,new.joining_policy_version,new.joining_policy_updated_at,new.joining_policy_accepted_at)
        is distinct from (old.joining_policy_id,old.joining_policy_version,old.joining_policy_updated_at,old.joining_policy_accepted_at);
    if not v_accept and (new.joining_policy_title,new.joining_policy_body) is distinct from (old.joining_policy_title,old.joining_policy_body) then
      raise exception 'Policy acceptance snapshot is immutable' using errcode='23514';
    end if;
  end if;
  if v_accept then
    if length(new.company_name) not between 2 and 160 or new.company_name_en is null or length(new.company_name_en) not between 2 and 160
      or length(coalesce(new.contact_name,''))>120 or cardinality(new.service_cities) not between 1 and 50
      or exists(select 1 from unnest(new.service_cities) city where city is null or length(btrim(city)) not between 2 and 100) then
      raise exception 'Invalid provider names or service cities' using errcode='23514';
    end if;
    if new.joining_policy_accepted_at is null then raise exception 'Provider joining policy must be accepted' using errcode='23514'; end if;
    select * into v_policy from public.platform_policies where id=new.joining_policy_id and policy_key='provider-join' and is_published for share;
    if not found or v_policy.version is distinct from new.joining_policy_version or v_policy.updated_at is distinct from new.joining_policy_updated_at
      or jsonb_typeof(v_policy.body)<>'array' or jsonb_array_length(v_policy.body)=0
      or not exists(select 1 from jsonb_array_elements_text(v_policy.body) paragraph where btrim(paragraph)<>'') then
      raise exception 'Provider joining policy changed or is unavailable' using errcode='23514';
    end if;
    new.joining_policy_title:=v_policy.title;
    new.joining_policy_body:=v_policy.body;
    new.joining_policy_accepted_at:=now();
  end if;
  return new;
end $$;
revoke all on function public.validate_provider_join_details() from public,anon,authenticated;
create trigger provider_join_validate before insert or update on public.provider_applications for each row execute function public.validate_provider_join_details();

-- Both approval entry points insert a provider linked to its reviewed application.
create or replace function public.copy_provider_join_details()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.application_id is not null then
    select company_name_en,service_cities into new.company_name_en,new.service_cities from public.provider_applications where id=new.application_id;
  end if;
  return new;
end $$;
revoke all on function public.copy_provider_join_details() from public,anon,authenticated;
create trigger provider_copy_join_details before insert on public.providers for each row execute function public.copy_provider_join_details();

-- Server-only, transactional submission/revision. Uploads are private and staged before this call.
create or replace function public.save_provider_join_application(
  p_application_id uuid,p_fields jsonb,p_categories text[],p_regions text[],p_documents jsonb,p_revision_token_hash text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.provider_applications%rowtype; t public.join_application_revision_tokens%rowtype; d jsonb; v_created timestamptz;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_categories),0) not between 1 and 30 or exists(select 1 from unnest(p_categories) x where x is null or length(btrim(x)) not between 2 and 100) then raise exception 'Invalid categories'; end if;
  if p_fields->>'delivery_available'='true' and (coalesce(cardinality(p_regions),0) not between 1 and 30 or exists(select 1 from unnest(p_regions) x where x is null or length(btrim(x)) not between 2 and 100)) then raise exception 'Delivery regions required'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>4 then raise exception 'Invalid documents'; end if;
  if p_revision_token_hash is not null then
    select * into t from public.join_application_revision_tokens where token_hash=p_revision_token_hash and application_kind='provider' and application_id=p_application_id for update;
    if not found or t.used_at is not null or t.expires_at<=now() or t.attempts>=t.max_attempts then raise exception 'Revision token is unavailable' using errcode='23514'; end if;
    select * into a from public.provider_applications where id=p_application_id for update;
    if not found or a.status<>'needs_changes' then raise exception 'Application is not awaiting changes' using errcode='23514'; end if;
    update public.provider_applications set
      company_name=p_fields->>'company_name',company_name_en=p_fields->>'company_name_en',contact_name=p_fields->>'contact_name',
      service_cities=array(select jsonb_array_elements_text(p_fields->'service_cities')),email=p_fields->>'email',mobile=p_fields->>'mobile',
      requested_username=p_fields->>'requested_username',google_maps_url=p_fields->>'google_maps_url',latitude=(p_fields->>'latitude')::numeric,longitude=(p_fields->>'longitude')::numeric,
      delivery_available=(p_fields->>'delivery_available')::boolean,
      joining_policy_id=(p_fields->>'joining_policy_id')::uuid,joining_policy_version=(p_fields->>'joining_policy_version')::integer,
      joining_policy_updated_at=(p_fields->>'joining_policy_updated_at')::timestamptz,joining_policy_accepted_at=(p_fields->>'joining_policy_accepted_at')::timestamptz,
      status='pending',reviewed_by=null,reviewed_at=null,review_notes=null where id=p_application_id returning created_at into v_created;
    delete from public.provider_application_categories where application_id=p_application_id;
    delete from public.provider_delivery_regions where application_id=p_application_id;
  else
    insert into public.provider_applications(id,company_name,company_name_en,contact_name,service_cities,email,mobile,requested_username,google_maps_url,latitude,longitude,delivery_available,joining_policy_id,joining_policy_version,joining_policy_updated_at,joining_policy_accepted_at,public_idempotency_key)
    values(p_application_id,p_fields->>'company_name',p_fields->>'company_name_en',p_fields->>'contact_name',array(select jsonb_array_elements_text(p_fields->'service_cities')),p_fields->>'email',p_fields->>'mobile',p_fields->>'requested_username',p_fields->>'google_maps_url',(p_fields->>'latitude')::numeric,(p_fields->>'longitude')::numeric,(p_fields->>'delivery_available')::boolean,(p_fields->>'joining_policy_id')::uuid,(p_fields->>'joining_policy_version')::integer,(p_fields->>'joining_policy_updated_at')::timestamptz,(p_fields->>'joining_policy_accepted_at')::timestamptz,p_fields->>'public_idempotency_key') returning created_at into v_created;
  end if;
  insert into public.provider_application_categories(application_id,custom_category) select p_application_id,x from unnest(p_categories) x;
  if p_fields->>'delivery_available'='true' then insert into public.provider_delivery_regions(application_id,region_name) select p_application_id,x from unnest(p_regions) x; end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    if d->>'document_type' not in ('commercial_registration','municipal_license','national_address','vat_certificate')
      or d->>'object_path' not like 'join-applications/provider/'||p_application_id::text||'/%'
      or d->>'mime_type' not in ('application/pdf','image/jpeg','image/png','image/webp')
      or (d->>'size_bytes')::bigint not between 1 and 10485760 then raise exception 'Invalid provider document'; end if;
    update public.provider_application_documents set is_current=false where application_id=p_application_id and document_type=d->>'document_type' and is_current;
    insert into public.files(id,owner_profile_id,bucket_id,object_path,purpose,original_name,mime_type,size_bytes,checksum_sha256,uploaded_at)
    values((d->>'id')::uuid,null,'join-applications',d->>'object_path','provider_join_document',d->>'original_name',d->>'mime_type',(d->>'size_bytes')::bigint,d->>'checksum_sha256',now());
    insert into public.provider_application_documents(application_id,file_id,document_type) values(p_application_id,(d->>'id')::uuid,d->>'document_type');
  end loop;
  if (select count(distinct document_type) from public.provider_application_documents where application_id=p_application_id and is_current and document_type in('commercial_registration','municipal_license','national_address','vat_certificate'))<>4 then raise exception 'All four provider documents are required' using errcode='23514'; end if;
  if p_revision_token_hash is not null then update public.join_application_revision_tokens set used_at=now(),attempts=attempts+1 where id=t.id; end if;
  return jsonb_build_object('applicationId',p_application_id,'status','pending','submittedAt',v_created);
end $$;
revoke all on function public.save_provider_join_application(uuid,jsonb,text[],text[],jsonb,text) from public,anon,authenticated;
grant execute on function public.save_provider_join_application(uuid,jsonb,text[],text[],jsonb,text) to service_role;

-- Draft only; the owner reviews and publishes it from the existing policy manager.
insert into public.platform_policies(policy_key,title,summary,body,version,is_published)
values('provider-join','سياسة انضمام مزود الخدمات أو المورد','متطلبات تقديم طلب الانضمام ومراجعته لدى بُنية.',jsonb_build_array(
'تُقدَّم بيانات المنشأة باسمها بالعربية والإنجليزية، مع معلومات التواصل والمدن التي تخدمها. اسم المسؤول اختياري.',
'يرفق مقدم الطلب السجل التجاري ورخصة البلدية والعنوان الوطني وشهادة تسجيل ضريبة القيمة المضافة، ويتأكد من وضوح المستندات وصحة البيانات المدخلة.',
'يصل طلب الانضمام إلى إدارة بُنية للمراجعة. تقديم الطلب لا يعني اعتماده، وقد تطلب الإدارة تصحيح البيانات أو استكمال المستندات.',
'تُستخدم بيانات الطلب ومستنداته لمراجعة الانضمام والتواصل بشأنه وفق سياسة الخصوصية المنشورة في المنصة.',
'بالموافقة، يؤكد مقدم الطلب اطلاعه على هذه السياسة وصحة البيانات والمستندات التي يقدمها.'),1,false)
on conflict(policy_key) do nothing;

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
      full_name = coalesce(v_application.contact_name, v_application.company_name),
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


commit;
