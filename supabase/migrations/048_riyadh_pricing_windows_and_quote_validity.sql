begin;

alter table public.quote_requests
  add column pricing_opens_at timestamptz,
  add column pricing_countdown_starts_at timestamptz;

create or replace function public.rfq_pricing_window(p_requested_at timestamptz)
returns table(pricing_opens_at timestamptz,pricing_countdown_starts_at timestamptz,response_deadline_at timestamptz)
language plpgsql
stable
set search_path=public,pg_temp
as $$
declare
  v_local timestamp:=p_requested_at at time zone 'Asia/Riyadh';
  v_day date:=v_local::date;
  v_time time:=v_local::time;
  v_open_local timestamp;
  v_start_local timestamp;
  v_close_local timestamp;
begin
  if v_time>=time '08:00' and v_time<=time '16:00' then
    v_open_local:=v_local;
    v_start_local:=v_local;
    v_close_local:=least(v_local+interval '3 hours',v_day+time '19:00');
  elsif v_time<time '08:00' then
    v_open_local:=greatest(v_local,v_day+time '06:00');
    v_start_local:=v_day+time '08:00';
    v_close_local:=v_day+time '11:00';
  else
    v_open_local:=(v_day+1)+time '06:00';
    v_start_local:=(v_day+1)+time '08:00';
    v_close_local:=(v_day+1)+time '11:00';
  end if;
  return query select
    v_open_local at time zone 'Asia/Riyadh',
    v_start_local at time zone 'Asia/Riyadh',
    v_close_local at time zone 'Asia/Riyadh';
end $$;

update public.quote_requests request set
  (pricing_opens_at,pricing_countdown_starts_at)=(
    select pricing_window.pricing_opens_at,pricing_window.pricing_countdown_starts_at
    from public.rfq_pricing_window(request.created_at) pricing_window
  );

alter table public.quote_requests
  alter column pricing_opens_at set not null,
  alter column pricing_countdown_starts_at set not null;

update public.quote_requests request set
  quote_window_label='3 ساعات تسعير · من 8 ص إلى 4 م بتوقيت الرياض',
  quote_deadline=least((select pricing_window.response_deadline_at from public.rfq_pricing_window(request.created_at) pricing_window),request.desired_receipt_at-interval '1 hour'),
  updated_at=now()
where request.status in ('submitted','sourcing','verifying')
  and least((select pricing_window.response_deadline_at from public.rfq_pricing_window(request.created_at) pricing_window),request.desired_receipt_at-interval '1 hour')>request.created_at;

update public.internal_sourcing_requests source set
  response_deadline_at=request.quote_deadline,
  updated_at=now()
from public.quote_requests request
where request.id=source.customer_request_id
  and request.status in ('submitted','sourcing','verifying');

update public.internal_sourcing_request_targets target set
  response_deadline_at=source.response_deadline_at
from public.internal_sourcing_request_items item
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
join public.quote_requests request on request.id=source.customer_request_id
where target.sourcing_request_item_id=item.id
  and request.status in ('submitted','sourcing','verifying');

create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid;v_item jsonb;v_item_id uuid;v_source uuid;v_source_item uuid;v_deadline timestamptz;v_required timestamptz;v_city text;v_count integer:=0;v_added integer;v_open timestamptz;v_start timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.customer_profiles where profile_id=auth.uid()) then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid items';end if;
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
end $$;

revoke execute on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;

