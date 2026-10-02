begin;

-- Approved professional accounts can buy while retaining their primary workspace.
create or replace function public.is_approved_professional_customer(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles profile where profile.id=p_profile_id and profile.is_active
    and (
      exists(select 1 from public.user_roles role join public.provider_members member on member.profile_id=role.profile_id and member.is_active join public.providers provider on provider.id=member.provider_id and provider.status='approved' where role.profile_id=profile.id and role.role='provider' and role.revoked_at is null)
      or exists(select 1 from public.user_roles role join public.contractor_profiles contractor on contractor.profile_id=role.profile_id and contractor.approval_status='approved' where role.profile_id=profile.id and role.role='contractor' and role.revoked_at is null)
    )
  );
$$;
revoke all on function public.is_approved_professional_customer(uuid) from public,anon,authenticated;

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
      temporary_password_expires_at = now() + interval '24 hours',
      password_changed_at = null,
      updated_at = now()
  where id = p_auth_user_id;

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

  insert into public.customer_profiles(profile_id) values(p_auth_user_id) on conflict(profile_id) do nothing;
  insert into public.user_roles(profile_id,role,is_primary,granted_by)
  values(p_auth_user_id,'customer',false,p_reviewer_id)
  on conflict(profile_id,role) where revoked_at is null do nothing;

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

create or replace function public.approve_provider_application(p_application_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.provider_applications%rowtype;
  v_provider_id uuid;
  v_admin_user_id uuid;
begin
  if not public.admin_has_permission('reviews.manage') or btrim(coalesce(p_reason,'')) = '' then raise exception 'Not authorized or missing reason'; end if;
  select * into v_application from public.provider_applications where id = p_application_id for update;
  if not found or v_application.status not in ('pending','needs_changes') or v_application.applicant_profile_id is null then raise exception 'Application is not approvable'; end if;
  select id into v_admin_user_id from public.admin_users where profile_id = auth.uid() and is_active;

  insert into public.providers (owner_profile_id, application_id, company_name, contact_name, mobile, email, google_maps_url, latitude, longitude, status, reviewed_by, reviewed_at, review_notes)
  values (v_application.applicant_profile_id, v_application.id, v_application.company_name, v_application.contact_name, v_application.mobile, lower(v_application.email), v_application.google_maps_url, v_application.latitude, v_application.longitude, 'approved', auth.uid(), now(), p_reason)
  returning id into v_provider_id;
  insert into public.provider_profiles (provider_id, username, delivery_available)
  values (v_provider_id, v_application.requested_username, v_application.delivery_available);
  insert into public.provider_members (provider_id, profile_id, member_role, is_active)
  values (v_provider_id, v_application.applicant_profile_id, 'owner', true);
  insert into public.user_roles (profile_id, role, is_primary, granted_by)
  values (v_application.applicant_profile_id, 'provider', false, auth.uid()) on conflict do nothing;
  insert into public.customer_profiles(profile_id) values(v_application.applicant_profile_id) on conflict(profile_id) do nothing;
  insert into public.user_roles(profile_id,role,is_primary,granted_by) values(v_application.applicant_profile_id,'customer',false,auth.uid()) on conflict(profile_id,role) where revoked_at is null do nothing;
  update public.provider_applications set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_reason where id=v_application.id;
  insert into public.join_request_reviews (admin_user_id, request_kind, request_id, outcome, reason)
  values (v_admin_user_id, 'provider', v_application.id, 'approved', p_reason);
  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values ('provider', v_provider_id, 'provider_application_approved', jsonb_build_object('application_id', v_application.id));
  return v_provider_id;
end;
$$;

create or replace function public.initialize_customer_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_verified_mobile text;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.profiles profile
       where profile.id = auth.uid() and profile.is_active
     ) then
    raise exception 'Authentication required';
  end if;

  select '+' || regexp_replace(account.phone, '[^0-9]', '', 'g')
  into v_verified_mobile
  from auth.users account
  where account.id = auth.uid()
    and account.phone is not null
    and account.phone_confirmed_at is not null;

  if v_verified_mobile is null or v_verified_mobile !~ '^\+9665[0-9]{8}$' then
    if not public.is_approved_professional_customer(auth.uid()) then
      raise exception 'Verified customer required';
    end if;
    v_verified_mobile := null;
  end if;

  update public.profiles
  set mobile = v_verified_mobile,
      updated_at = now()
  where id = auth.uid()
    and v_verified_mobile is not null
    and mobile is distinct from v_verified_mobile;

  insert into public.customer_profiles (profile_id)
  values (auth.uid())
  on conflict (profile_id) do nothing;

  insert into public.user_roles (profile_id, role, is_primary)
  select auth.uid(), 'customer',
    not exists (
      select 1 from public.user_roles existing
      where existing.profile_id = auth.uid()
        and existing.revoked_at is null
    )
  where not exists (
    select 1 from public.user_roles existing
    where existing.profile_id = auth.uid()
      and existing.role = 'customer'
      and existing.revoked_at is null
  );
