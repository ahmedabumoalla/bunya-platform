begin;

-- Forward-only additive onboarding change. Legacy applications retain unknown type
-- and their existing documents until explicitly revised through the new workflow.
alter table public.contractor_applications
  add column contractor_type text check (contractor_type in ('company','individual')),
  add column contractor_name_en text,
  add column contact_name text,
  add column requested_username text,
  add column username_is_custom boolean not null default false,
  add column joining_policy_id uuid references public.platform_policies(id) on delete restrict,
  add column joining_policy_version integer,
  add column joining_policy_title text,
  add column joining_policy_body jsonb,
  add column joining_policy_updated_at timestamptz,
  add column joining_policy_accepted_at timestamptz;
create index contractor_application_joining_policy_idx on public.contractor_applications(joining_policy_id) where joining_policy_id is not null;
create unique index contractor_applications_pending_username_idx on public.contractor_applications(lower(requested_username))
  where status in ('pending','needs_changes') and requested_username is not null;
alter table public.contractor_profiles
  add column contractor_type text check (contractor_type in ('company','individual')),
  add column display_name_en text,
  add column contact_name text,
  add column username text;
alter table public.profiles drop constraint profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (
    ((coalesce(role in ('provider','contractor'),false) and char_length(username) between 2 and 160) or char_length(username) between 4 and 40)
    and username=btrim(username) and username !~ '[[:cntrl:]]'
  )
);

alter table public.contractor_documents
  add column is_current boolean not null default true,
  add column document_key text,
  drop constraint contractor_documents_size_bytes_check,
  drop constraint contractor_documents_allowed_type;
-- Unique legacy keys avoid changing document meaning or discarding duplicate history.
update public.contractor_documents set document_key='legacy_'||id::text where document_key is null;
alter table public.contractor_documents alter column document_key set default ('legacy_'||gen_random_uuid()::text);
alter table public.contractor_documents alter column document_key set not null;
alter table public.contractor_documents add constraint contractor_documents_size_bytes_check
  check(size_bytes>0 and (application_id is not null or size_bytes<=5242880));
alter table public.contractor_documents add constraint contractor_documents_allowed_type
  check(mime_type='application/pdf' or mime_type like 'image/%' or
    (application_id is not null and document_type='portfolio' and mime_type in ('video/mp4','video/webm','video/quicktime')));
create unique index contractor_join_current_document_key_idx on public.contractor_documents(application_id,document_key) where is_current;

create or replace function public.validate_contractor_join_details()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_policy public.platform_policies%rowtype; v_accept boolean;
begin
  new.contractor_name:=btrim(regexp_replace(new.contractor_name,'\s+',' ','g'));
  new.contractor_name_en:=nullif(btrim(regexp_replace(new.contractor_name_en,'\s+',' ','g')),'');
  new.contact_name:=case when new.contractor_type='company' then nullif(btrim(regexp_replace(new.contact_name,'\s+',' ','g')),'') else null end;
  if tg_op='INSERT' then v_accept:=true;
  else
    v_accept:=old.status='needs_changes' and new.status='pending';
    if not v_accept and (new.joining_policy_id,new.joining_policy_version,new.joining_policy_title,new.joining_policy_body,new.joining_policy_updated_at,new.joining_policy_accepted_at)
      is distinct from (old.joining_policy_id,old.joining_policy_version,old.joining_policy_title,old.joining_policy_body,old.joining_policy_updated_at,old.joining_policy_accepted_at) then
      raise exception 'Policy acceptance snapshot is immutable' using errcode='23514';
    end if;
  end if;
  if v_accept then
    if new.contractor_type is null or new.contractor_type not in ('company','individual')
      or new.contractor_name is null or char_length(new.contractor_name) not between 2 and 160
      or new.contractor_name_en is null or char_length(new.contractor_name_en) not between 2 and 160
      or char_length(coalesce(new.contact_name,''))>120 then raise exception 'Invalid contractor names or type' using errcode='23514'; end if;
    new.requested_username:=nullif(btrim(regexp_replace(new.requested_username,'\s+',' ','g')),'');
    new.username_is_custom:=new.requested_username is not null;
    new.requested_username:=coalesce(new.requested_username,new.contractor_name_en);
    if char_length(new.requested_username) not between 2 and 160 or new.requested_username ~ '[[:cntrl:]]' then raise exception 'Invalid contractor username' using errcode='23514'; end if;
    if new.joining_policy_accepted_at is null then raise exception 'Contractor joining policy must be accepted' using errcode='23514'; end if;
    select * into v_policy from public.platform_policies where id=new.joining_policy_id and policy_key='contractor-join' and is_published for share;
    if not found or v_policy.version is distinct from new.joining_policy_version or v_policy.updated_at is distinct from new.joining_policy_updated_at
      or jsonb_typeof(v_policy.body) is distinct from 'array' or jsonb_array_length(v_policy.body)=0
      or not exists(select 1 from jsonb_array_elements_text(v_policy.body) paragraph where btrim(paragraph)<>'') then
      raise exception 'Contractor joining policy changed or is unavailable' using errcode='23514';
    end if;
    new.joining_policy_title:=v_policy.title;
    new.joining_policy_body:=v_policy.body;
    new.joining_policy_accepted_at:=now();
  end if;
  return new;
