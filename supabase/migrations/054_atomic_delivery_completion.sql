begin;

alter table public.provider_delivery_updates
  drop constraint if exists provider_delivery_updates_actor_role_check;
alter table public.provider_delivery_updates
  add constraint provider_delivery_updates_actor_role_check
  check (actor_role in ('driver','provider','customer','admin'));

alter table public.delivery_confirmation_records
  drop constraint if exists delivery_confirmation_records_confirmed_by_role_check;
alter table public.delivery_confirmation_records
  add constraint delivery_confirmation_records_confirmed_by_role_check
  check (confirmed_by_role in ('driver','provider','customer'));
alter table public.delivery_confirmation_records
  drop constraint if exists confirmation_actor_shape;
alter table public.delivery_confirmation_records
  add constraint confirmation_actor_shape check (
    (method='driver' and assigned_driver_id is not null and confirmed_by_role='driver')
    or (method='provider' and confirmed_by_role='provider')
    or (method='customer' and confirmed_by_role='customer')
  );

alter table public.delivery_confirmation_attempts
  drop constraint if exists delivery_confirmation_attempts_attempted_by_role_check;
alter table public.delivery_confirmation_attempts
  add constraint delivery_confirmation_attempts_attempted_by_role_check
  check (attempted_by_role in ('driver','provider','customer'));