end;
$$;

-- Add capability without changing cached/primary roles or revoked role history.
insert into public.customer_profiles(profile_id)
select id from public.profiles where public.is_approved_professional_customer(id)
on conflict(profile_id) do nothing;
insert into public.user_roles(profile_id,role,is_primary)
select id,'customer',false from public.profiles where public.is_approved_professional_customer(id)
on conflict(profile_id,role) where revoked_at is null do nothing;

-- A purchaser never receives their own supplier RFQ.
create or replace function public.match_rfq_providers(
  p_product_id uuid,
  p_city text,
  p_delivery_mode text
)
returns table(matched_provider_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested as (
    select id, sku, name, category_id, nullif(lower(btrim(custom_category)), '') as custom_category
    from public.products
    where id = p_product_id
  ), candidates as (
    select distinct provider.id
    from requested
    join public.products offered on offered.provider_id is not null
      and (
        offered.id = requested.id
        or (requested.sku is not null and offered.sku = requested.sku)
        or lower(btrim(offered.name)) = lower(btrim(requested.name))
        or (
          requested.category_id is not null
          and offered.category_id = requested.category_id
        )
        or (
          requested.category_id is null
          and requested.custom_category is not null
          and lower(btrim(offered.custom_category)) = requested.custom_category
        )
      )
    join public.providers provider on provider.id = offered.provider_id
    where provider.status = 'approved'
      and offered.is_published
      and offered.review_status = 'approved'
      and offered.availability_status = 'available'
      and (offered.stock_quantity is null or offered.stock_quantity > 0)
    union
    select distinct provider.id
    from public.provider_product_prices price
    join public.providers provider on provider.id = price.provider_id
      and provider.status = 'approved'
    where price.product_id = p_product_id
      and price.expires_at > now()
      and price.freshness_status in ('valid', 'expiring_soon')
  )
  select candidate.id from candidates candidate
  where not exists(select 1 from public.provider_members member where member.provider_id=candidate.id and member.profile_id=auth.uid() and member.is_active)
    and not exists(select 1 from public.providers owned where owned.id=candidate.id and owned.owner_profile_id=auth.uid());
$$;

create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_source uuid;
  v_source_item uuid;
  v_deadline timestamptz;
  v_required timestamptz;
  v_city text;
  v_count integer:=0;
  v_added integer;
  v_open timestamptz;
  v_start timestamptz;
  v_variant_selections jsonb;
  v_variant_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.customer_profiles customer join public.profiles profile on profile.id=customer.profile_id join public.user_roles role on role.profile_id=profile.id and role.role='customer' and role.revoked_at is null where profile.id=auth.uid() and profile.is_active) then raise exception 'Verified customer required';end if;
  if not public.has_verified_customer_identity(auth.uid()) then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key';end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid items';end if;
  if jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid items';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':rfq:'||p_idempotency_key,0));
  select aggregate_id into v_id from public.outbox_events where aggregate_type='quote_request' and idempotency_key='rfq:'||auth.uid()||':'||p_idempotency_key limit 1;
  if found then return v_id;end if;
  v_city:=btrim(p_request->>'city');v_required:=(p_request->>'desired_receipt_at')::timestamptz;
  select pricing_window.pricing_opens_at,pricing_window.pricing_countdown_starts_at,pricing_window.response_deadline_at into v_open,v_start,v_deadline from public.rfq_pricing_window(now()) pricing_window;
  v_deadline:=least(v_deadline,v_required-interval '1 hour');
  if length(v_city)<2 or v_required<=now()+interval '2 hours' or v_deadline<=now() then raise exception 'Invalid request schedule';end if;
  insert into public.quote_requests(request_code,requester_id,requester_role,city,location_hint,desired_receipt_at,quote_window_label,quote_deadline,pricing_opens_at,pricing_countdown_starts_at,notes,status,delivery_mode,project_name,recipient_name,recipient_mobile)
  values('RFQ-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),auth.uid(),'customer',v_city,btrim(coalesce(p_request->>'location_hint',v_city)),v_required,'3 ساعات تسعير · من 8 ص إلى 4 م بتوقيت الرياض',v_deadline,v_open,v_start,nullif(btrim(p_request->>'notes'),''),'submitted',case when p_request->>'delivery_mode'='pickup' then 'pickup' else 'delivery' end,nullif(btrim(p_request->>'project_name'),''),nullif(btrim(p_request->>'recipient_name'),''),nullif(btrim(p_request->>'recipient_mobile'),'')) returning id into v_id;
  insert into public.internal_sourcing_requests(internal_code,customer_request_id,stage,expected_ready_at,response_deadline_at)
  values('SRC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_id,'received',least(v_required,v_deadline+interval '2 hours'),v_deadline) returning id into v_source;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id:=null;
    v_item:=public.canonicalize_rfq_catalog_item(v_item);
    v_variant_selections:=v_item->'variant_selections';
    v_variant_label:=v_item->>'variant_label_snapshot';

    insert into public.quote_request_items(request_id,product_id,measurement_id,unit_id,product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes,variant_selections,variant_label_snapshot,product_specifications_snapshot)
    values(v_id,(v_item->>'product_id')::uuid,nullif(v_item->>'measurement_id','')::uuid,nullif(v_item->>'unit_id','')::uuid,v_item->>'product_name',nullif(btrim(v_item->>'measurement'),''),v_item->>'unit',(v_item->>'quantity')::numeric,nullif(btrim(v_item->>'notes'),''),v_variant_selections,nullif(v_variant_label,''),array(select jsonb_array_elements_text(v_item->'product_specifications_snapshot')))
    returning id into v_item_id;
    insert into public.internal_sourcing_request_items(sourcing_request_id,quote_request_item_id,product_id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at)
    select v_source,v_item_id,i.product_id,i.quantity,i.unit_name_snapshot,i.measurement_label_snapshot,v_city,v_required from public.quote_request_items i where i.id=v_item_id returning id into v_source_item;
    insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
    select v_source_item,matched_provider_id,v_deadline from public.match_rfq_providers((v_item->>'product_id')::uuid,v_city,coalesce(p_request->>'delivery_mode','delivery')) on conflict do nothing;
    get diagnostics v_added=row_count;v_count:=v_count+v_added;
  end loop;
  update public.quote_requests set status=(case when v_count>0 then 'sourcing' else 'verifying' end)::public.quote_request_status where id=v_id;
  update public.internal_sourcing_requests set stage=(case when v_count>0 then 'comparing_prices' else 'verifying_availability' end)::public.quote_processing_stage where id=v_source;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('quote_request',v_id,case when v_count>0 then 'rfq.submitted' else 'admin.rfq_no_providers' end,jsonb_build_object('sourcing_request_id',v_source),'rfq:'||auth.uid()||':'||p_idempotency_key);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select 'sourcing_target',target.sourcing_request_item_id,'provider.rfq_new',jsonb_build_object('provider_id',target.provider_id,'sourcing_item_id',target.sourcing_request_item_id),'rfq-target:'||target.sourcing_request_item_id||':'||target.provider_id from public.internal_sourcing_request_targets target join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id where item.sourcing_request_id=v_source on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return v_id;
end $$;

revoke all on function public.finalize_provider_application_approval(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_provider_application_approval(uuid,uuid,uuid,text) to service_role;
revoke all on function public.approve_provider_application(uuid,text) from public,anon;
grant execute on function public.approve_provider_application(uuid,text) to authenticated,service_role;
revoke all on function public.initialize_customer_account() from public,anon;
grant execute on function public.initialize_customer_account() to authenticated;
revoke all on function public.match_rfq_providers(uuid,text,text) from public,anon,authenticated;
revoke all on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;

commit;