end $$;
revoke all on function public.validate_contractor_join_details() from public,anon,authenticated;
create trigger contractor_join_validate before insert or update on public.contractor_applications for each row execute function public.validate_contractor_join_details();

create or replace function public.copy_contractor_join_details()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.application_id is not null then
    select contractor_type,contractor_name_en,contact_name,requested_username
      into new.contractor_type,new.display_name_en,new.contact_name,new.username from public.contractor_applications where id=new.application_id;
  end if;
  return new;
end $$;
revoke all on function public.copy_contractor_join_details() from public,anon,authenticated;
create trigger contractor_copy_join_details before insert on public.contractor_profiles for each row execute function public.copy_contractor_join_details();

create or replace function public.save_contractor_join_application(
  p_application_id uuid,p_fields jsonb,p_specialties text[],p_regions text[],p_documents jsonb,
  p_revision_token_hash text default null,p_removed_document_ids uuid[] default '{}'
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.contractor_applications%rowtype; t public.join_application_revision_tokens%rowtype; d jsonb; v_created timestamptz; v_type text:=p_fields->>'contractor_type';
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_specialties),0) not between 1 and 30 or exists(select 1 from unnest(p_specialties) x where x is null or char_length(btrim(x)) not between 2 and 100) then raise exception 'Invalid specialties' using errcode='23514'; end if;
  if coalesce(cardinality(p_regions),0) not between 1 and 50 or exists(select 1 from unnest(p_regions) x where x is null or char_length(btrim(x)) not between 2 and 100) then raise exception 'Service cities required' using errcode='23514'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>24 then raise exception 'Invalid documents' using errcode='23514'; end if;
  if coalesce(cardinality(p_removed_document_ids),0)>24 then raise exception 'Invalid document removals' using errcode='23514'; end if;
  if p_revision_token_hash is not null then
    select * into t from public.join_application_revision_tokens where token_hash=p_revision_token_hash and application_kind='contractor' and application_id=p_application_id for update;
    if not found or t.used_at is not null or t.expires_at<=now() or t.attempts>=t.max_attempts then raise exception 'Revision token is unavailable' using errcode='23514'; end if;
    select * into a from public.contractor_applications where id=p_application_id for update;
    if not found or a.status<>'needs_changes' then raise exception 'Application is not awaiting changes' using errcode='23514'; end if;
    update public.contractor_applications set
      contractor_name=p_fields->>'contractor_name',contractor_name_en=p_fields->>'contractor_name_en',contractor_type=v_type,contact_name=p_fields->>'contact_name',
      email=p_fields->>'email',mobile=p_fields->>'mobile',requested_username=p_fields->>'requested_username',
      joining_policy_id=(p_fields->>'joining_policy_id')::uuid,joining_policy_version=(p_fields->>'joining_policy_version')::integer,
      joining_policy_updated_at=(p_fields->>'joining_policy_updated_at')::timestamptz,joining_policy_accepted_at=(p_fields->>'joining_policy_accepted_at')::timestamptz,
      status='pending',reviewed_by=null,reviewed_at=null,review_notes=null where id=p_application_id returning created_at into v_created;
    delete from public.contractor_specialties where application_id=p_application_id;
    delete from public.contractor_work_regions where application_id=p_application_id;
  else
    if coalesce(cardinality(p_removed_document_ids),0)>0 then raise exception 'Document removals require revision' using errcode='23514'; end if;
    insert into public.contractor_applications(id,contractor_name,contractor_name_en,contractor_type,contact_name,email,mobile,requested_username,joining_policy_id,joining_policy_version,joining_policy_updated_at,joining_policy_accepted_at,public_idempotency_key)
    values(p_application_id,p_fields->>'contractor_name',p_fields->>'contractor_name_en',v_type,p_fields->>'contact_name',p_fields->>'email',p_fields->>'mobile',p_fields->>'requested_username',(p_fields->>'joining_policy_id')::uuid,(p_fields->>'joining_policy_version')::integer,(p_fields->>'joining_policy_updated_at')::timestamptz,(p_fields->>'joining_policy_accepted_at')::timestamptz,p_fields->>'public_idempotency_key') returning created_at into v_created;
  end if;
  if exists(select 1 from unnest(p_removed_document_ids) r where r is null or not exists(select 1 from public.contractor_documents where id=r and application_id=p_application_id and is_current)) then raise exception 'Invalid document removals' using errcode='23514'; end if;
  update public.contractor_documents set is_current=false where application_id=p_application_id and is_current and (
    id=any(coalesce(p_removed_document_ids,'{}'::uuid[]))
    or document_type is null
    or (v_type='company' and document_type not in ('commercial_registration','municipal_license','national_address','vat_certificate','company_profile'))
    or (v_type='individual' and document_type not in ('national_id','portfolio'))
    or document_key like 'legacy_%');
  insert into public.contractor_specialties(application_id,specialty_name) select p_application_id,btrim(x) from unnest(p_specialties) x;
  insert into public.contractor_work_regions(application_id,region_name) select p_application_id,btrim(x) from unnest(p_regions) x;
  if (select count(*) from jsonb_array_elements(p_documents))<>(select count(distinct value->>'document_key') from jsonb_array_elements(p_documents)) then raise exception 'Duplicate document keys' using errcode='23514'; end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    if d->>'document_type' is null or d->>'document_key' is null or d->>'object_path' is null or d->>'mime_type' is null
      or nullif(btrim(d->>'original_name'),'') is null or d->>'size_bytes' is null or (d->>'size_bytes')::bigint<=0
      or d->>'object_path' not like 'join-applications/contractor/'||p_application_id::text||'/%'
      or d->>'object_path' ~ '(^|/)\.\.(/|$)'
      or (v_type='company' and d->>'document_type' not in ('commercial_registration','municipal_license','national_address','vat_certificate','company_profile'))
      or (v_type='individual' and d->>'document_type' not in ('national_id','portfolio'))
      or (d->>'document_type'<>'portfolio' and (d->>'document_key'<>d->>'document_type' or d->>'mime_type' not in ('application/pdf','image/jpeg','image/png','image/webp')))
      or (d->>'document_type'='portfolio' and (d->>'document_key' !~ '^portfolio_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or d->>'mime_type' not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'))) then
      raise exception 'Invalid contractor document' using errcode='23514';
    end if;
    update public.contractor_documents set is_current=false where application_id=p_application_id and document_key=d->>'document_key' and is_current;
    insert into public.contractor_documents(id,application_id,document_key,document_type,storage_path,file_name,mime_type,size_bytes)
    values((d->>'id')::uuid,p_application_id,d->>'document_key',d->>'document_type',d->>'object_path',d->>'original_name',d->>'mime_type',(d->>'size_bytes')::bigint);
  end loop;
  if v_type='company' and (select count(distinct document_type) from public.contractor_documents where application_id=p_application_id and is_current and document_type in ('commercial_registration','municipal_license','national_address','vat_certificate'))<>4 then raise exception 'All four company documents are required' using errcode='23514'; end if;
  if v_type='individual' and (
    not exists(select 1 from public.contractor_documents where application_id=p_application_id and is_current and document_type='national_id')
    or (select count(*) from public.contractor_documents where application_id=p_application_id and is_current and document_type='portfolio') not between 1 and 20
  ) then raise exception 'National ID and 1 to 20 portfolio files are required' using errcode='23514'; end if;
  if (select count(*) from public.contractor_documents where application_id=p_application_id and is_current)>24 then raise exception 'Too many current documents' using errcode='23514'; end if;
  if p_revision_token_hash is not null then update public.join_application_revision_tokens set used_at=now(),attempts=attempts+1 where id=t.id; end if;
  return jsonb_build_object('applicationId',p_application_id,'status','pending','submittedAt',v_created);
