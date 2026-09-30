begin;

-- Onboarding mutations go through server workflows. Public clients retain their
-- existing read policies and their separate profile-only document permissions.
create or replace function public.guard_contractor_onboarding_mutation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if current_user not in ('postgres','service_role') then
    if tg_table_name='contractor_applications' then
      raise exception 'Contractor onboarding mutations require server workflow' using errcode='42501';
    elsif (tg_op<>'INSERT' and old.application_id is not null)
      or (tg_op<>'DELETE' and new.application_id is not null) then
      raise exception 'Contractor onboarding mutations require server workflow' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_contractor_onboarding_mutation() from public,anon,authenticated;
create trigger contractor_join_client_guard before insert or update or delete on public.contractor_applications
  for each row execute function public.guard_contractor_onboarding_mutation();
create trigger contractor_document_client_guard before insert or update or delete on public.contractor_documents
  for each row execute function public.guard_contractor_onboarding_mutation();

-- Both approval entrypoints insert a profile. Validate at that shared boundary,
-- including requests created by older clients before this guard was installed.
create or replace function public.copy_contractor_join_details()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.contractor_applications%rowtype; v_document_count integer;
begin
  if new.application_id is null then return new; end if;
  select * into a from public.contractor_applications where id=new.application_id for update;
  new.contractor_type:=a.contractor_type;
  new.display_name_en:=a.contractor_name_en;
  new.contact_name:=a.contact_name;
  new.username:=a.requested_username;
  -- Untyped, unstamped legacy requests retain their original approval behavior.
  if a.contractor_type is null and a.joining_policy_id is null then return new; end if;
  if a.contractor_type is null or a.contractor_type not in ('company','individual')
    or a.joining_policy_id is null or a.joining_policy_accepted_at is null
    or a.joining_policy_updated_at is null or a.joining_policy_version is null or a.joining_policy_version<1
    or nullif(btrim(a.joining_policy_title),'') is null
    or jsonb_typeof(a.joining_policy_body) is distinct from 'array' or jsonb_array_length(a.joining_policy_body)=0
    or not exists(select 1 from jsonb_array_elements_text(a.joining_policy_body) paragraph where btrim(paragraph)<>'')
    or not exists(select 1 from public.platform_policies where id=a.joining_policy_id and policy_key='contractor-join') then
    raise exception 'Valid contractor policy acceptance is required for approval' using errcode='23514';
  end if;
  -- Acceptance is an immutable snapshot: publishing a newer policy does not
  -- silently invalidate an earlier, reviewed application.
  if (select count(*) from public.contractor_specialties where application_id=a.id) not between 1 and 30
    or exists(select 1 from public.contractor_specialties where application_id=a.id and char_length(btrim(specialty_name)) not between 2 and 100)
    or (select count(*) from public.contractor_work_regions where application_id=a.id) not between 1 and 50
    or exists(select 1 from public.contractor_work_regions where application_id=a.id and char_length(btrim(region_name)) not between 2 and 100) then
    raise exception 'Valid contractor specialties and service cities are required for approval' using errcode='23514';
  end if;
  select count(*) into v_document_count from public.contractor_documents where application_id=a.id and is_current;
  if v_document_count>24 or exists(
    select 1 from public.contractor_documents d where d.application_id=a.id and d.is_current and (
      d.document_type is null or d.document_key is null
      or d.storage_path not like 'join-applications/contractor/'||a.id::text||'/%' or d.storage_path ~ '(^|/)\.\.(/|$)'
      or (a.contractor_type='company' and d.document_type not in ('commercial_registration','municipal_license','national_address','vat_certificate','company_profile'))
      or (a.contractor_type='individual' and d.document_type not in ('national_id','portfolio'))
      or (d.document_type<>'portfolio' and (d.document_key<>d.document_type or d.mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')))
      or (d.document_type='portfolio' and (d.document_key !~ '^portfolio_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or d.mime_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime')))
    )
  ) then raise exception 'Invalid contractor documents for approval' using errcode='23514'; end if;
  if a.contractor_type='company' and (select count(distinct document_type) from public.contractor_documents where application_id=a.id and is_current and document_type in ('commercial_registration','municipal_license','national_address','vat_certificate'))<>4 then
    raise exception 'All four company documents are required for approval' using errcode='23514';
  end if;
  if a.contractor_type='individual' and (
    not exists(select 1 from public.contractor_documents where application_id=a.id and is_current and document_type='national_id')
    or (select count(*) from public.contractor_documents where application_id=a.id and is_current and document_type='portfolio') not between 1 and 20
  ) then raise exception 'National ID and 1 to 20 portfolio files are required for approval' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.copy_contractor_join_details() from public,anon,authenticated;

commit;
