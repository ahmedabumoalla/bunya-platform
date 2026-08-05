begin;

alter table public.notifications add column event_key text;
create unique index notifications_event_key_idx on public.notifications(event_key) where event_key is not null;

-- Atomic customer RFQ creation and provider targeting. Payload contains business fields only.
create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid;v_item jsonb;v_item_id uuid;v_source uuid;v_source_item uuid;v_deadline timestamptz;v_required timestamptz;v_city text;v_count integer:=0;v_added integer:=0;
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
  values('RFQ-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),auth.uid(),'customer',v_city,btrim(coalesce(p_request->>'location_hint',v_city)),v_required,'24 ساعة',v_deadline,nullif(btrim(p_request->>'notes'),''),'submitted',case when p_request->>'delivery_mode'='pickup' then 'pickup' else 'delivery' end,nullif(btrim(p_request->>'project_name'),''),nullif(btrim(p_request->>'recipient_name'),''),nullif(btrim(p_request->>'recipient_mobile'),'')) returning id into v_id;
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
    select v_source_item,p.id,v_deadline from public.providers p join public.provider_product_prices pp on pp.provider_id=p.id and pp.product_id=(v_item->>'product_id')::uuid join public.subscriptions s on s.profile_id=p.owner_profile_id and s.status='active' and (s.ends_at is null or s.ends_at>now()) where p.status='approved' and pp.expires_at>now() and pp.freshness_status in('valid','expiring_soon') and (p.application_id is null or exists(select 1 from public.provider_delivery_regions r where r.application_id=p.application_id and lower(r.region_name)=lower(v_city)) or p_request->>'delivery_mode'='pickup') on conflict do nothing;
    get diagnostics v_added=row_count;v_count:=v_count+v_added;
  end loop;
  update public.quote_requests set status=case when v_count>0 then 'sourcing' else 'verifying' end where id=v_id;
  update public.internal_sourcing_requests set stage=case when v_count>0 then 'comparing_prices' else 'verifying_availability' end where id=v_source;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('quote_request',v_id,case when v_count>0 then 'rfq.submitted' else 'admin.rfq_no_providers' end,jsonb_build_object('sourcing_request_id',v_source),'rfq:'||auth.uid()||':'||p_idempotency_key);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select 'sourcing_target',t.sourcing_request_item_id,'provider.rfq_new',jsonb_build_object('provider_id',t.provider_id,'sourcing_item_id',t.sourcing_request_item_id),'rfq-target:'||t.sourcing_request_item_id||':'||t.provider_id from public.internal_sourcing_request_targets t join public.internal_sourcing_request_items i on i.id=t.sourcing_request_item_id where i.sourcing_request_id=v_source on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return v_id;
end $$;

create or replace function public.submit_provider_pricing_response(p_sourcing_item_id uuid,p_response jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_provider uuid;v_target public.internal_sourcing_request_targets%rowtype;v_id uuid;v_available boolean;v_qty numeric;v_expires timestamptz;
begin
  select p.id into v_provider from public.providers p where public.is_provider_member(p.id) and p.status='approved' limit 1;
  if v_provider is null then raise exception 'Approved provider required';end if;
  select * into v_target from public.internal_sourcing_request_targets where sourcing_request_item_id=p_sourcing_item_id and provider_id=v_provider for update;
  if not found then raise exception 'Target not found';end if;if v_target.response_deadline_at<=now() then raise exception 'Response deadline expired';end if;
  if exists(select 1 from public.provider_pricing_responses where sourcing_request_item_id=p_sourcing_item_id and provider_id=v_provider) then raise exception 'Response already submitted';end if;
  v_available:=coalesce((p_response->>'available')::boolean,false);v_qty:=case when v_available then (p_response->>'available_quantity')::numeric else 0 end;v_expires:=(p_response->>'price_expires_at')::timestamptz;
  if coalesce((p_response->>'unit_price')::numeric,-1)<0 or v_qty<0 or v_expires<=now() or v_expires>now()+interval '72 hours' then raise exception 'Invalid response';end if;
  insert into public.provider_pricing_responses(response_code,sourcing_request_item_id,provider_id,receipt_confirmed_at,unit_price,vat_inclusive,price_confirmed_at,price_expires_at,internal_notes)
  values('RSP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_sourcing_item_id,v_provider,now(),(p_response->>'unit_price')::numeric,coalesce((p_response->>'vat_inclusive')::boolean,false),now(),v_expires,nullif(btrim(p_response->>'notes'),'')) returning id into v_id;
  insert into public.provider_availability_confirmations(pricing_response_id,available,available_quantity) values(v_id,v_available,v_qty);
  insert into public.provider_delivery_confirmations(pricing_response_id,region_eligible,preparation_duration_hours,delivery_duration_hours,delivery_fee) values(v_id,coalesce((p_response->>'region_eligible')::boolean,false),(p_response->>'preparation_hours')::numeric,(p_response->>'delivery_hours')::numeric,coalesce((p_response->>'delivery_fee')::numeric,0));
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('provider_response',v_id,'provider.rfq_responded',jsonb_build_object('sourcing_item_id',p_sourcing_item_id),'provider-response:'||v_id);
  return v_id;
end $$;

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
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,v_subtotal,v_vat,v_delivery,now()+interval '24 hours',v_expected,'عرض موحد من منصة بُنية؛ لا يتضمن بيانات الموردين.','ready','sent_to_customer',v_source.expected_ready_at,now())
  on conflict(customer_request_id) do update set subtotal=excluded.subtotal,vat_amount=excluded.vat_amount,delivery_fee=excluded.delivery_fee,valid_until=excluded.valid_until,expected_delivery_at=excluded.expected_delivery_at,status='ready',processing_stage='sent_to_customer',ready_at=now(),updated_at=now() returning id into v_quote;
  delete from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote;
  insert into public.bunya_customer_quote_items(bunya_customer_quote_id,quote_request_item_id,product_id,product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,subtotal,vat_amount,delivery_fee)
  select v_quote,i.quote_request_item_id,i.product_id,q.product_name_snapshot,i.quantity,i.unit_snapshot,i.measurement_snapshot,s.unit_price,s.subtotal,s.vat_amount,s.delivery_fee from public.selected_provider_items s join public.internal_selection_results r on r.id=s.selection_result_id join public.internal_sourcing_request_items i on i.id=s.sourcing_request_item_id join public.quote_request_items q on q.id=i.quote_request_item_id where r.sourcing_request_id=v_source.id;
  update public.internal_sourcing_requests set stage='sent_to_customer',updated_at=now(),completed_at=now() where id=v_source.id;
  update public.quote_requests set status='quote_ready',updated_at=now() where id=v_source.customer_request_id;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('customer_quote',v_quote,'customer.quote_ready','{}','quote-ready:'||v_quote) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data) values(auth.uid(),'bunya_customer_quotes',v_quote::text,'quote_assembled',jsonb_build_object('sourcing_request_id',v_source.id));
  return v_quote;
exception when others then
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('sourcing_request',p_sourcing_request_id,'admin.quote_assembly_failed','{}','quote-assembly-failed:'||p_sourcing_request_id||':'||extract(epoch from date_trunc('hour',now()))::bigint) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return null;
end $$;

-- Acceptance already creates the order. This trigger closes invoice, pending payment and provider fulfillment atomically.
create or replace function public.complete_accepted_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice uuid;v_quote uuid:=new.customer_quote_id;
begin
  insert into public.invoices(invoice_code,order_id,customer_profile_id,subtotal,vat_amount,delivery_fee,total,status) values('INV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),new.id,new.customer_profile_id,new.subtotal,new.vat_amount,new.delivery_fee,new.total,'unpaid') returning id into v_invoice;
  insert into public.invoice_items(invoice_id,order_item_id,description,quantity,unit_price,vat_rate,vat_amount,line_total)
  select v_invoice,oi.id,qi.product_name_snapshot,qi.quantity,qi.unit_price,case when qi.subtotal=0 then 0 else round(qi.vat_amount/qi.subtotal*100,2) end,qi.vat_amount,qi.subtotal+qi.vat_amount
  from public.bunya_customer_quote_items qi join public.order_items oi on oi.order_id=new.id and oi.product_id=qi.product_id and oi.quantity=qi.quantity where qi.bunya_customer_quote_id=v_quote;
  insert into public.payment_records(invoice_id,customer_profile_id,idempotency_key,amount,status) values(v_invoice,new.customer_profile_id,'payment-pending:'||new.id,new.total,'pending');
  insert into public.internal_fulfillment_orders(fulfillment_code,bunya_customer_quote_id,provider_id,delivery_region,required_at,assigned_value,status)
  select 'FUL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_quote,s.provider_id,r.city,r.desired_receipt_at,sum(s.landed_cost),'assigned' from public.selected_provider_items s join public.internal_selection_results sr on sr.id=s.selection_result_id join public.internal_sourcing_requests x on x.id=sr.sourcing_request_id join public.quote_requests r on r.id=x.customer_request_id where r.id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote) group by s.provider_id,r.city,r.desired_receipt_at;
  insert into public.internal_fulfillment_order_items(fulfillment_order_id,selected_provider_item_id) select f.id,s.id from public.internal_fulfillment_orders f join public.selected_provider_items s on s.provider_id=f.provider_id join public.internal_selection_results sr on sr.id=s.selection_result_id join public.internal_sourcing_requests x on x.id=sr.sourcing_request_id where f.bunya_customer_quote_id=v_quote and x.customer_request_id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote);
  return new;
end $$;
create constraint trigger orders_complete_acceptance after insert on public.orders deferrable initially deferred for each row execute function public.complete_accepted_order();

alter table public.internal_fulfillment_orders add column payment_released_at timestamptz;
drop policy internal_fulfillment_provider_select on public.internal_fulfillment_orders;
create policy internal_fulfillment_provider_select on public.internal_fulfillment_orders for select to authenticated using ((payment_released_at is not null and public.is_provider_member(provider_id)) or public.is_admin());
create table public.fulfillment_status_history(id uuid primary key default gen_random_uuid(),fulfillment_order_id uuid not null references public.internal_fulfillment_orders(id) on delete cascade,from_status public.internal_fulfillment_status,to_status public.internal_fulfillment_status not null,actor_profile_id uuid references public.profiles(id) on delete set null,note text,created_at timestamptz not null default now());
create index fulfillment_status_history_order_idx on public.fulfillment_status_history(fulfillment_order_id,created_at desc);alter table public.fulfillment_status_history enable row level security;create policy fulfillment_history_provider_read on public.fulfillment_status_history for select to authenticated using(public.is_admin() or exists(select 1 from public.internal_fulfillment_orders f where f.id=fulfillment_order_id and public.is_provider_member(f.provider_id)));
create or replace function public.transition_fulfillment_order(p_fulfillment_id uuid,p_status public.internal_fulfillment_status,p_note text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare v_order public.internal_fulfillment_orders%rowtype;v_customer_order uuid;begin select * into v_order from public.internal_fulfillment_orders where id=p_fulfillment_id for update;if not found or not public.is_provider_member(v_order.provider_id) then raise exception 'Not authorized';end if;if v_order.payment_released_at is null then raise exception 'Payment is not released';end if;if not((v_order.status='assigned' and p_status='preparing')or(v_order.status='preparing' and p_status='ready'))then raise exception 'Invalid fulfillment transition';end if;update public.internal_fulfillment_orders set status=p_status,updated_at=now() where id=p_fulfillment_id;select id into v_customer_order from public.orders where customer_quote_id=v_order.bunya_customer_quote_id for update;update public.orders set status=case when p_status='preparing' then 'preparing' when not exists(select 1 from public.internal_fulfillment_orders where bunya_customer_quote_id=v_order.bunya_customer_quote_id and status<>'ready') then 'ready_for_pickup' else status end,updated_at=now() where id=v_customer_order;insert into public.fulfillment_status_history(fulfillment_order_id,from_status,to_status,actor_profile_id,note)values(p_fulfillment_id,v_order.status,p_status,auth.uid(),nullif(btrim(p_note),''));insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('fulfillment',p_fulfillment_id,case when p_status='preparing' then 'customer.fulfillment_preparing' else 'customer.fulfillment_ready' end,'{}','fulfillment-status:'||p_fulfillment_id||':'||p_status);end $$;
create or replace function public.transition_delivery_assignment(p_assignment_id uuid,p_status public.provider_delivery_status,p_note text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare v_assignment public.provider_delivery_assignments%rowtype;v_driver uuid;begin select * into v_assignment from public.provider_delivery_assignments where id=p_assignment_id for update;if not found then raise exception 'Assignment not found';end if;v_driver:=public.current_provider_driver_id();if not public.is_provider_member(v_assignment.provider_id) and v_driver is distinct from v_assignment.assigned_driver_id then raise exception 'Not authorized';end if;update public.provider_delivery_assignments set status=p_status,pickup_at=case when p_status='picked_up' then now() else pickup_at end,delivery_note=coalesce(nullif(btrim(p_note),''),delivery_note),updated_at=now() where id=p_assignment_id;end $$;
create or replace function public.assign_delivery_driver(p_fulfillment_id uuid,p_driver_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$ declare v_f public.internal_fulfillment_orders%rowtype;v_assignment uuid;v_order uuid;begin select * into v_f from public.internal_fulfillment_orders where id=p_fulfillment_id for update;if not found or not public.is_provider_member(v_f.provider_id) then raise exception 'Not authorized';end if;if v_f.payment_released_at is null or v_f.status<>'ready' then raise exception 'Fulfillment is not ready';end if;if not exists(select 1 from public.provider_drivers where id=p_driver_id and provider_id=v_f.provider_id and status='active') then raise exception 'Driver is not active';end if;select id,order_id into v_assignment,v_order from public.provider_delivery_assignments where fulfillment_order_id=p_fulfillment_id for update;update public.provider_delivery_assignments set assigned_driver_id=p_driver_id,assigned_at=now(),updated_at=now() where id=v_assignment;insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('delivery',v_assignment,'customer.delivery_assigned',jsonb_build_object('order_id',v_order),'delivery-assigned:'||v_assignment);return v_assignment;end $$;
create or replace function public.record_delivery_transition() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_event text;begin if old.status=new.status then return new;end if;insert into public.provider_delivery_updates(assignment_id,from_status,to_status,actor_role,actor_user_id,note)values(new.id,old.status,new.status,case when public.current_provider_driver_id()=new.assigned_driver_id then 'driver' else 'provider' end,auth.uid(),new.delivery_note);if new.status in('picked_up','in_transit','arrived') then update public.orders set status=case when new.status='picked_up' then 'assigned_driver' else 'out_for_delivery' end,updated_at=now() where id=new.order_id and status not in('delivered','completed','cancelled');end if;if new.status='delivered' then return new;end if;v_event:=case new.status when 'picked_up' then 'customer.delivery_out_for_delivery' when 'in_transit' then 'customer.delivery_out_for_delivery' when 'arrived' then 'customer.driver_arrived' when 'failed_delivery' then 'customer.delivery_failed' else 'customer.delivery_assigned' end;insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('delivery',new.id,v_event,jsonb_build_object('order_id',new.order_id),'delivery-status:'||new.id||':'||new.status);return new;end $$;
create trigger provider_delivery_transition_event after update of status on public.provider_delivery_assignments for each row execute function public.record_delivery_transition();
create or replace function public.alert_delivery_code_lock() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin if new.attempts>=new.max_attempts and old.attempts<old.max_attempts then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('delivery',new.assignment_id,'admin.delivery_attempts_exceeded','{}','delivery-attempts-exceeded:'||new.assignment_id||':'||new.created_at);end if;return new;end $$;
create trigger delivery_code_lock_alert after update of attempts on public.delivery_confirmation_codes for each row execute function public.alert_delivery_code_lock();

create table public.trusted_payment_events(
  event_id text primary key,
  payment_record_id uuid not null references public.payment_records(id) on delete restrict,
  event_type text not null check(event_type in('payment.succeeded','payment.failed','payment.refunded')),
  gateway_reference text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  sanitized_error text check(sanitized_error is null or length(sanitized_error)<=500)
);
alter table public.trusted_payment_events enable row level security;
create policy trusted_payment_events_admin_read on public.trusted_payment_events for select to authenticated using(public.admin_has_permission('finance.manage') or public.admin_has_permission('audit.read'));

create or replace function public.apply_trusted_payment_event(p_event_id text,p_payment_id uuid,p_event_type text,p_gateway_reference text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.payment_records%rowtype;v_order uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  if p_event_type not in('payment.succeeded','payment.failed','payment.refunded') or length(p_event_id) not between 8 and 200 then raise exception 'Invalid payment event';end if;
  insert into public.trusted_payment_events(event_id,payment_record_id,event_type,gateway_reference) values(p_event_id,p_payment_id,p_event_type,nullif(left(p_gateway_reference,255),'')) on conflict(event_id) do nothing;
  if not found then
    if not exists(select 1 from public.trusted_payment_events where event_id=p_event_id and payment_record_id=p_payment_id and event_type=p_event_type) then raise exception 'Payment event id conflict';end if;
    return null;
  end if;
  select * into v_payment from public.payment_records where id=p_payment_id for update;if not found then raise exception 'Payment not found';end if;
  select order_id into v_order from public.invoices where id=v_payment.invoice_id for update;
  if p_event_type='payment.succeeded' then
    if v_payment.status not in('pending','failed') then raise exception 'Payment cannot succeed from current state';end if;
    update public.payment_records set status='succeeded',gateway_reference=nullif(left(p_gateway_reference,255),''),failure_code=null,processed_at=now() where id=p_payment_id;
    update public.invoices set status='paid',paid_at=now(),updated_at=now() where id=v_payment.invoice_id;
    update public.orders set payment_status='paid',updated_at=now() where id=v_order;
    update public.internal_fulfillment_orders f set payment_released_at=now(),updated_at=now() where f.bunya_customer_quote_id=(select customer_quote_id from public.orders where id=v_order);
    insert into public.provider_delivery_assignments(provider_id,order_id,fulfillment_order_id,status,expected_at,assigned_at)
    select f.provider_id,v_order,f.id,'assigned',f.required_at,now() from public.internal_fulfillment_orders f where f.bunya_customer_quote_id=(select customer_quote_id from public.orders where id=v_order) on conflict(fulfillment_order_id) do nothing;
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('payment',p_payment_id,'customer.payment_succeeded',jsonb_build_object('order_id',v_order),'payment-succeeded-customer:'||p_event_id);
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'fulfillment',f.id,'provider.fulfillment_assigned',jsonb_build_object('order_id',v_order),'payment-succeeded-provider:'||p_event_id||':'||f.id from public.internal_fulfillment_orders f where f.bunya_customer_quote_id=(select customer_quote_id from public.orders where id=v_order);
  elsif p_event_type='payment.failed' then
    update public.payment_records set status='failed',failure_code='gateway_failed',processed_at=now() where id=p_payment_id and status='pending';
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('payment',p_payment_id,'customer.payment_failed',jsonb_build_object('order_id',v_order),'payment-failed:'||p_event_id);
  else
    if v_payment.status<>'succeeded' then raise exception 'Only succeeded payment can be refunded';end if;
    update public.payment_records set status='refunded',processed_at=now() where id=p_payment_id;update public.invoices set status='refunded',updated_at=now() where id=v_payment.invoice_id;update public.orders set payment_status='refunded',updated_at=now() where id=v_order;
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('payment',p_payment_id,'customer.payment_refunded',jsonb_build_object('order_id',v_order),'payment-refunded:'||p_event_id);
  end if;
  update public.trusted_payment_events set processed_at=now() where event_id=p_event_id;
  insert into public.audit_logs(entity_table,entity_id,action,new_data) values('payment_records',p_payment_id::text,p_event_type,jsonb_build_object('event_id',p_event_id,'order_id',v_order));
  return v_order;
end $$;

create or replace function public.schedule_commerce_notifications()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer:=0;v_added integer;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select 'customer_quote',q.id,'customer.quote_expiring','{}','quote-expiring:'||q.id from public.bunya_customer_quotes q where q.status in('ready','customer_review') and q.valid_until between now() and now()+interval '2 hours' on conflict(idempotency_key) where idempotency_key is not null do nothing;get diagnostics v_added=row_count;v_count:=v_count+v_added;
  update public.bunya_customer_quotes set status='expired',updated_at=now() where status in('ready','customer_review') and valid_until<=now();
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'customer_quote',q.id,'customer.quote_expired','{}','quote-expired:'||q.id from public.bunya_customer_quotes q where q.status='expired' on conflict(idempotency_key) where idempotency_key is not null do nothing;get diagnostics v_added=row_count;v_count:=v_count+v_added;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'sourcing_target',t.sourcing_request_item_id,'provider.rfq_reminder',jsonb_build_object('provider_id',t.provider_id),'rfq-reminder:'||t.sourcing_request_item_id||':'||t.provider_id from public.internal_sourcing_request_targets t where t.response_deadline_at between now() and now()+interval '2 hours' and not exists(select 1 from public.provider_pricing_responses r where r.sourcing_request_item_id=t.sourcing_request_item_id and r.provider_id=t.provider_id) on conflict(idempotency_key) where idempotency_key is not null do nothing;get diagnostics v_added=row_count;v_count:=v_count+v_added;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'sourcing_target',t.sourcing_request_item_id,'provider.rfq_expired',jsonb_build_object('provider_id',t.provider_id),'rfq-expired:'||t.sourcing_request_item_id||':'||t.provider_id from public.internal_sourcing_request_targets t where t.response_deadline_at<=now() and not exists(select 1 from public.provider_pricing_responses r where r.sourcing_request_item_id=t.sourcing_request_item_id and r.provider_id=t.provider_id) on conflict(idempotency_key) where idempotency_key is not null do nothing;get diagnostics v_added=row_count;v_count:=v_count+v_added;
  return v_count;
end $$;

create or replace function public.claim_notification_outbox(p_limit integer,p_event_types text[])
returns setof public.outbox_events language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  update public.outbox_events set status='failed',locked_at=null,next_attempt_at=now(),sanitized_error='worker_lock_expired' where status='processing' and locked_at<now()-interval '10 minutes';
  return query update public.outbox_events o set status='processing',locked_at=now(),attempts=o.attempts+1 where o.id in(select id from public.outbox_events where status in('pending','failed') and event_type=any(p_event_types) and coalesce(next_attempt_at,available_at)<=now() order by created_at for update skip locked limit greatest(1,least(p_limit,25))) returning o.*;
end $$;

create or replace function public.finish_notification_outbox(p_id uuid,p_success boolean,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempts integer;v_error text;v_event text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  v_error:=nullif(left(regexp_replace(coalesce(p_error,''),'[\r\n\t]+',' ','g'),500),'');
  select attempts,event_type into v_attempts,v_event from public.outbox_events where id=p_id and status='processing' for update;if not found then raise exception 'Outbox event is not processing';end if;
  if p_success then update public.outbox_events set status='processed',processed_at=now(),locked_at=null,sanitized_error=null where id=p_id;
  elsif v_attempts>=5 then update public.outbox_events set status='dead_letter',dead_letter_at=now(),locked_at=null,sanitized_error=v_error,last_error=v_error where id=p_id;
    if v_event<>'admin.outbox_dead_letter' then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('outbox',p_id,'admin.outbox_dead_letter','{}','dead-letter-alert:'||p_id) on conflict(idempotency_key) where idempotency_key is not null do nothing;end if;
  else update public.outbox_events set status='failed',next_attempt_at=now()+(interval '30 seconds'*power(2,greatest(0,v_attempts-1))),locked_at=null,sanitized_error=v_error,last_error=v_error where id=p_id;end if;
end $$;

revoke execute on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;
revoke execute on function public.submit_provider_pricing_response(uuid,jsonb) from public,anon;grant execute on function public.submit_provider_pricing_response(uuid,jsonb) to authenticated;
revoke execute on function public.assemble_bunya_customer_quote(uuid) from public,anon;grant execute on function public.assemble_bunya_customer_quote(uuid) to authenticated;
revoke all on public.trusted_payment_events from public,anon,authenticated;grant select on public.trusted_payment_events to authenticated;grant all on public.trusted_payment_events to service_role;
revoke execute on function public.apply_trusted_payment_event(text,uuid,text,text) from public,anon,authenticated;grant execute on function public.apply_trusted_payment_event(text,uuid,text,text) to service_role;
revoke execute on function public.schedule_commerce_notifications() from public,anon,authenticated;grant execute on function public.schedule_commerce_notifications() to service_role;
revoke all on public.fulfillment_status_history from public,anon,authenticated;grant select on public.fulfillment_status_history to authenticated;grant all on public.fulfillment_status_history to service_role;revoke execute on function public.transition_fulfillment_order(uuid,public.internal_fulfillment_status,text) from public,anon;grant execute on function public.transition_fulfillment_order(uuid,public.internal_fulfillment_status,text) to authenticated;
revoke execute on function public.transition_delivery_assignment(uuid,public.provider_delivery_status,text) from public,anon;grant execute on function public.transition_delivery_assignment(uuid,public.provider_delivery_status,text) to authenticated;
revoke execute on function public.assign_delivery_driver(uuid,uuid) from public,anon;grant execute on function public.assign_delivery_driver(uuid,uuid) to authenticated;

commit;
