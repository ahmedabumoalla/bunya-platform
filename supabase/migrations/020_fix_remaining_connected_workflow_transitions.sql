begin;

do $$
begin
  if to_regprocedure('public.assemble_bunya_customer_quote(uuid)') is null
    or to_regprocedure('public.assign_delivery_driver(uuid,uuid)') is null
    or to_regprocedure('public.record_delivery_transition()') is null
    or to_regprocedure('public.protect_contractor_milestone_fields()') is null
  then
    raise exception '020 requires the commerce and contractor workflow functions';
  end if;
  if to_regtype('public.quote_request_status') is null
    or to_regtype('public.provider_order_status') is null
  then
    raise exception '020 requires the commerce workflow enum types';
  end if;
end
$$;

-- A sourced RFQ must pass through verifying before it can become quote_ready.
create or replace function public.assemble_bunya_customer_quote(p_sourcing_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_source public.internal_sourcing_requests%rowtype;v_item record;v_quote uuid;v_subtotal numeric;v_vat numeric;v_delivery numeric;v_expected timestamptz;
begin
  if not public.admin_has_permission('sourcing.manage') then raise exception 'Not authorized';end if;
  select * into v_source from public.internal_sourcing_requests where id=p_sourcing_request_id for update;
  if not found then raise exception 'Sourcing request not found';end if;
  if v_source.response_deadline_at>now() and not exists(select 1 from public.provider_pricing_responses r join public.internal_sourcing_request_items i on i.id=r.sourcing_request_item_id where i.sourcing_request_id=v_source.id) then raise exception 'Responses are still pending';end if;
  for v_item in select id from public.internal_sourcing_request_items where sourcing_request_id=v_source.id loop perform public.select_best_provider_price(v_item.id);end loop;
  if (select count(*) from public.selected_provider_items s join public.internal_selection_results r on r.id=s.selection_result_id where r.sourcing_request_id=v_source.id)<>(select count(*) from public.internal_sourcing_request_items where sourcing_request_id=v_source.id) then raise exception 'Not all items have eligible responses';end if;
  select round(sum(s.subtotal),2),round(sum(s.vat_amount),2),round(sum(s.delivery_fee),2),max(i.required_at) into v_subtotal,v_vat,v_delivery,v_expected from public.selected_provider_items s join public.internal_selection_results r on r.id=s.selection_result_id join public.internal_sourcing_request_items i on i.id=s.sourcing_request_item_id where r.sourcing_request_id=v_source.id;
  insert into public.bunya_customer_quotes(quote_code,customer_request_id,subtotal,vat_amount,delivery_fee,valid_until,expected_delivery_at,terms,status,processing_stage,expected_ready_at,ready_at)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,v_subtotal,v_vat,v_delivery,now()+interval '24 hours',v_expected,'Unified Bunya platform quote; provider details are private.','ready','sent_to_customer',v_source.expected_ready_at,now())
  on conflict(customer_request_id) do update set subtotal=excluded.subtotal,vat_amount=excluded.vat_amount,delivery_fee=excluded.delivery_fee,valid_until=excluded.valid_until,expected_delivery_at=excluded.expected_delivery_at,status='ready',processing_stage='sent_to_customer',ready_at=now(),updated_at=now() returning id into v_quote;
  delete from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote;
  insert into public.bunya_customer_quote_items(bunya_customer_quote_id,quote_request_item_id,product_id,product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,subtotal,vat_amount,delivery_fee)
  select v_quote,i.quote_request_item_id,i.product_id,q.product_name_snapshot,i.quantity,i.unit_snapshot,i.measurement_snapshot,s.unit_price,s.subtotal,s.vat_amount,s.delivery_fee from public.selected_provider_items s join public.internal_selection_results r on r.id=s.selection_result_id join public.internal_sourcing_request_items i on i.id=s.sourcing_request_item_id join public.quote_request_items q on q.id=i.quote_request_item_id where r.sourcing_request_id=v_source.id;
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

