begin;

-- A Google Maps URL is the delivery-location source of truth. Target providers
-- by the products they can supply; each provider confirms route suitability
-- after reviewing the exact map and handover instructions.
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
    union
    select distinct provider.id
    from public.provider_product_prices price
    join public.providers provider on provider.id = price.provider_id
      and provider.status = 'approved'
    where price.product_id = p_product_id
      and price.expires_at > now()
      and price.freshness_status in ('valid', 'expiring_soon')
  )
  select id from candidates;
$$;

revoke all on function public.match_rfq_providers(uuid,text,text) from public, anon, authenticated;

-- A request can return to sourcing when a previously unmatched product gains
-- eligible providers (including this migration's repair pass).
create or replace function public.validate_quote_request_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('submitted','cancelled')) or
    (old.status = 'submitted' and new.status in ('sourcing','verifying','rejected','cancelled')) or
    (old.status = 'sourcing' and new.status in ('verifying','expired','cancelled')) or
    (old.status = 'verifying' and new.status in ('sourcing','quote_ready','rejected','expired','cancelled')) or
    (old.status = 'quote_ready' and new.status in ('customer_review','accepted','rejected','expired','cancelled')) or
    (old.status = 'customer_review' and new.status in ('accepted','rejected','expired','cancelled'))
  ) then raise exception 'Invalid quote request status transition: % -> %', old.status, new.status; end if;
  return new;
end;
$$;

-- The delivery review is enforced server-side so clients cannot submit a
-- price/availability confirmation without explicitly accepting it.
create or replace function public.submit_provider_pricing_response(p_sourcing_item_id uuid,p_response jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_provider uuid;v_target public.internal_sourcing_request_targets%rowtype;v_id uuid;v_available boolean;v_qty numeric;v_expires timestamptz;
begin
  select p.id into v_provider from public.providers p where public.is_provider_member(p.id) and p.status='approved' limit 1;
  if v_provider is null then raise exception 'Approved provider required';end if;
  select * into v_target from public.internal_sourcing_request_targets where sourcing_request_item_id=p_sourcing_item_id and provider_id=v_provider for update;
  if not found then raise exception 'Target not found';end if;if v_target.response_deadline_at<=now() then raise exception 'Response deadline expired';end if;
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

-- Create the in-app alert in the same transaction as a new RFQ target. The
-- asynchronous dispatcher uses the same event key, so WhatsApp/native delivery
-- remains retryable without duplicating the in-app notification.
create or replace function public.notify_provider_rfq_target_in_app()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid;v_product text;v_code text;
begin
  if new.event_type <> 'provider.rfq_new' then return new;end if;
  select provider.owner_profile_id,request_item.product_name_snapshot,source.internal_code
  into v_owner,v_product,v_code
  from public.providers provider
  join public.internal_sourcing_request_items item on item.id=new.aggregate_id
  join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
  join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
  where provider.id=nullif(new.payload->>'provider_id','')::uuid;
  if v_owner is null then return new;end if;
  perform set_config('bunya.internal_notification_write', 'on', true);
  insert into public.notifications(profile_id,type,title,message,action_url,entity_type,entity_id,event_key)
  values(
    v_owner,
    'provider.rfq_new',
    'طلب تسعير جديد',
    'طلب '||coalesce(v_code,'—')||' للمنتج '||coalesce(v_product,'—')||'. تنبيه: افتح رابط Google Maps وراجع موقع التسليم ومسار الوصول بعناية قبل اعتماد السعر والتوفر.',
    '/merchant/quote-requests/'||new.aggregate_id,
    'provider.rfq_new',
    new.aggregate_id,
    'outbox-'||new.id||'-'||v_owner
  ) on conflict(event_key) where event_key is not null do nothing;
  perform set_config('bunya.internal_notification_write', 'off', true);
  return new;
end $$;

revoke all on function public.notify_provider_rfq_target_in_app() from public,anon,authenticated;

drop trigger if exists outbox_provider_rfq_in_app_notification on public.outbox_events;
create trigger outbox_provider_rfq_in_app_notification
after insert on public.outbox_events
for each row when (new.event_type = 'provider.rfq_new')
execute function public.notify_provider_rfq_target_in_app();

-- Repair recent requests that received no targets under the old city matcher,
-- then give the newly targeted providers a fresh response window.
insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
select item.id,match.matched_provider_id,
  least(item.required_at-interval '1 hour',greatest(source.response_deadline_at,now()+interval '24 hours'))
from public.internal_sourcing_request_items item
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
join public.quote_requests request on request.id=source.customer_request_id
cross join lateral public.match_rfq_providers(item.product_id,request.city,request.delivery_mode) match
where request.created_at>=now()-interval '7 days'
  and request.status in ('submitted','sourcing','verifying')
  and item.required_at>now()+interval '2 hours'
on conflict do nothing;

update public.internal_sourcing_requests source set
  stage='comparing_prices',
  response_deadline_at=least(
    (select min(item.required_at)-interval '1 hour' from public.internal_sourcing_request_items item where item.sourcing_request_id=source.id),
    greatest(source.response_deadline_at,now()+interval '24 hours')
  ),
  updated_at=now()
where source.created_at>=now()-interval '7 days'
  and source.stage='verifying_availability'
  and exists (
    select 1 from public.internal_sourcing_request_items item
    join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id
    where item.sourcing_request_id=source.id
  );

update public.quote_requests request set
  status='sourcing',
  quote_deadline=source.response_deadline_at,
  updated_at=now()
from public.internal_sourcing_requests source
where source.customer_request_id=request.id
  and request.created_at>=now()-interval '7 days'
  and request.status='verifying'
  and source.stage='comparing_prices';

update public.outbox_events event set
  status='processed',processed_at=now(),last_error=null,sanitized_error=null
where event.event_type='admin.rfq_no_providers'
  and event.status in ('pending','failed')
  and exists (
    select 1 from public.quote_requests request
    where request.id=event.aggregate_id and request.status='sourcing'
      and request.created_at>=now()-interval '7 days'
  );

insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
select 'sourcing_target',target.sourcing_request_item_id,'provider.rfq_new',
  jsonb_build_object('provider_id',target.provider_id,'sourcing_item_id',target.sourcing_request_item_id),
  'rfq-target:'||target.sourcing_request_item_id||':'||target.provider_id
from public.internal_sourcing_request_targets target
join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
join public.quote_requests request on request.id=source.customer_request_id
where request.created_at>=now()-interval '7 days'
  and request.status='sourcing'
  and target.response_deadline_at>now()
  and not exists (
    select 1 from public.provider_pricing_responses response
    where response.sourcing_request_item_id=target.sourcing_request_item_id
      and response.provider_id=target.provider_id
  )
on conflict(idempotency_key) where idempotency_key is not null do nothing;

commit;