create or replace function public.transition_delivery_assignment(
  p_assignment_id uuid,
  p_status public.provider_delivery_status,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_assignment public.provider_delivery_assignments%rowtype;
  v_fulfillment public.internal_fulfillment_orders%rowtype;
  v_driver uuid;
  v_is_provider boolean;
  v_is_driver boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_assignment
  from public.provider_delivery_assignments
  where id=p_assignment_id
  for update;
  if not found then raise exception 'Assignment not found'; end if;

  v_driver:=public.current_provider_driver_id();
  v_is_provider:=public.is_provider_member(v_assignment.provider_id);
  v_is_driver:=v_assignment.assigned_driver_id is not null
    and v_assignment.assigned_driver_id=v_driver
    and exists(
      select 1 from public.provider_drivers d
      where d.id=v_driver and d.status='active'
    );
  if not v_is_provider and not v_is_driver then raise exception 'Not authorized'; end if;
  if v_assignment.status=p_status then return; end if;

  if not (
    (v_assignment.status='assigned' and p_status in ('picked_up','failed_delivery'))
    or (v_assignment.status='picked_up' and p_status in ('in_transit','failed_delivery'))
    or (v_assignment.status='in_transit' and p_status in ('arrived','failed_delivery'))
  ) then raise exception 'Invalid provider delivery transition'; end if;

  select * into v_fulfillment
  from public.internal_fulfillment_orders
  where id=v_assignment.fulfillment_order_id
  for update;
  if not found or v_fulfillment.payment_released_at is null then
    raise exception 'Payment is not released';
  end if;

  if p_status='picked_up' then
    if v_fulfillment.status<>'ready' then raise exception 'Fulfillment is not ready'; end if;
    update public.internal_fulfillment_orders
    set status='out_for_delivery',updated_at=now()
    where id=v_fulfillment.id;
    insert into public.fulfillment_status_history(
      fulfillment_order_id,from_status,to_status,actor_profile_id,note
    ) values(
      v_fulfillment.id,v_fulfillment.status,'out_for_delivery',auth.uid(),nullif(btrim(p_note),'')
    );
  end if;

  update public.provider_delivery_assignments
  set status=p_status,
      pickup_at=case when p_status='picked_up' then now() else pickup_at end,
      delivery_note=coalesce(nullif(btrim(p_note),''),delivery_note),
      updated_at=now()
  where id=p_assignment_id;
end
$$;

create or replace function public.record_delivery_transition()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_event text;
  v_actor_role text;
begin
  if old.status=new.status then return new; end if;

  v_actor_role:=case
    when exists(
      select 1 from public.orders o
      where o.id=new.order_id and o.customer_profile_id=auth.uid()
    ) then 'customer'
    when public.current_provider_driver_id()=new.assigned_driver_id then 'driver'
    else 'provider'
  end;

  insert into public.provider_delivery_updates(
    assignment_id,from_status,to_status,actor_role,actor_user_id,note
  ) values(
    new.id,old.status,new.status,v_actor_role,auth.uid(),new.delivery_note
  );

  if new.status='picked_up' then
    update public.orders set status='assigned_driver',updated_at=now()
    where id=new.order_id and status='ready_for_pickup';
  elsif new.status in ('in_transit','arrived') then
    update public.orders set status='out_for_delivery',updated_at=now()
    where id=new.order_id and status='assigned_driver';
  end if;

  if new.status='delivered' then return new; end if;
  v_event:=case new.status
    when 'picked_up' then 'customer.delivery_out_for_delivery'
    when 'in_transit' then 'customer.delivery_out_for_delivery'
    when 'arrived' then 'customer.driver_arrived'
    when 'failed_delivery' then 'customer.delivery_failed'
    else 'customer.delivery_assigned'
  end;
  insert into public.outbox_events(
    aggregate_type,aggregate_id,event_type,payload,idempotency_key
  ) values(
    'delivery',new.id,v_event,jsonb_build_object('order_id',new.order_id),
    'delivery-status:'||new.id||':'||new.status
  ) on conflict(idempotency_key) do nothing;
  return new;
end
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
  v_is_customer boolean:=false;
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
  v_is_customer:=exists(
    select 1 from public.orders o
    where o.id=v_assignment.order_id and o.customer_profile_id=auth.uid()
  );
  if not v_is_driver and not v_is_provider and not v_is_customer then
    raise exception 'Not authorized';
  end if;

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

  v_actor_role:=case when v_is_customer then 'customer' when v_is_driver then 'driver' else 'provider' end;
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

drop function if exists public.get_customer_deliveries();
create function public.get_customer_deliveries()
returns table (
  delivery_id uuid,
  order_id uuid,
  order_code text,
  delivery_status public.provider_delivery_status,
  expected_at timestamptz,
  delivered_at timestamptz,
  driver_name text,
  latest_status public.provider_delivery_status,
  latest_update_at timestamptz,
  google_maps_url text,
  location_hint text,
  code_expires_at timestamptz,
  code_verified_at timestamptz,
  attempts_remaining integer,
  can_confirm boolean,
  confirmed_at timestamptz,
  order_status public.provider_order_status
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select a.id,o.id,o.order_code,a.status,a.expected_at,a.delivered_at,d.full_name,
         u.to_status,u.created_at,r.google_maps_url,r.location_hint,c.expires_at,c.verified_at,
         greatest(coalesce(c.max_attempts,0)-coalesce(c.attempts,0),0)::integer,
         (a.status='arrived' and c.verified_at is null and c.expires_at>now()
          and c.attempts<c.max_attempts and coalesce(c.locked_until,'-infinity'::timestamptz)<=now()),
         cr.confirmed_at,o.status
  from public.orders o
  join public.provider_delivery_assignments a on a.order_id=o.id
  join public.bunya_customer_quotes q on q.id=o.customer_quote_id
  join public.quote_requests r on r.id=q.customer_request_id
  left join public.provider_drivers d on d.id=a.assigned_driver_id
  left join public.delivery_confirmation_codes c on c.assignment_id=a.id
  left join public.delivery_confirmation_records cr on cr.assignment_id=a.id
  left join lateral (
    select x.to_status,x.created_at from public.provider_delivery_updates x
    where x.assignment_id=a.id order by x.created_at desc limit 1
  ) u on true
  where o.customer_profile_id=auth.uid()
  order by a.expected_at desc;
$$;

create or replace function public.get_my_driver_deliveries()
returns table (
  delivery_id uuid,
  order_id uuid,
  order_code text,
  fulfillment_code text,
  delivery_status public.provider_delivery_status,
  expected_at timestamptz,
  delivered_at timestamptz,
  google_maps_url text,
  location_hint text,
  recipient_name text,
  recipient_mobile text,
  site_responsible_name text,
  site_responsible_mobile text,
  working_hours text,
  loading_option text,
  unloading_option text,
  road_access text,
  access_instructions text,
  can_confirm boolean
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select a.id,o.id,o.order_code,f.fulfillment_code,a.status,a.expected_at,a.delivered_at,
         r.google_maps_url,r.location_hint,r.recipient_name,r.recipient_mobile,
         r.site_responsible_name,r.site_responsible_mobile,r.working_hours,
         r.loading_option,r.unloading_option,r.road_access,r.access_instructions,
         (a.status='arrived' and c.verified_at is null and c.expires_at>now()
          and c.attempts<c.max_attempts and coalesce(c.locked_until,'-infinity'::timestamptz)<=now())
  from public.provider_delivery_assignments a
  join public.orders o on o.id=a.order_id
  join public.internal_fulfillment_orders f on f.id=a.fulfillment_order_id
  join public.bunya_customer_quotes q on q.id=o.customer_quote_id
  join public.quote_requests r on r.id=q.customer_request_id
  left join public.delivery_confirmation_codes c on c.assignment_id=a.id
  where a.assigned_driver_id=public.current_provider_driver_id()
    and exists(
      select 1 from public.provider_drivers d
      where d.id=a.assigned_driver_id and d.status='active'
    )
  order by case when a.status in ('delivered','failed_delivery') then 1 else 0 end,a.expected_at;
$$;

drop policy if exists delivery_confirmations_participant_read on public.delivery_confirmation_records;
create policy delivery_confirmations_participant_read
on public.delivery_confirmation_records for select to authenticated
using (exists(
  select 1
  from public.provider_delivery_assignments a
  join public.orders o on o.id=a.order_id
  where a.id=assignment_id and (
    public.is_provider_member(a.provider_id)
    or a.assigned_driver_id=public.current_provider_driver_id()
    or o.customer_profile_id=auth.uid()
    or public.is_admin()
  )
));

revoke execute on function public.get_my_driver_deliveries() from public,anon;
revoke execute on function public.get_customer_deliveries() from public,anon;
revoke execute on function public.confirm_delivery_code(uuid,text) from public,anon;
revoke execute on function public.transition_delivery_assignment(uuid,public.provider_delivery_status,text) from public,anon;
grant execute on function public.get_my_driver_deliveries() to authenticated;
grant execute on function public.get_customer_deliveries() to authenticated;
grant execute on function public.confirm_delivery_code(uuid,text) to authenticated;
grant execute on function public.transition_delivery_assignment(uuid,public.provider_delivery_status,text) to authenticated;

commit;
