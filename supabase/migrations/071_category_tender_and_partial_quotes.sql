begin;

-- An RFQ item is offered to every approved provider who actively supplies
-- either the same named product or any product in the same category.
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
  select id from candidates;
$$;

revoke all on function public.match_rfq_providers(uuid,text,text) from public, anon, authenticated;

-- A revision is a new tender bid and must beat both the provider's saved bid
-- and the currently advertised lowest eligible landed cost.
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
  if v_response.current_competitor_landed_cost is null then raise exception 'Current competitor offer is not available';end if;
  select item.* into v_item from public.internal_sourcing_request_items item where item.id=p_sourcing_item_id;
  select delivery.delivery_fee into v_old_delivery from public.provider_delivery_confirmations delivery where delivery.pricing_response_id=v_response.id;
  v_new_unit:=coalesce((p_response->>'unit_price')::numeric,-1);v_new_delivery:=coalesce((p_response->>'delivery_fee')::numeric,0);v_vat:=coalesce((p_response->>'vat_inclusive')::boolean,false);
  v_old_landed:=case when v_response.vat_inclusive then round(v_item.quantity*v_response.unit_price,2)+v_old_delivery else round(v_item.quantity*v_response.unit_price*1.15,2)+v_old_delivery end;
  v_new_landed:=case when v_vat then round(v_item.quantity*v_new_unit,2)+v_new_delivery else round(v_item.quantity*v_new_unit*1.15,2)+v_new_delivery end;
  if v_new_unit<0 or v_new_delivery<0 or v_new_landed>=v_old_landed then raise exception 'Revised landed cost must be lower than your saved offer';end if;
  if v_new_landed>=v_response.current_competitor_landed_cost then raise exception 'Revised landed cost must beat the current competitor offer';end if;
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

-- Product reviewers may correct the catalog category before approving a
-- pending product. This immediately affects future RFQ matching.
create or replace function public.admin_update_product_category(p_product_id uuid,p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_category public.product_categories%rowtype;
begin
  if auth.uid() is null or not public.admin_has_permission('reviews.manage') then
    raise exception 'Not authorized';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'Product not found';end if;
  if v_product.review_status not in ('pending_review','needs_changes') then
    raise exception 'Product category can only be changed during review';
  end if;
  select * into v_category from public.product_categories where id=p_category_id and is_active;
  if not found then raise exception 'Active product category required';end if;
  update public.products
  set category_id=v_category.id,custom_category=null,updated_at=now()
  where id=v_product.id;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,old_data,new_data)
  values(auth.uid(),'products',v_product.id::text,'product_category_updated',
    jsonb_build_object('category_id',v_product.category_id,'custom_category',v_product.custom_category),
    jsonb_build_object('category_id',v_category.id,'category_name',v_category.name));
  return jsonb_build_object('product_id',v_product.id,'category_id',v_category.id,'category_name',v_category.name);
end
$$;

revoke all on function public.admin_update_product_category(uuid,uuid) from public,anon;
grant execute on function public.admin_update_product_category(uuid,uuid) to authenticated;

-- Outside Riyadh pricing hours the request is still accepted, while the
-- customer-facing promise explicitly changes to a within-24-hours message.
create or replace function public.set_rfq_customer_window_message()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare v_local_time time;
begin
  v_local_time := (coalesce(new.created_at,now()) at time zone 'Asia/Riyadh')::time;
  if v_local_time < time '08:00' or v_local_time >= time '16:00' then
    new.quote_window_label := 'تم استلام الطلب خارج أوقات التسعير، وسيتم تزويدك بعرض السعر خلال 24 ساعة.';
  else
    new.quote_window_label := 'نافذة التسعير 3 ساعات خلال أوقات العمل من 8 ص إلى 4 م بتوقيت الرياض.';
  end if;
  return new;
end
$$;

drop trigger if exists quote_requests_customer_window_message on public.quote_requests;
create trigger quote_requests_customer_window_message
before insert on public.quote_requests
for each row execute function public.set_rfq_customer_window_message();