end $$;
revoke all on function public.save_contractor_join_application(uuid,jsonb,text[],text[],jsonb,text,uuid[]) from public,anon,authenticated;
grant execute on function public.save_contractor_join_application(uuid,jsonb,text[],text[],jsonb,text,uuid[]) to service_role;

-- Existing provider capabilities remain provider-scoped, including retry paths.
alter table public.provider_upload_batches add column application_kind text not null default 'provider' check(application_kind in ('provider','contractor'));
alter table public.provider_upload_batches drop constraint provider_upload_batches_documents_check;
alter table public.provider_upload_batches add constraint provider_upload_batches_documents_check
  check(jsonb_typeof(documents)='array' and jsonb_array_length(documents)<=case when application_kind='provider' then 4 else 24 end);

-- A distinct, unpublished draft. Publication remains the policy owner's action.
insert into public.platform_policies(policy_key,title,summary,body,version,is_published)
values('contractor-join','سياسة انضمام المقاولين والمهنيين','متطلبات تقديم طلب الانضمام ومراجعته لدى بُنية.',jsonb_build_array(
'يحدد مقدم الطلب صفته كمنشأة أو فرد، ويقدم الاسم بالعربية والإنجليزية ومعلومات التواصل والتخصصات ومدن تقديم الخدمة. اسم المسؤول اختياري للمنشأة.',
'ترفق المنشأة السجل التجاري ورخصة البلدية والعنوان الوطني وشهادة ضريبة القيمة المضافة، ويمكنها إرفاق ملف تعريفي. يرفق الفرد الهوية الوطنية ونماذج أعماله من الصور أو الفيديو.',
'تراجع إدارة بُنية البيانات والمرفقات، وقد تطلب تصحيحها أو استكمالها. تقديم الطلب لا يعني اعتماده أو نشر حسابه في الدليل.',
'يحتفظ الحساب المعتمد بإمكانية طلب الخدمات بصفة عميل إلى جانب صفته المهنية، وفق السياسات المنشورة لكل خدمة.',
'بالموافقة، يؤكد مقدم الطلب اطلاعه على هذه السياسة وصحة البيانات وامتلاكه الحق في تقديم المرفقات، وتستخدم المعلومات للمراجعة والتواصل وفق سياسة الخصوصية.'),1,false)
on conflict(policy_key) do nothing;

