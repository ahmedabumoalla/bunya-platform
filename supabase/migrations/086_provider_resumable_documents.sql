begin;

alter table public.files drop constraint files_size_bytes_check;
alter table public.files add constraint files_size_bytes_check check (
  size_bytes > 0 and (size_bytes <= 52428800 or (purpose='provider_join_document' and bucket_id='join-applications'))
);

-- File bytes live in private object Storage, never in this metadata table.
create table public.provider_upload_batches (
  id uuid primary key,
  application_id uuid not null,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text not null check(binding_hash ~ '^[a-f0-9]{64}$'),
  revision_token_hash text,
  documents jsonb not null check(jsonb_typeof(documents)='array' and jsonb_array_length(documents)<=4),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz
);
alter table public.provider_upload_batches enable row level security;
revoke all on public.provider_upload_batches from public,anon,authenticated;
grant select,insert,update,delete on public.provider_upload_batches to service_role;
create index provider_upload_batches_expiration_idx on public.provider_upload_batches(expires_at) where committed_at is null;
create index provider_upload_batches_committed_idx on public.provider_upload_batches(committed_at) where committed_at is not null;

-- Storage bucket's optional application cap is removed through the Storage API
-- by scripts/configure-provider-upload-storage.mjs; privacy/MIME restrictions stay.
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
      or (d->>'size_bytes')::bigint <= 0 or d->>'size_bytes' is null then raise exception 'Invalid provider document'; end if;
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


-- Consume the upload capability and save the application in one transaction.
create or replace function public.commit_provider_join_upload(
  p_token_hash text,p_binding_hash text,p_fields jsonb,p_categories text[],p_regions text[],p_documents jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.provider_upload_batches%rowtype; result jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into b from public.provider_upload_batches where token_hash=p_token_hash for update;
  if not found or b.binding_hash is distinct from p_binding_hash then raise exception 'Invalid upload batch' using errcode='42501'; end if;
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

commit;
