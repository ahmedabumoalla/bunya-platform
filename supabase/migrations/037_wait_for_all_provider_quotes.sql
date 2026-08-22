begin;

create or replace function public.assemble_bunya_customer_quote(p_sourcing_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_source public.internal_sourcing_requests%rowtype;v_item record;v_quote uuid;v_subtotal numeric;v_vat numeric;v_delivery numeric;v_expected timestamptz;
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
  for v_item in select id from public.internal_sourcing_request_items where sourcing_request_id=v_source.id loop perform public.select_best_provider_price(v_item.id);end loop;
  if (select count(*) from public.selected_provider_items selected join public.internal_selection_results result on result.id=selected.selection_result_id where result.sourcing_request_id=v_source.id)<>(select count(*) from public.internal_sourcing_request_items where sourcing_request_id=v_source.id) then raise exception 'Not all items have eligible responses';end if;
  select round(sum(selected.subtotal),2),round(sum(selected.vat_amount),2),round(sum(selected.delivery_fee),2),max(item.required_at) into v_subtotal,v_vat,v_delivery,v_expected from public.selected_provider_items selected join public.internal_selection_results result on result.id=selected.selection_result_id join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id where result.sourcing_request_id=v_source.id;
  insert into public.bunya_customer_quotes(quote_code,customer_request_id,subtotal,vat_amount,delivery_fee,valid_until,expected_delivery_at,terms,status,processing_stage,expected_ready_at,ready_at)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,v_subtotal,v_vat,v_delivery,now()+interval '24 hours',v_expected,'Unified Bunya platform quote; provider details are private.','ready','sent_to_customer',v_source.expected_ready_at,now())
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

commit;