-- Final customer quotes contain only products with a valid selected bid.
-- Unpriced items are deliberately omitted instead of blocking the full quote.
create or replace function public.assemble_bunya_customer_quote(p_sourcing_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_source public.internal_sourcing_requests%rowtype;v_item record;v_quote uuid;v_subtotal numeric;v_vat numeric;v_delivery numeric;v_expected timestamptz;
  v_requested_count integer;v_priced_count integer;
begin
  if not public.admin_has_permission('sourcing.manage') then raise exception 'Not authorized';end if;
  select * into v_source from public.internal_sourcing_requests where id=p_sourcing_request_id for update;
  if not found then raise exception 'Sourcing request not found';end if;
  if v_source.response_deadline_at>now() and exists(
    select 1
    from public.internal_sourcing_request_items item
    join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id
    where item.sourcing_request_id=v_source.id
      and not exists(
        select 1 from public.provider_pricing_responses response
        where response.sourcing_request_item_id=target.sourcing_request_item_id and response.provider_id=target.provider_id
      )
  ) then raise exception 'Provider responses are still pending';end if;

  for v_item in select id from public.internal_sourcing_request_items where sourcing_request_id=v_source.id loop
    begin
      perform public.select_best_provider_price(v_item.id);
    exception when others then
      if sqlerrm='No eligible current provider response' then
        delete from public.selected_provider_items selected
        using public.internal_selection_results result
        where selected.selection_result_id=result.id
          and result.sourcing_request_id=v_source.id
          and selected.sourcing_request_item_id=v_item.id;
      else
        raise;
      end if;
    end;
  end loop;

  select count(*) into v_requested_count from public.internal_sourcing_request_items where sourcing_request_id=v_source.id;
  select count(*) into v_priced_count
  from public.selected_provider_items selected
  join public.internal_selection_results result on result.id=selected.selection_result_id
  where result.sourcing_request_id=v_source.id;
  if v_priced_count=0 then raise exception 'No items have eligible provider prices';end if;

  select round(sum(selected.subtotal),2),round(sum(selected.vat_amount),2),round(sum(selected.delivery_fee),2),max(item.required_at)
  into v_subtotal,v_vat,v_delivery,v_expected
  from public.selected_provider_items selected
  join public.internal_selection_results result on result.id=selected.selection_result_id
  join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id
  where result.sourcing_request_id=v_source.id;

  insert into public.bunya_customer_quotes(quote_code,customer_request_id,subtotal,vat_amount,delivery_fee,valid_until,expected_delivery_at,terms,status,processing_stage,expected_ready_at,ready_at)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,v_subtotal,v_vat,v_delivery,now()+interval '24 hours',v_expected,'عرض موحد من منصة بُنية يشمل الأصناف التي استلمت أسعارًا مؤهلة فقط؛ بيانات المزودين خاصة.','ready','sent_to_customer',v_source.expected_ready_at,now())
  on conflict(customer_request_id) do update set subtotal=excluded.subtotal,vat_amount=excluded.vat_amount,delivery_fee=excluded.delivery_fee,valid_until=excluded.valid_until,expected_delivery_at=excluded.expected_delivery_at,terms=excluded.terms,status='ready',processing_stage='sent_to_customer',ready_at=now(),updated_at=now() returning id into v_quote;
  delete from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote;
  insert into public.bunya_customer_quote_items(bunya_customer_quote_id,quote_request_item_id,product_id,product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,subtotal,vat_amount,delivery_fee)
  select v_quote,item.quote_request_item_id,item.product_id,request_item.product_name_snapshot,item.quantity,item.unit_snapshot,item.measurement_snapshot,selected.unit_price,selected.subtotal,selected.vat_amount,selected.delivery_fee
  from public.selected_provider_items selected
  join public.internal_selection_results result on result.id=selected.selection_result_id
  join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id
  join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
  where result.sourcing_request_id=v_source.id;
  update public.internal_sourcing_requests set stage='sent_to_customer',updated_at=now(),completed_at=now() where id=v_source.id;
  update public.quote_requests set status='verifying'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id and status='sourcing';
  update public.quote_requests set status='quote_ready'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('customer_quote',v_quote,'customer.quote_ready',jsonb_build_object('requested_item_count',v_requested_count,'priced_item_count',v_priced_count,'omitted_item_count',v_requested_count-v_priced_count),'quote-ready:'||v_quote)
  on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),'bunya_customer_quotes',v_quote::text,'quote_assembled',jsonb_build_object('sourcing_request_id',v_source.id,'requested_item_count',v_requested_count,'priced_item_count',v_priced_count,'omitted_item_count',v_requested_count-v_priced_count));
  return v_quote;
exception when others then
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('sourcing_request',p_sourcing_request_id,'admin.quote_assembly_failed',jsonb_build_object('error',sqlerrm),'quote-assembly-failed:'||p_sourcing_request_id||':'||extract(epoch from date_trunc('hour',now()))::bigint)
  on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return null;
end
$$;

-- Apply the broader matching rule to RFQs whose response window is still open.
insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
select item.id,matched.matched_provider_id,source.response_deadline_at
from public.internal_sourcing_request_items item
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
join public.quote_requests request on request.id=source.customer_request_id
cross join lateral public.match_rfq_providers(item.product_id,request.city,request.delivery_mode) matched
where request.status in ('submitted','sourcing','verifying')
  and source.response_deadline_at>now()
on conflict do nothing;

insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
select 'sourcing_target',target.sourcing_request_item_id,'provider.rfq_new',
  jsonb_build_object('provider_id',target.provider_id,'sourcing_item_id',target.sourcing_request_item_id),
  'rfq-target:'||target.sourcing_request_item_id||':'||target.provider_id
from public.internal_sourcing_request_targets target
join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id
join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
where source.response_deadline_at>now()
on conflict(idempotency_key) where idempotency_key is not null do nothing;

commit;