create or replace function public.commit_provider_join_upload(
  p_token_hash text,p_binding_hash text,p_fields jsonb,p_categories text[],p_regions text[],p_documents jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.provider_upload_batches%rowtype; result jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into b from public.provider_upload_batches where token_hash=p_token_hash for update;
  if not found or b.application_kind<>'provider' or b.binding_hash is distinct from p_binding_hash then raise exception 'Invalid upload batch' using errcode='42501'; end if;
  if b.committed_at is not null then
    select jsonb_build_object('applicationId',id,'status',status,'submittedAt',created_at) into result from public.provider_applications where id=b.application_id;
    return result;
  end if;
  if b.expires_at<=now() or b.documents is distinct from p_documents then raise exception 'Expired or changed upload batch' using errcode='23514'; end if;
  result:=public.save_provider_join_application(b.application_id,p_fields,p_categories,p_regions,p_documents,b.revision_token_hash);
  update public.provider_upload_batches set committed_at=now() where id=b.id;
  return result;
end $$;
revoke all on function public.commit_provider_join_upload(text,text,jsonb,text[],text[],jsonb) from public,anon,authenticated;
grant execute on function public.commit_provider_join_upload(text,text,jsonb,text[],text[],jsonb) to service_role;

create or replace function public.commit_contractor_join_upload(
  p_token_hash text,p_binding_hash text,p_fields jsonb,p_specialties text[],p_regions text[],p_documents jsonb,p_removed_document_ids uuid[] default '{}'
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.provider_upload_batches%rowtype; result jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into b from public.provider_upload_batches where token_hash=p_token_hash for update;
  if not found or b.application_kind<>'contractor' or b.binding_hash is distinct from p_binding_hash then raise exception 'Invalid upload batch' using errcode='42501'; end if;
  if b.committed_at is not null then
    select jsonb_build_object('applicationId',id,'status',status,'submittedAt',created_at) into result from public.contractor_applications where id=b.application_id;
    return result;
  end if;
  if b.expires_at<=now() or b.documents is distinct from p_documents then raise exception 'Expired or changed upload batch' using errcode='23514'; end if;
  result:=public.save_contractor_join_application(b.application_id,p_fields,p_specialties,p_regions,p_documents,b.revision_token_hash,p_removed_document_ids);
  update public.provider_upload_batches set committed_at=now() where id=b.id;
  return result;
end $$;
revoke all on function public.commit_contractor_join_upload(text,text,jsonb,text[],text[],jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.commit_contractor_join_upload(text,text,jsonb,text[],text[],jsonb,uuid[]) to service_role;

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
      username = coalesce(v_application.requested_username,username),
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

  insert into public.customer_profiles(profile_id) values(p_auth_user_id) on conflict(profile_id) do nothing;
  update public.user_roles
  set is_primary = false
  where profile_id = p_auth_user_id and revoked_at is null;

  insert into public.user_roles(profile_id,role,is_primary,granted_by)
  values(p_auth_user_id,'customer',false,p_reviewer_id)
  on conflict(profile_id,role) where revoked_at is null do nothing;

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
revoke all on function public.finalize_contractor_application_approval(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_contractor_application_approval(uuid,uuid,uuid,text) to service_role;

create or replace function public.approve_contractor_application(p_application_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.contractor_applications%rowtype;
  v_contractor_id uuid;
  v_admin_user_id uuid;
begin
  if not public.admin_has_permission('reviews.manage') or btrim(coalesce(p_reason,'')) = '' then raise exception 'Not authorized or missing reason'; end if;
  select * into v_application from public.contractor_applications where id = p_application_id for update;
  if not found or v_application.status not in ('pending','needs_changes') or v_application.applicant_profile_id is null then raise exception 'Application is not approvable'; end if;
  select id into v_admin_user_id from public.admin_users where profile_id = auth.uid() and is_active;

  update public.profiles set role='contractor',username=coalesce(v_application.requested_username,username),full_name=v_application.contractor_name where id=v_application.applicant_profile_id;
  insert into public.customer_profiles(profile_id) values(v_application.applicant_profile_id) on conflict(profile_id) do nothing;
  update public.user_roles set is_primary=false where profile_id=v_application.applicant_profile_id and revoked_at is null;
  insert into public.user_roles(profile_id,role,is_primary,granted_by) values(v_application.applicant_profile_id,'customer',false,auth.uid())
  on conflict(profile_id,role) where revoked_at is null do nothing;

  insert into public.contractor_profiles (
    profile_id, application_id, display_name, commercial_name, phone, email,
    approval_status, directory_visible, subscription_active
  ) values (
    v_application.applicant_profile_id, v_application.id, v_application.contractor_name,
    v_application.contractor_name, v_application.mobile, lower(v_application.email),
    'approved', false, false
  ) returning id into v_contractor_id;
  insert into public.contractor_profile_specialties (profile_id, specialty_name, sort_order)
  select v_contractor_id, specialty_name, row_number() over (order by created_at)::integer from public.contractor_specialties where application_id = v_application.id;
  insert into public.contractor_profile_regions (profile_id, region_name)
  select v_contractor_id, region_name from public.contractor_work_regions where application_id = v_application.id;
  insert into public.user_roles (profile_id, role, is_primary, granted_by)
  values (v_application.applicant_profile_id, 'contractor', true, auth.uid())
  on conflict(profile_id,role) where revoked_at is null do update set is_primary=true,granted_by=excluded.granted_by;
  update public.contractor_documents set contractor_profile_id=v_contractor_id where application_id=v_application.id and contractor_profile_id is null;
  update public.contractor_applications set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_reason where id=v_application.id;
  insert into public.join_request_reviews (admin_user_id, request_kind, request_id, outcome, reason)
  values (v_admin_user_id, 'contractor', v_application.id, 'approved', p_reason);
  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values ('contractor', v_contractor_id, 'contractor_application_approved', jsonb_build_object('application_id', v_application.id));
  return v_contractor_id;
end;
$$;
revoke all on function public.approve_contractor_application(uuid,text) from public,anon;
grant execute on function public.approve_contractor_application(uuid,text) to authenticated,service_role;

-- Restore customer capability only for active, approved contractor accounts.
-- Existing role history and primary workspace remain unchanged.
insert into public.customer_profiles(profile_id)
select p.id from public.profiles p
join public.contractor_profiles c on c.profile_id=p.id
where p.is_active and p.role='contractor' and c.approval_status='approved'
on conflict(profile_id) do nothing;
insert into public.user_roles(profile_id,role,is_primary)
select p.id,'customer',false from public.profiles p
join public.contractor_profiles c on c.profile_id=p.id
where p.is_active and p.role='contractor' and c.approval_status='approved'
on conflict(profile_id,role) where revoked_at is null do nothing;

commit;
