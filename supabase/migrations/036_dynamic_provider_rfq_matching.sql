begin;

-- Match the modern provider-owned catalog first, while retaining support for
-- legacy shared catalog prices. Product equivalence is exact by SKU, or by
-- normalized name + category + base unit.
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
    select id, sku, name, category_id, custom_category, base_unit
    from public.products
    where id = p_product_id
  ), candidates as (
    select distinct provider.id
    from requested
    join public.products offered on offered.provider_id is not null
      and (
        offered.id = requested.id
        or (requested.sku is not null and offered.sku = requested.sku)
        or (
          lower(btrim(offered.name)) = lower(btrim(requested.name))
          and lower(btrim(offered.base_unit)) = lower(btrim(requested.base_unit))
          and coalesce(offered.category_id::text, lower(btrim(offered.custom_category)), '')
            = coalesce(requested.category_id::text, lower(btrim(requested.custom_category)), '')
        )
      )
    join public.providers provider on provider.id = offered.provider_id
    where provider.status = 'approved'
      and offered.is_published
      and offered.review_status = 'approved'
      and offered.availability_status = 'available'
      and (offered.stock_quantity is null or offered.stock_quantity > 0)
      and (
        p_delivery_mode = 'pickup'
        or exists (
          select 1 from public.product_availability_regions region
          where region.product_id = offered.id and lower(btrim(region.city)) = lower(btrim(p_city))
        )
        or exists (
          select 1 from public.provider_delivery_regions region
          where region.application_id = provider.application_id and lower(btrim(region.region_name)) = lower(btrim(p_city))
        )
      )
    union
    select distinct provider.id
    from public.provider_product_prices price
    join public.providers provider on provider.id = price.provider_id and provider.status = 'approved'
    where price.product_id = p_product_id
      and price.expires_at > now()
      and price.freshness_status in ('valid', 'expiring_soon')
      and (
        p_delivery_mode = 'pickup'
        or exists (
          select 1 from public.provider_delivery_regions region
          where region.application_id = provider.application_id and lower(btrim(region.region_name)) = lower(btrim(p_city))
        )
      )
  )
  select id from candidates;
$$;

revoke all on function public.match_rfq_providers(uuid,text,text) from public, anon, authenticated;

