begin;

-- Every verified platform identity can shop as a customer while retaining its
-- existing provider, contractor, or admin primary workspace.
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
    raise exception 'Verified customer required';
  end if;

  update public.profiles
  set mobile = v_verified_mobile,
      updated_at = now()
  where id = auth.uid()
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

revoke execute on function public.initialize_customer_account() from public, anon;
grant execute on function public.initialize_customer_account() to authenticated;

-- Repair already-verified accounts missed by the former role-aware path.
insert into public.customer_profiles (profile_id)
select profile.id
from public.profiles profile
join auth.users account on account.id = profile.id
where profile.is_active
  and account.phone is not null
  and account.phone_confirmed_at is not null
  and ('+' || regexp_replace(account.phone, '[^0-9]', '', 'g')) ~ '^\+9665[0-9]{8}$'
on conflict (profile_id) do nothing;

insert into public.user_roles (profile_id, role, is_primary)
select profile.id, 'customer',
  not exists (
    select 1 from public.user_roles active_role
    where active_role.profile_id = profile.id
      and active_role.revoked_at is null
  )
from public.profiles profile
join auth.users account on account.id = profile.id
where profile.is_active
  and account.phone is not null
  and account.phone_confirmed_at is not null
  and ('+' || regexp_replace(account.phone, '[^0-9]', '', 'g')) ~ '^\+9665[0-9]{8}$'
  and not exists (
    select 1 from public.user_roles customer_role
    where customer_role.profile_id = profile.id
      and customer_role.role = 'customer'
      and customer_role.revoked_at is null
  );

create or replace function public.submit_storefront_rfq(
  p_request jsonb,
  p_items jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_request_id uuid;
  v_maps_url text := btrim(coalesce(p_request ->> 'google_maps_url', ''));
  v_location_hint text := btrim(coalesce(p_request ->> 'location_hint', ''));
  v_recipient_name text := btrim(coalesce(p_request ->> 'recipient_name', ''));
  v_recipient_mobile text := btrim(coalesce(p_request ->> 'recipient_mobile', ''));
  v_responsible_name text := btrim(coalesce(p_request ->> 'site_responsible_name', ''));
  v_responsible_mobile text := btrim(coalesce(p_request ->> 'site_responsible_mobile', ''));
  v_working_hours text := btrim(coalesce(p_request ->> 'working_hours', ''));
  v_loading_option text := btrim(coalesce(p_request ->> 'loading_option', ''));
  v_unloading_option text := btrim(coalesce(p_request ->> 'unloading_option', ''));
  v_road_access text := btrim(coalesce(p_request ->> 'road_access', ''));
  v_access_instructions text := btrim(coalesce(p_request ->> 'access_instructions', ''));
  v_normalized_request jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  -- Repair the customer capability before the lower-level RFQ function checks it.
  perform public.initialize_customer_account();

  if v_maps_url = '' or v_maps_url !~* '^https?://([^/]*\.)?(google\.[^/]+/maps|maps\.google\.[^/]+|maps\.app\.goo\.gl|goo\.gl)/' then
    raise exception 'Valid Google Maps URL required';
  end if;
  if length(v_location_hint) < 3 then raise exception 'Delivery location description required'; end if;
  if length(v_recipient_name) < 2 or v_recipient_mobile !~ '^\+9665[0-9]{8}$' then
    raise exception 'Valid recipient contact required';
  end if;
  if length(v_responsible_name) < 2 or v_responsible_mobile !~ '^\+9665[0-9]{8}$' then
    raise exception 'Valid site responsible contact required';
  end if;
  if length(v_working_hours) < 3 or v_loading_option = '' or v_unloading_option = '' or v_road_access = '' or length(v_access_instructions) < 3 then
    raise exception 'Complete delivery and access details required';
  end if;
  if coalesce((p_request ->> 'driver_departure_liability_accepted')::boolean, false) is not true
    or coalesce((p_request ->> 'data_accuracy_accepted')::boolean, false) is not true then
    raise exception 'Delivery acknowledgements required';
  end if;

  v_normalized_request := p_request || jsonb_build_object(
    'city', 'موقع التسليم عبر Google Maps',
    'location_hint', v_location_hint,
    'recipient_name', v_recipient_name,
    'recipient_mobile', v_recipient_mobile
  );
  v_request_id := public.submit_customer_rfq(v_normalized_request, p_items, p_idempotency_key);

  update public.quote_requests
  set google_maps_url = v_maps_url,
      site_responsible_name = v_responsible_name,
      site_responsible_mobile = v_responsible_mobile,
      contractor_name = nullif(btrim(p_request ->> 'contractor_name'), ''),
      contractor_mobile = nullif(btrim(p_request ->> 'contractor_mobile'), ''),
      working_hours = v_working_hours,
      loading_option = v_loading_option,
      unloading_option = v_unloading_option,
      road_access = v_road_access,
      access_instructions = v_access_instructions,
      driver_departure_liability_accepted = true,
      data_accuracy_accepted = true,
      delivery_details_acknowledged_at = coalesce(delivery_details_acknowledged_at, now())
  where id = v_request_id and requester_id = auth.uid();

  return v_request_id;
end
$$;

revoke execute on function public.submit_storefront_rfq(jsonb,jsonb,text) from public, anon;
grant execute on function public.submit_storefront_rfq(jsonb,jsonb,text) to authenticated;

commit;