create or replace function public.submit_provider_pricing_response(p_sourcing_item_id uuid,p_response jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_provider uuid;v_target public.internal_sourcing_request_targets%rowtype;v_id uuid;v_available boolean;v_qty numeric;v_expires timestamptz;v_opens timestamptz;
begin
  select p.id into v_provider from public.providers p where public.is_provider_member(p.id) and p.status='approved' limit 1;
  if v_provider is null then raise exception 'Approved provider required';end if;
  select target.* into v_target
  from public.internal_sourcing_request_targets target
  join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id
  join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
  join public.quote_requests request on request.id=source.customer_request_id
  where target.sourcing_request_item_id=p_sourcing_item_id and target.provider_id=v_provider for update of target;
  if not found then raise exception 'Target not found';end if;
  select request.pricing_opens_at into v_opens
  from public.internal_sourcing_request_items item
  join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
  join public.quote_requests request on request.id=source.customer_request_id
  where item.id=p_sourcing_item_id;
  if now()<v_opens then raise exception 'Pricing window not open';end if;
  if v_target.response_deadline_at<=now() then raise exception 'Response deadline expired';end if;
  if exists(select 1 from public.provider_pricing_responses where sourcing_request_item_id=p_sourcing_item_id and provider_id=v_provider) then raise exception 'Response already submitted';end if;
  if not coalesce((p_response->>'region_eligible')::boolean,false) then raise exception 'Delivery location review required';end if;
  v_available:=coalesce((p_response->>'available')::boolean,false);v_qty:=case when v_available then (p_response->>'available_quantity')::numeric else 0 end;v_expires:=(p_response->>'price_expires_at')::timestamptz;
  if coalesce((p_response->>'unit_price')::numeric,-1)<0 or v_qty<0 or v_expires<=now() or v_expires>now()+interval '72 hours' then raise exception 'Invalid response';end if;
  insert into public.provider_pricing_responses(response_code,sourcing_request_item_id,provider_id,receipt_confirmed_at,unit_price,vat_inclusive,price_confirmed_at,price_expires_at,internal_notes)
  values('RSP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_sourcing_item_id,v_provider,now(),(p_response->>'unit_price')::numeric,coalesce((p_response->>'vat_inclusive')::boolean,false),now(),v_expires,nullif(btrim(p_response->>'notes'),'')) returning id into v_id;
  insert into public.provider_availability_confirmations(pricing_response_id,available,available_quantity) values(v_id,v_available,v_qty);
  insert into public.provider_delivery_confirmations(pricing_response_id,region_eligible,preparation_duration_hours,delivery_duration_hours,delivery_fee) values(v_id,true,(p_response->>'preparation_hours')::numeric,(p_response->>'delivery_hours')::numeric,coalesce((p_response->>'delivery_fee')::numeric,0));
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('provider_response',v_id,'provider.rfq_responded',jsonb_build_object('sourcing_item_id',p_sourcing_item_id),'provider-response:'||v_id);
  return v_id;
end $$;

revoke execute on function public.submit_provider_pricing_response(uuid,jsonb) from public,anon;
grant execute on function public.submit_provider_pricing_response(uuid,jsonb) to authenticated;

create or replace function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_context jsonb;v_lowest_unit numeric;v_lowest_landed numeric;v_provider uuid;
begin
  select provider.id into v_provider from public.providers provider where public.is_provider_member(provider.id) limit 1;
  if v_provider is null or not exists (
    select 1 from public.internal_sourcing_request_targets target
    where target.sourcing_request_item_id=p_sourcing_item_id and target.provider_id=v_provider
  ) then raise exception 'Target not found';end if;

  select min(response.unit_price),
    min(case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
      else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end)
  into v_lowest_unit,v_lowest_landed
  from public.provider_pricing_responses response
  join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  join public.internal_sourcing_request_items item on item.id=response.sourcing_request_item_id
  where response.sourcing_request_item_id=p_sourcing_item_id and response.provider_id<>v_provider and response.price_expires_at>now()
    and availability.available and availability.available_quantity>=item.quantity and delivery.region_eligible
    and now()+make_interval(hours=>(delivery.preparation_duration_hours+delivery.delivery_duration_hours)::integer)<=item.required_at
  ;

  select jsonb_build_object(
    'sourcing_request_item_id',item.id,'response_deadline_at',target.response_deadline_at,
    'pricing_opens_at',request.pricing_opens_at,'pricing_countdown_starts_at',request.pricing_countdown_starts_at,
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
  join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id and target.provider_id=v_provider
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

create or replace function public.get_my_provider_rfq_list()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_provider uuid;v_result jsonb;
begin
  select provider.id into v_provider from public.providers provider where public.is_provider_member(provider.id) limit 1;
  if v_provider is null then return '[]'::jsonb;end if;
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.response_deadline_at),'[]'::jsonb) into v_result
  from (
    select target.sourcing_request_item_id,target.targeted_at,target.response_deadline_at,
      request.pricing_opens_at,request.pricing_countdown_starts_at,request.request_code,
      source.internal_code,item.quantity,item.unit_snapshot,item.measurement_snapshot,item.required_at,
      request_item.product_name_snapshot as product_name,request_item.notes as item_notes,
      product.sku as product_sku,coalesce(product.short_description,product.description) as product_description,
      image.storage_path as product_image_storage_path,image.image_url as product_image_url,
      competitor.unit_price as current_lowest_unit_price,competitor.landed_cost as current_lowest_landed_cost,
      own.response_code as existing_response_code,own.status as existing_response_status
    from public.internal_sourcing_request_targets target
    join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id
    join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
    join public.quote_requests request on request.id=source.customer_request_id
    join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
    join public.products product on product.id=item.product_id
    left join lateral (
      select product_image.storage_path,product_image.image_url from public.product_images product_image
      where product_image.product_id=product.id order by product_image.is_primary desc,product_image.sort_order,product_image.created_at limit 1
    ) image on true
    left join lateral (
      select min(response.unit_price) as unit_price,
        min(case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
          else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end) as landed_cost
      from public.provider_pricing_responses response
      join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
      join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
      where response.sourcing_request_item_id=item.id and response.provider_id<>v_provider and response.price_expires_at>now()
        and availability.available and availability.available_quantity>=item.quantity and delivery.region_eligible
        and now()+make_interval(hours=>(delivery.preparation_duration_hours+delivery.delivery_duration_hours)::integer)<=item.required_at
    ) competitor on true
    left join lateral (
      select response.response_code,response.status from public.provider_pricing_responses response
      where response.sourcing_request_item_id=item.id and response.provider_id=v_provider limit 1
    ) own on true
    where target.provider_id=v_provider
  ) row_data;
  return v_result;
end $$;

revoke all on function public.get_my_provider_rfq_list() from public,anon;
grant execute on function public.get_my_provider_rfq_list() to authenticated;

create or replace function public.assemble_bunya_customer_quote(p_sourcing_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_source public.internal_sourcing_requests%rowtype;v_item record;v_quote uuid;v_subtotal numeric;v_vat numeric;v_delivery numeric;v_expected timestamptz;
begin
  if not public.admin_has_permission('sourcing.manage') then raise exception 'Not authorized';end if;
  select * into v_source from public.internal_sourcing_requests where id=p_sourcing_request_id for update;
  if not found then raise exception 'Sourcing request not found';end if;
  if v_source.response_deadline_at>now() and exists(
    select 1 from public.internal_sourcing_request_items item
    join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id
    where item.sourcing_request_id=v_source.id
      and not exists(select 1 from public.provider_pricing_responses response where response.sourcing_request_item_id=target.sourcing_request_item_id and response.provider_id=target.provider_id)
  ) then raise exception 'Provider responses are still pending';end if;
  for v_item in select id from public.internal_sourcing_request_items where sourcing_request_id=v_source.id loop perform public.select_best_provider_price(v_item.id);end loop;
  if (select count(*) from public.selected_provider_items selected join public.internal_selection_results result on result.id=selected.selection_result_id where result.sourcing_request_id=v_source.id)<>(select count(*) from public.internal_sourcing_request_items where sourcing_request_id=v_source.id) then raise exception 'Not all items have eligible responses';end if;
  select round(sum(selected.subtotal),2),round(sum(selected.vat_amount),2),round(sum(selected.delivery_fee),2),max(item.required_at) into v_subtotal,v_vat,v_delivery,v_expected from public.selected_provider_items selected join public.internal_selection_results result on result.id=selected.selection_result_id join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id where result.sourcing_request_id=v_source.id;
  insert into public.bunya_customer_quotes(quote_code,customer_request_id,subtotal,vat_amount,delivery_fee,valid_until,expected_delivery_at,terms,status,processing_stage,expected_ready_at,ready_at)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,v_subtotal,v_vat,v_delivery,now()+interval '48 hours',v_expected,'Unified Bunya platform quote; provider details are private.','ready','sent_to_customer',v_source.expected_ready_at,now())
  on conflict(customer_request_id) do update set subtotal=excluded.subtotal,vat_amount=excluded.vat_amount,delivery_fee=excluded.delivery_fee,valid_until=excluded.valid_until,expected_delivery_at=excluded.expected_delivery_at,status='ready',processing_stage='sent_to_customer',ready_at=now(),updated_at=now() returning id into v_quote;
  delete from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote;
  insert into public.bunya_customer_quote_items(bunya_customer_quote_id,quote_request_item_id,product_id,product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,subtotal,vat_amount,delivery_fee)
  select v_quote,item.quote_request_item_id,item.product_id,request_item.product_name_snapshot,item.quantity,item.unit_snapshot,item.measurement_snapshot,selected.unit_price,selected.subtotal,selected.vat_amount,selected.delivery_fee from public.selected_provider_items selected join public.internal_selection_results result on result.id=selected.selection_result_id join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id join public.quote_request_items request_item on request_item.id=item.quote_request_item_id where result.sourcing_request_id=v_source.id;
  update public.internal_sourcing_requests set stage='sent_to_customer',updated_at=now(),completed_at=now() where id=v_source.id;
  update public.quote_requests set status='verifying'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id and status='sourcing';
  update public.quote_requests set status='quote_ready'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('customer_quote',v_quote,'customer.quote_ready','{}','quote-ready:'||v_quote) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data) values(auth.uid(),'bunya_customer_quotes',v_quote::text,'quote_assembled',jsonb_build_object('sourcing_request_id',v_source.id));
  return v_quote;
exception when others then
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('sourcing_request',p_sourcing_request_id,'admin.quote_assembly_failed','{}','quote-assembly-failed:'||p_sourcing_request_id||':'||extract(epoch from date_trunc('hour',now()))::bigint) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return null;
end $$;

update public.bunya_customer_quotes quote set
  valid_until=coalesce(quote.ready_at,quote.created_at)+interval '48 hours',
  updated_at=now()
where quote.status in ('ready','customer_review') and quote.valid_until>now();

commit;
