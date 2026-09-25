begin;

create or replace function public.get_customer_delivery_tracking(
  p_customer_quote_id uuid,
  p_request_id uuid
)
returns table (
  delivery_id uuid,
  order_id uuid,
  order_code text,
  order_status public.provider_order_status,
  payment_status text,
  delivery_status public.provider_delivery_status,
  expected_at timestamptz,
  delivered_at timestamptz,
  assigned_at timestamptz,
  driver_name text,
  driver_mobile text,
  latest_status public.provider_delivery_status,
  latest_update_at timestamptz,
  google_maps_url text,
  location_hint text
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select a.id,o.id,o.order_code,o.status,o.payment_status,a.status,a.expected_at,
         a.delivered_at,a.assigned_at,d.full_name,d.mobile,u.to_status,u.created_at,
         r.google_maps_url,r.location_hint
  from public.orders o
  join public.bunya_customer_quotes q on q.id=o.customer_quote_id
  join public.quote_requests r on r.id=q.customer_request_id
  join public.provider_delivery_assignments a on a.order_id=o.id
  left join public.provider_drivers d on d.id=a.assigned_driver_id
  left join lateral (
    select x.to_status,x.created_at
    from public.provider_delivery_updates x
    where x.assignment_id=a.id
    order by x.created_at desc
    limit 1
  ) u on true
  where o.customer_profile_id=auth.uid()
    and (
      (p_customer_quote_id is not null and q.id=p_customer_quote_id)
      or (p_request_id is not null and q.customer_request_id=p_request_id)
    )
  order by a.expected_at
  limit 1;
$$;

create or replace function public.confirm_delivery_code(
  p_assignment_id uuid,
  p_plain_code text
) returns boolean
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_assignment public.provider_delivery_assignments%rowtype;
  v_code public.delivery_confirmation_codes%rowtype;
  v_fulfillment public.internal_fulfillment_orders%rowtype;
  v_driver_id uuid;
  v_is_driver boolean:=false;
  v_is_provider boolean:=false;
  v_actor_role text;
  v_method public.delivery_confirmation_method;
  v_valid boolean;
begin
  if auth.uid() is null or btrim(coalesce(p_plain_code,'')) !~ '^[0-9]{4,12}$' then
    return false;
  end if;

  select * into v_assignment
  from public.provider_delivery_assignments
  where id=p_assignment_id
  for update;
  if not found then return false; end if;

  v_driver_id:=public.current_provider_driver_id();
  v_is_driver:=v_assignment.assigned_driver_id is not null
    and v_assignment.assigned_driver_id=v_driver_id
    and exists(select 1 from public.provider_drivers d where d.id=v_driver_id and d.status='active');
  v_is_provider:=public.is_provider_member(v_assignment.provider_id);
  if not v_is_driver and not v_is_provider then raise exception 'Not authorized'; end if;

  if v_assignment.status='delivered' and exists(
    select 1 from public.delivery_confirmation_records r
    where r.assignment_id=p_assignment_id
  ) then return true; end if;
  if v_assignment.status<>'arrived' then return false; end if;

  select * into v_code
  from public.delivery_confirmation_codes
  where assignment_id=p_assignment_id
  for update;
  if not found
     or v_code.verified_at is not null
     or v_code.expires_at<=now()
     or v_code.attempts>=v_code.max_attempts
     or coalesce(v_code.locked_until,'-infinity'::timestamptz)>now()
  then return false; end if;

  v_actor_role:=case when v_is_driver then 'driver' else 'provider' end;
  v_method:=v_actor_role::public.delivery_confirmation_method;
  v_valid:=v_code.code_hash=encode(
    extensions.digest(v_code.code_salt||':'||btrim(p_plain_code),'sha256'),'hex'
  );

  update public.delivery_confirmation_codes
  set attempts=attempts+1,
      verified_at=case when v_valid then now() else verified_at end,
      locked_until=case
        when not v_valid and attempts+1>=max_attempts then now()+interval '15 minutes'
        else locked_until
      end
  where assignment_id=p_assignment_id;

  insert into public.delivery_confirmation_attempts(
    assignment_id,attempted_by_role,attempted_by_user_id,succeeded,locked_until
  ) values(
    p_assignment_id,v_actor_role,auth.uid(),v_valid,
    case when not v_valid and v_code.attempts+1>=v_code.max_attempts
      then now()+interval '15 minutes' end
  );
  if not v_valid then return false; end if;

  update public.provider_delivery_assignments
  set status='delivered',delivered_at=now(),updated_at=now()
  where id=p_assignment_id;

  insert into public.delivery_confirmation_records(
    assignment_id,method,confirmed_by_user_id,confirmed_by_role,
    assigned_driver_id,delivery_reference
  ) values(
    p_assignment_id,v_method,auth.uid(),v_actor_role,
    v_assignment.assigned_driver_id,v_assignment.id::text
  ) on conflict(assignment_id) do nothing;

  select * into v_fulfillment
  from public.internal_fulfillment_orders
  where id=v_assignment.fulfillment_order_id
  for update;
  if v_fulfillment.status='out_for_delivery' then
    update public.internal_fulfillment_orders
    set status='delivered',updated_at=now()
    where id=v_fulfillment.id;
    insert into public.fulfillment_status_history(
      fulfillment_order_id,from_status,to_status,actor_profile_id,note
    ) values(
      v_fulfillment.id,'out_for_delivery','delivered',auth.uid(),'تم التحقق من رمز التسليم'
    );
  elsif v_fulfillment.status<>'delivered' then
    raise exception 'Fulfillment is not out for delivery';
  end if;

  if not exists(
    select 1 from public.provider_delivery_assignments a
    where a.order_id=v_assignment.order_id and a.status<>'delivered'
  ) then
    update public.orders set status='delivered',updated_at=now()
    where id=v_assignment.order_id and status='out_for_delivery';
    update public.orders set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
    where id=v_assignment.order_id and status='delivered';
  end if;

  insert into public.outbox_events(
    aggregate_type,aggregate_id,event_type,payload,idempotency_key
  ) values(
    'delivery',p_assignment_id,'delivery_confirmed',
    jsonb_build_object('order_id',v_assignment.order_id,'confirmed_by',v_actor_role),
    'delivery-confirmed:'||p_assignment_id
  ) on conflict(idempotency_key) do nothing;
  return true;
end
$$;

revoke execute on function public.get_customer_delivery_tracking(uuid,uuid) from public,anon;
revoke execute on function public.confirm_delivery_code(uuid,text) from public,anon;
grant execute on function public.get_customer_delivery_tracking(uuid,uuid) to authenticated;
grant execute on function public.confirm_delivery_code(uuid,text) to authenticated;

commit;