-- assigned_at is created with the paid assignment and is protected thereafter.
create or replace function public.assign_delivery_driver(p_fulfillment_id uuid,p_driver_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_f public.internal_fulfillment_orders%rowtype;v_assignment uuid;v_order uuid;
begin
  select * into v_f from public.internal_fulfillment_orders where id=p_fulfillment_id for update;
  if not found or not public.is_provider_member(v_f.provider_id) then raise exception 'Not authorized';end if;
  if v_f.payment_released_at is null or v_f.status<>'ready' then raise exception 'Fulfillment is not ready';end if;
  if not exists(select 1 from public.provider_drivers where id=p_driver_id and provider_id=v_f.provider_id and status='active') then raise exception 'Driver is not active';end if;
  select id,order_id into v_assignment,v_order from public.provider_delivery_assignments where fulfillment_order_id=p_fulfillment_id for update;
  update public.provider_delivery_assignments set assigned_driver_id=p_driver_id,updated_at=now() where id=v_assignment;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('delivery',v_assignment,'customer.delivery_assigned',jsonb_build_object('order_id',v_order),'delivery-assigned:'||v_assignment) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return v_assignment;
end $$;

-- CASE resolves to text unless the complete expression is cast to the order enum.
create or replace function public.record_delivery_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event text;
begin
  if old.status=new.status then return new;end if;
  insert into public.provider_delivery_updates(assignment_id,from_status,to_status,actor_role,actor_user_id,note) values(new.id,old.status,new.status,case when public.current_provider_driver_id()=new.assigned_driver_id then 'driver' else 'provider' end,auth.uid(),new.delivery_note);
  if new.status in('picked_up','in_transit','arrived') then
    update public.orders set status=(case when new.status='picked_up' then 'assigned_driver' else 'out_for_delivery' end)::public.provider_order_status,updated_at=now() where id=new.order_id and status not in('delivered','completed','cancelled');
  end if;
  if new.status='delivered' then return new;end if;
  v_event:=case new.status when 'picked_up' then 'customer.delivery_out_for_delivery' when 'in_transit' then 'customer.delivery_out_for_delivery' when 'arrived' then 'customer.driver_arrived' when 'failed_delivery' then 'customer.delivery_failed' else 'customer.delivery_assigned' end;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('delivery',new.id,v_event,jsonb_build_object('order_id',new.order_id),'delivery-status:'||new.id||':'||new.status) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return new;
end $$;

-- Proposal acceptance is customer initiated inside a SECURITY DEFINER function.
-- Direct customer inserts remain blocked by RLS; permit only valid initial rows.
create or replace function public.protect_contractor_milestone_fields()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_project public.contractor_projects%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')='service_role' or public.admin_has_permission('projects.manage') then if tg_op='DELETE' then return old;end if;return new;end if;
  if tg_op='DELETE' then raise exception 'Project milestones cannot be deleted by project participants';end if;
  select * into v_project from public.contractor_projects where id=new.project_id;
  if not found then raise exception 'Project not found';end if;
  if tg_op='INSERT' then
    if new.status<>'not_started' or new.progress<>0 or new.approved_at is not null or (not public.is_contractor_owner(v_project.contractor_profile_id) and v_project.customer_profile_id<>auth.uid()) then raise exception 'Invalid participant milestone creation';end if;
    return new;
  end if;
  if v_project.customer_profile_id=auth.uid() then
    if old.status<>'awaiting_customer_approval' or new.status<>'approved' or (to_jsonb(new)-array['status','approved_at','updated_at']) is distinct from (to_jsonb(old)-array['status','approved_at','updated_at']) then raise exception 'Customer may only approve an awaiting milestone';end if;
  else
    if not public.is_contractor_owner(v_project.contractor_profile_id) or new.project_id is distinct from old.project_id or new.name is distinct from old.name or new.description is distinct from old.description or new.start_at is distinct from old.start_at or new.expected_end_at is distinct from old.expected_end_at or new.value_percentage is distinct from old.value_percentage or new.sort_order is distinct from old.sort_order or new.approved_at is distinct from old.approved_at or (new.status='approved' and old.status<>'approved') then raise exception 'Contractor cannot change protected or customer-controlled milestone fields';end if;
  end if;
  return new;
end $$;

-- The verified E2E identity is sufficient to distinguish disposable payment
-- fixtures, including pending records whose production idempotency key is UUID-based.
create or replace function public.protect_e2e_payment_record_delete()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','')='service_role'
    and public.is_e2e_test_profile(old.customer_profile_id,null)
  then
    return old;
  end if;
  raise exception 'Financial records are append-only and cannot be deleted';
end $$;

commit;
