begin;

-- A paid delivery may receive its first driver after the route started (for
-- example an operational recovery), but an already assigned driver cannot be
-- replaced after pickup. Direct writes still require an active owned driver.
create or replace function public.validate_provider_delivery_assignment()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE'
     and coalesce(auth.jwt()->>'role','')<>'service_role'
     and not public.admin_has_permission('deliveries.manage')
     and (
       new.provider_id is distinct from old.provider_id
       or new.order_id is distinct from old.order_id
       or new.fulfillment_order_id is distinct from old.fulfillment_order_id
       or new.expected_at is distinct from old.expected_at
       or new.assigned_at is distinct from old.assigned_at
       or new.created_at is distinct from old.created_at
     )
  then raise exception 'Delivery assignment identity and schedule are protected';
  end if;

  if not exists(
    select 1
    from public.internal_fulfillment_orders f
    join public.orders o on o.customer_quote_id=f.bunya_customer_quote_id
    where f.id=new.fulfillment_order_id
      and f.provider_id=new.provider_id
      and o.id=new.order_id
  ) then raise exception 'Delivery assignment must match the provider fulfillment and customer order';
  end if;

  if new.assigned_driver_id is not null and not exists(
    select 1 from public.provider_drivers d
    where d.id=new.assigned_driver_id
      and d.provider_id=new.provider_id
      and d.status='active'
  ) then raise exception 'Driver must be active and owned by provider';
  end if;

  if tg_op='UPDATE'
     and old.status<>'assigned'
     and new.assigned_driver_id is distinct from old.assigned_driver_id
     and not (
       old.assigned_driver_id is null
       and new.assigned_driver_id is not null
       and old.status in ('picked_up','in_transit','arrived')
     )
  then raise exception 'Assigned driver cannot change after delivery starts';
  end if;
  return new;
end
$$;

create or replace function public.assign_delivery_driver(
  p_fulfillment_id uuid,
  p_driver_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_f public.internal_fulfillment_orders%rowtype;
  v_assignment public.provider_delivery_assignments%rowtype;
begin
  select * into v_f
  from public.internal_fulfillment_orders
  where id=p_fulfillment_id
  for update;
  if not found or not public.is_provider_member(v_f.provider_id) then
    raise exception 'Not authorized';
  end if;
  if v_f.payment_released_at is null or v_f.status not in ('ready','out_for_delivery') then
    raise exception 'Fulfillment is not ready for driver assignment';
  end if;
  if not exists(
    select 1 from public.provider_drivers d
    where d.id=p_driver_id and d.provider_id=v_f.provider_id and d.status='active'
  ) then raise exception 'Driver is not active';
  end if;

  select * into v_assignment
  from public.provider_delivery_assignments
  where fulfillment_order_id=p_fulfillment_id
  for update;
  if not found then raise exception 'Delivery assignment not found'; end if;
  if v_assignment.status in ('delivered','failed_delivery') then
    raise exception 'Delivery is already closed';
  end if;
  if v_assignment.assigned_driver_id=p_driver_id then return v_assignment.id; end if;
  if v_assignment.assigned_driver_id is not null and v_assignment.status<>'assigned' then
    raise exception 'Assigned driver cannot change after delivery starts';
  end if;

  update public.provider_delivery_assignments
  set assigned_driver_id=p_driver_id,updated_at=now()
  where id=v_assignment.id;

  insert into public.outbox_events(
    aggregate_type,aggregate_id,event_type,payload,idempotency_key
  ) values(
    'delivery',v_assignment.id,'customer.delivery_assigned',
    jsonb_build_object('order_id',v_assignment.order_id,'driver_id',p_driver_id),
    'delivery-assigned:'||v_assignment.id||':'||p_driver_id
  ) on conflict(idempotency_key) do nothing;

  insert into public.audit_logs(
    actor_profile_id,entity_table,entity_id,action,new_data
  ) values(
    auth.uid(),'provider_delivery_assignments',v_assignment.id::text,
    'provider_driver_assigned',
    jsonb_build_object(
      'fulfillment_order_id',p_fulfillment_id,
      'driver_id',p_driver_id,
      'delivery_status',v_assignment.status
    )
  );
  return v_assignment.id;
end
$$;

revoke execute on function public.assign_delivery_driver(uuid,uuid) from public,anon;
grant execute on function public.assign_delivery_driver(uuid,uuid) to authenticated;

commit;
