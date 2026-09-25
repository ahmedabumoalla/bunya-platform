begin;

alter table public.quote_requests
  add column site_responsible_name text,
  add column site_responsible_mobile text,
  add column contractor_name text,
  add column contractor_mobile text,
  add column working_hours text,
  add column loading_option text,
  add column unloading_option text,
  add column road_access text,
  add column access_instructions text,
  add column driver_departure_liability_accepted boolean not null default false,
  add column data_accuracy_accepted boolean not null default false,
  add column delivery_details_acknowledged_at timestamptz;

alter table public.quote_requests
  add constraint quote_requests_delivery_ack_consistency check (
    (driver_departure_liability_accepted and data_accuracy_accepted and delivery_details_acknowledged_at is not null)
    or
    (not driver_departure_liability_accepted and not data_accuracy_accepted and delivery_details_acknowledged_at is null)
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

create or replace function public.enforce_quote_delivery_acknowledgements()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.customer_quote_id is not null and not exists (
    select 1
    from public.bunya_customer_quotes quote
    join public.quote_requests request on request.id = quote.customer_request_id
    where quote.id = new.customer_quote_id
      and request.google_maps_url is not null
      and request.site_responsible_name is not null
      and request.site_responsible_mobile is not null
      and request.working_hours is not null
      and request.loading_option is not null
      and request.unloading_option is not null
      and request.road_access is not null
      and request.access_instructions is not null
      and request.driver_departure_liability_accepted
      and request.data_accuracy_accepted
      and request.delivery_details_acknowledged_at is not null
  ) then
    raise exception 'Complete delivery details and customer acknowledgements are required before accepting the quote';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_quote_delivery_acknowledgements() from public, anon, authenticated;

drop trigger if exists orders_enforce_quote_delivery_acknowledgements on public.orders;
create trigger orders_enforce_quote_delivery_acknowledgements
before insert on public.orders
for each row execute function public.enforce_quote_delivery_acknowledgements();

create or replace function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_context jsonb;v_lowest_unit numeric;v_lowest_landed numeric;
begin
  if not exists (
    select 1 from public.internal_sourcing_request_targets target
    where target.sourcing_request_item_id=p_sourcing_item_id and public.is_provider_member(target.provider_id)
  ) then raise exception 'Target not found';end if;

  select response.unit_price,
    case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
      else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end
  into v_lowest_unit,v_lowest_landed
  from public.provider_pricing_responses response
  join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  join public.internal_sourcing_request_items item on item.id=response.sourcing_request_item_id
  where response.sourcing_request_item_id=p_sourcing_item_id and response.price_expires_at>now()
    and availability.available and availability.available_quantity>=item.quantity and delivery.region_eligible
    and now()+make_interval(hours=>(delivery.preparation_duration_hours+delivery.delivery_duration_hours)::integer)<=item.required_at
  order by case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end,response.receipt_confirmed_at,response.id
  limit 1;

  select jsonb_build_object(
    'sourcing_request_item_id',item.id,'response_deadline_at',target.response_deadline_at,
    'request_code',request.request_code,'internal_code',sourcing.internal_code,
    'product_id',product.id,'product_name',request_item.product_name_snapshot,'product_sku',product.sku,
    'product_description',coalesce(product.short_description,product.description),
    'product_image_storage_path',image.storage_path,'product_image_url',image.image_url,
    'quantity',item.quantity,'unit_snapshot',item.unit_snapshot,'measurement_snapshot',item.measurement_snapshot,
    'item_notes',request_item.notes,'delivery_region',item.delivery_region,'required_at',item.required_at,
    'location_hint',request.location_hint,'google_maps_url',request.google_maps_url,
    'delivery_mode',request.delivery_mode,'request_notes',request.notes,
    'recipient_name',request.recipient_name,'recipient_mobile',request.recipient_mobile,
    'site_responsible_name',request.site_responsible_name,'site_responsible_mobile',request.site_responsible_mobile,
    'contractor_name',request.contractor_name,'contractor_mobile',request.contractor_mobile,
    'working_hours',request.working_hours,'loading_option',request.loading_option,
    'unloading_option',request.unloading_option,'road_access',request.road_access,
    'access_instructions',request.access_instructions,
    'current_lowest_unit_price',v_lowest_unit,'current_lowest_landed_cost',v_lowest_landed
  ) into v_context
  from public.internal_sourcing_request_items item
  join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id and public.is_provider_member(target.provider_id)
  join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
  join public.products product on product.id=item.product_id
  join public.internal_sourcing_requests sourcing on sourcing.id=item.sourcing_request_id
  join public.quote_requests request on request.id=sourcing.customer_request_id
  left join lateral (
    select product_image.storage_path,product_image.image_url from public.product_images product_image
    where product_image.product_id=product.id order by product_image.is_primary desc,product_image.sort_order,product_image.created_at limit 1
  ) image on true
  where item.id=p_sourcing_item_id limit 1;
  return v_context;
end $$;

revoke all on function public.get_provider_rfq_context(uuid) from public,anon;
grant execute on function public.get_provider_rfq_context(uuid) to authenticated;

commit;