create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid;v_item jsonb;v_item_id uuid;v_source uuid;v_source_item uuid;v_deadline timestamptz;v_required timestamptz;v_city text;v_count integer:=0;v_added integer;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.customer_profiles where profile_id=auth.uid()) then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid items';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':rfq:'||p_idempotency_key,0));
  select aggregate_id into v_id from public.outbox_events where aggregate_type='quote_request' and idempotency_key='rfq:'||auth.uid()||':'||p_idempotency_key limit 1;
  if found then return v_id;end if;
  v_city:=btrim(p_request->>'city');v_required:=(p_request->>'desired_receipt_at')::timestamptz;v_deadline:=least(v_required-interval '1 hour',now()+interval '24 hours');
  if length(v_city)<2 or v_required<=now()+interval '2 hours' then raise exception 'Invalid request schedule';end if;
  insert into public.quote_requests(request_code,requester_id,requester_role,city,location_hint,desired_receipt_at,quote_window_label,quote_deadline,notes,status,delivery_mode,project_name,recipient_name,recipient_mobile)
  values('RFQ-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),auth.uid(),'customer',v_city,btrim(coalesce(p_request->>'location_hint',v_city)),v_required,'24 hours',v_deadline,nullif(btrim(p_request->>'notes'),''),'submitted',case when p_request->>'delivery_mode'='pickup' then 'pickup' else 'delivery' end,nullif(btrim(p_request->>'project_name'),''),nullif(btrim(p_request->>'recipient_name'),''),nullif(btrim(p_request->>'recipient_mobile'),'')) returning id into v_id;
  insert into public.internal_sourcing_requests(internal_code,customer_request_id,stage,expected_ready_at,response_deadline_at)
  values('SRC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_id,'received',least(v_required,now()+interval '48 hours'),v_deadline) returning id into v_source;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Invalid item quantity';end if;
    insert into public.quote_request_items(request_id,product_id,measurement_id,unit_id,product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes)
    select v_id,p.id,nullif(v_item->>'measurement_id','')::uuid,nullif(v_item->>'unit_id','')::uuid,p.name,nullif(btrim(v_item->>'measurement'),''),coalesce(nullif(btrim(v_item->>'unit'),''),p.base_unit),(v_item->>'quantity')::numeric,nullif(btrim(v_item->>'notes'),'') from public.products p where p.id=(v_item->>'product_id')::uuid and p.is_published and p.review_status='approved' returning id into v_item_id;
    if v_item_id is null then raise exception 'Product is not available';end if;
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
end
$$;

revoke execute on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;

-- Sanitized provider-facing request context. Competitor identities are never returned.
create or replace function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_context jsonb;v_lowest_unit numeric;v_lowest_landed numeric;
begin
  if not exists (
    select 1 from public.internal_sourcing_request_targets target
    where target.sourcing_request_item_id=p_sourcing_item_id and public.is_provider_member(target.provider_id)
  ) then raise exception 'Target not found';end if;

  select response.unit_price,
    case when response.vat_inclusive
      then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
      else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee
    end
  into v_lowest_unit,v_lowest_landed
  from public.provider_pricing_responses response
  join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  join public.internal_sourcing_request_items item on item.id=response.sourcing_request_item_id
  where response.sourcing_request_item_id=p_sourcing_item_id
    and response.price_expires_at>now() and availability.available and availability.available_quantity>=item.quantity
    and delivery.region_eligible
    and now()+make_interval(hours=>(delivery.preparation_duration_hours+delivery.delivery_duration_hours)::integer)<=item.required_at
  order by case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end,response.receipt_confirmed_at,response.id
  limit 1;

  select jsonb_build_object(
    'sourcing_request_item_id',item.id,'response_deadline_at',target.response_deadline_at,
    'product_name',request_item.product_name_snapshot,'quantity',item.quantity,'unit_snapshot',item.unit_snapshot,
    'measurement_snapshot',item.measurement_snapshot,'item_notes',request_item.notes,'delivery_region',item.delivery_region,
    'required_at',item.required_at,'location_hint',request.location_hint,'google_maps_url',request.google_maps_url,
    'delivery_mode',request.delivery_mode,'request_notes',request.notes,
    'current_lowest_unit_price',v_lowest_unit,'current_lowest_landed_cost',v_lowest_landed
  ) into v_context
  from public.internal_sourcing_request_items item
  join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id and public.is_provider_member(target.provider_id)
  join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
  join public.internal_sourcing_requests sourcing on sourcing.id=item.sourcing_request_id
  join public.quote_requests request on request.id=sourcing.customer_request_id
  where item.id=p_sourcing_item_id limit 1;
  return v_context;
end $$;

revoke all on function public.get_provider_rfq_context(uuid) from public,anon;
grant execute on function public.get_provider_rfq_context(uuid) to authenticated;

-- Repair recent requests that were skipped by the legacy matcher and give their
-- newly targeted providers a fresh response window.
insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
select item.id,match.matched_provider_id,greatest(source.response_deadline_at,now()+interval '24 hours')
from public.internal_sourcing_request_items item
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
join public.quote_requests request on request.id=source.customer_request_id
cross join lateral public.match_rfq_providers(item.product_id,request.city,request.delivery_mode) match
where request.created_at>=now()-interval '24 hours' and request.status in ('submitted','sourcing','verifying')
on conflict do nothing;

update public.internal_sourcing_requests source set
  stage='comparing_prices',response_deadline_at=greatest(source.response_deadline_at,now()+interval '24 hours'),updated_at=now()
where source.created_at>=now()-interval '24 hours' and exists (
  select 1 from public.internal_sourcing_request_items item join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id
  where item.sourcing_request_id=source.id
);

insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
select 'sourcing_target',target.sourcing_request_item_id,'provider.rfq_new',jsonb_build_object('provider_id',target.provider_id,'sourcing_item_id',target.sourcing_request_item_id),'rfq-target:'||target.sourcing_request_item_id||':'||target.provider_id
from public.internal_sourcing_request_targets target
join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
where source.created_at>=now()-interval '24 hours'
on conflict(idempotency_key) where idempotency_key is not null do nothing;

commit;
