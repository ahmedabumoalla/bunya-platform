begin;

alter table public.provider_pricing_responses
  add column revision_invited_at timestamptz,
  add column revision_deadline_at timestamptz,
  add column current_competitor_unit_price numeric(14,2),
  add column current_competitor_landed_cost numeric(14,2),
  add column revision_count integer not null default 0 check (revision_count >= 0),
  add constraint provider_revision_window_valid check (
    revision_deadline_at is null or revision_invited_at is not null and revision_deadline_at > revision_invited_at
  );

create table public.provider_pricing_response_revisions (
  id uuid primary key default gen_random_uuid(),
  pricing_response_id uuid not null references public.provider_pricing_responses(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  previous_unit_price numeric(14,2) not null,
  previous_vat_inclusive boolean not null,
  previous_delivery_fee numeric(14,2) not null,
  new_unit_price numeric(14,2) not null,
  new_vat_inclusive boolean not null,
  new_delivery_fee numeric(14,2) not null,
  competitor_landed_cost numeric(14,2),
  revised_at timestamptz not null default now(),
  unique(pricing_response_id,revision_number)
);

alter table public.provider_pricing_response_revisions enable row level security;
create policy provider_pricing_revisions_owner_read on public.provider_pricing_response_revisions
for select to authenticated using (
  exists (
    select 1 from public.provider_pricing_responses response
    where response.id=pricing_response_id and public.is_provider_member(response.provider_id)
  ) or public.is_admin()
);

create or replace function public.invite_outbid_provider_responses(p_sourcing_item_id uuid,p_bidder_provider_id uuid)
returns void
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_bidder_unit numeric;
  v_bidder_landed numeric;
  v_deadline timestamptz;
  v_outbid record;
  v_outbox_id uuid;
begin
  select bidder.unit_price,
    case when bidder.vat_inclusive then round(item.quantity*bidder.unit_price,2)+bidder_delivery.delivery_fee
      else round(item.quantity*bidder.unit_price*1.15,2)+bidder_delivery.delivery_fee end,
    target.response_deadline_at
  into v_bidder_unit,v_bidder_landed,v_deadline
  from public.provider_pricing_responses bidder
  join public.provider_delivery_confirmations bidder_delivery on bidder_delivery.pricing_response_id=bidder.id
  join public.internal_sourcing_request_items item on item.id=bidder.sourcing_request_item_id
  join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id and target.provider_id=bidder.provider_id
  where bidder.sourcing_request_item_id=p_sourcing_item_id and bidder.provider_id=p_bidder_provider_id;

  if v_bidder_landed is null or v_deadline<=now() then return;end if;

  for v_outbid in
    select response.id,response.provider_id,provider.owner_profile_id,
      case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
        else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end as landed_cost
    from public.provider_pricing_responses response
    join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
    join public.internal_sourcing_request_items item on item.id=response.sourcing_request_item_id
    join public.providers provider on provider.id=response.provider_id
    where response.sourcing_request_item_id=p_sourcing_item_id
      and response.provider_id<>p_bidder_provider_id
      and response.status in ('evaluating','needs_update')
      and response.price_expires_at>now()
      and (case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
        else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end)>v_bidder_landed
      and (response.current_competitor_landed_cost is null or v_bidder_landed<response.current_competitor_landed_cost)
  loop
    update public.provider_pricing_responses set
      revision_invited_at=now(),revision_deadline_at=v_deadline,
      current_competitor_unit_price=v_bidder_unit,current_competitor_landed_cost=v_bidder_landed,
      updated_at=now()
    where id=v_outbid.id;

    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values('sourcing_target',p_sourcing_item_id,'provider.rfq_outbid',jsonb_build_object(
      'provider_id',v_outbid.provider_id,'sourcing_item_id',p_sourcing_item_id,
      'competitor_unit_price',v_bidder_unit,'competitor_landed_cost',v_bidder_landed,'revision_deadline_at',v_deadline
    ),'rfq-outbid:'||v_outbid.id||':'||v_bidder_landed)
    on conflict(idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key
    returning id into v_outbox_id;

    perform set_config('bunya.internal_notification_write','on',true);
    insert into public.notifications(profile_id,type,title,message,action_url,entity_type,entity_id,metadata,expires_at,event_key)
    values(
      v_outbid.owner_profile_id,'provider.rfq_outbid','وصل سعر أقل للمنتج',
      'وصل سعر منافس أقل. عرضك محفوظ ومقفل، ويمكنك اختيار تخفيضه قبل انتهاء المنافسة.',
      '/merchant/quote-requests/'||p_sourcing_item_id,'sourcing_item',p_sourcing_item_id,
      jsonb_build_object('competitor_unit_price',v_bidder_unit,'competitor_landed_cost',v_bidder_landed,'revision_deadline_at',v_deadline),v_deadline,
      'outbox-'||v_outbox_id||'-'||v_outbid.owner_profile_id
    ) on conflict(event_key) where event_key is not null do nothing;
    perform set_config('bunya.internal_notification_write','off',true);
  end loop;
end
$$;

revoke all on function public.invite_outbid_provider_responses(uuid,uuid) from public,anon,authenticated;

create or replace function public.submit_provider_pricing_response(p_sourcing_item_id uuid,p_response jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_provider uuid;v_target public.internal_sourcing_request_targets%rowtype;v_id uuid;v_available boolean;v_qty numeric;v_expires timestamptz;v_opens timestamptz;
begin
  select p.id into v_provider from public.providers p where public.is_provider_member(p.id) and p.status='approved' limit 1;
  if v_provider is null then raise exception 'Approved provider required';end if;
  select target.* into v_target
  from public.internal_sourcing_request_targets target
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
  perform public.invite_outbid_provider_responses(p_sourcing_item_id,v_provider);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('provider_response',v_id,'provider.rfq_responded',jsonb_build_object('sourcing_item_id',p_sourcing_item_id),'provider-response:'||v_id);
  return v_id;
end $$;

revoke execute on function public.submit_provider_pricing_response(uuid,jsonb) from public,anon;
grant execute on function public.submit_provider_pricing_response(uuid,jsonb) to authenticated;

create or replace function public.revise_provider_pricing_response(p_sourcing_item_id uuid,p_response jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_provider uuid;v_response public.provider_pricing_responses%rowtype;v_item public.internal_sourcing_request_items%rowtype;
  v_old_delivery numeric;v_old_landed numeric;v_new_landed numeric;v_new_unit numeric;v_new_delivery numeric;
  v_available boolean;v_qty numeric;v_expires timestamptz;v_vat boolean;
begin
  select provider.id into v_provider from public.providers provider where public.is_provider_member(provider.id) and provider.status='approved' limit 1;
  if v_provider is null then raise exception 'Approved provider required';end if;
  select response.* into v_response from public.provider_pricing_responses response
  where response.sourcing_request_item_id=p_sourcing_item_id and response.provider_id=v_provider for update;
  if not found then raise exception 'Response not found';end if;
  if v_response.revision_deadline_at is null or v_response.revision_deadline_at<=now() then raise exception 'Price revision is not available';end if;
  select item.* into v_item from public.internal_sourcing_request_items item where item.id=p_sourcing_item_id;
  select delivery.delivery_fee into v_old_delivery from public.provider_delivery_confirmations delivery where delivery.pricing_response_id=v_response.id;
  v_new_unit:=coalesce((p_response->>'unit_price')::numeric,-1);v_new_delivery:=coalesce((p_response->>'delivery_fee')::numeric,0);v_vat:=coalesce((p_response->>'vat_inclusive')::boolean,false);
  v_old_landed:=case when v_response.vat_inclusive then round(v_item.quantity*v_response.unit_price,2)+v_old_delivery else round(v_item.quantity*v_response.unit_price*1.15,2)+v_old_delivery end;
  v_new_landed:=case when v_vat then round(v_item.quantity*v_new_unit,2)+v_new_delivery else round(v_item.quantity*v_new_unit*1.15,2)+v_new_delivery end;
  if v_new_unit<0 or v_new_delivery<0 or v_new_landed>=v_old_landed then raise exception 'Revised landed cost must be lower than your saved offer';end if;
  if not coalesce((p_response->>'region_eligible')::boolean,false) then raise exception 'Delivery location review required';end if;
  v_available:=coalesce((p_response->>'available')::boolean,false);v_qty:=case when v_available then (p_response->>'available_quantity')::numeric else 0 end;v_expires:=(p_response->>'price_expires_at')::timestamptz;
  if v_qty<0 or v_expires<=now() or v_expires>now()+interval '72 hours' then raise exception 'Invalid response';end if;

  insert into public.provider_pricing_response_revisions(pricing_response_id,revision_number,previous_unit_price,previous_vat_inclusive,previous_delivery_fee,new_unit_price,new_vat_inclusive,new_delivery_fee,competitor_landed_cost)
  values(v_response.id,v_response.revision_count+1,v_response.unit_price,v_response.vat_inclusive,v_old_delivery,v_new_unit,v_vat,v_new_delivery,v_response.current_competitor_landed_cost);

  update public.provider_pricing_responses set unit_price=v_new_unit,vat_inclusive=v_vat,price_confirmed_at=now(),price_expires_at=v_expires,
    internal_notes=nullif(btrim(p_response->>'notes'),''),status='evaluating',revision_invited_at=null,revision_deadline_at=null,
    current_competitor_unit_price=null,current_competitor_landed_cost=null,revision_count=revision_count+1,updated_at=now()
  where id=v_response.id;
  update public.provider_availability_confirmations set available=v_available,available_quantity=v_qty,confirmed_at=now() where pricing_response_id=v_response.id;
  update public.provider_delivery_confirmations set region_eligible=true,preparation_duration_hours=(p_response->>'preparation_hours')::numeric,
    delivery_duration_hours=(p_response->>'delivery_hours')::numeric,delivery_fee=v_new_delivery,confirmed_at=now() where pricing_response_id=v_response.id;
  perform public.invite_outbid_provider_responses(p_sourcing_item_id,v_provider);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('provider_response',v_response.id,'provider.rfq_responded',jsonb_build_object('sourcing_item_id',p_sourcing_item_id,'revision_count',v_response.revision_count+1),'provider-revision:'||v_response.id||':'||(v_response.revision_count+1));
  return v_response.id;
end
$$;

revoke all on function public.revise_provider_pricing_response(uuid,jsonb) from public,anon;
grant execute on function public.revise_provider_pricing_response(uuid,jsonb) to authenticated;

create or replace function public.get_my_provider_rfq_response(p_sourcing_item_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',response.id,'response_code',response.response_code,'status',response.status,
    'unit_price',response.unit_price,'vat_inclusive',response.vat_inclusive,
    'price_expires_at',response.price_expires_at,'notes',response.internal_notes,
    'available',availability.available,'available_quantity',availability.available_quantity,
    'region_eligible',delivery.region_eligible,'preparation_hours',delivery.preparation_duration_hours,
    'delivery_hours',delivery.delivery_duration_hours,'delivery_fee',delivery.delivery_fee,
    'submitted_at',response.receipt_confirmed_at,'revision_count',response.revision_count,
    'revision_invited_at',response.revision_invited_at,'revision_deadline_at',response.revision_deadline_at,
    'current_competitor_unit_price',response.current_competitor_unit_price,
    'current_competitor_landed_cost',response.current_competitor_landed_cost,
    'can_revise',response.revision_deadline_at>now()
  )
  from public.provider_pricing_responses response
  left join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  left join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  where response.sourcing_request_item_id=p_sourcing_item_id and public.is_provider_member(response.provider_id)
  order by response.receipt_confirmed_at desc,response.id limit 1
$$;

revoke all on function public.get_my_provider_rfq_response(uuid) from public,anon;
grant execute on function public.get_my_provider_rfq_response(uuid) to authenticated;

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
      own.response_code as existing_response_code,own.status as existing_response_status,
      own.unit_price as existing_unit_price,own.delivery_fee as existing_delivery_fee,
      own.revision_count,own.revision_deadline_at,own.current_competitor_landed_cost,own.can_revise
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
      select response.response_code,response.status,response.unit_price,delivery.delivery_fee,response.revision_count,
        response.revision_deadline_at,response.current_competitor_landed_cost,response.revision_deadline_at>now() as can_revise
      from public.provider_pricing_responses response
      left join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
      where response.sourcing_request_item_id=item.id and response.provider_id=v_provider limit 1
    ) own on true
    where target.provider_id=v_provider
  ) row_data;
  return v_result;
end $$;

revoke all on function public.get_my_provider_rfq_list() from public,anon;
grant execute on function public.get_my_provider_rfq_list() to authenticated;

commit;
