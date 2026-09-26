begin;

-- Nullable flags preserve the unknown VAT basis of historical customer lines.
alter table public.bunya_customer_quote_items add column vat_inclusive boolean;
alter table public.order_items
  add column vat_inclusive boolean,
  add column bunya_customer_quote_item_id uuid references public.bunya_customer_quote_items(id) on delete restrict;
create unique index order_items_customer_quote_item_idx on public.order_items(bunya_customer_quote_item_id)
  where bunya_customer_quote_item_id is not null;

-- Issued quotes keep their original pricing model. New quotes freeze supplier
-- cost and the additive rate privately; customer-facing rows contain sale prices.
create table public.bunya_quote_item_pricing_snapshots (
  quote_item_id uuid primary key references public.bunya_customer_quote_items(id) on delete restrict,
  bunya_customer_quote_id uuid not null references public.bunya_customer_quotes(id) on delete restrict,
  selected_provider_item_id uuid not null unique references public.selected_provider_items(id) on delete restrict,
  pricing_response_id uuid not null references public.provider_pricing_responses(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  supplier_unit_price numeric(14,2) not null check (supplier_unit_price >= 0),
  supplier_vat_inclusive boolean not null,
  supplier_subtotal numeric(14,2) not null check (supplier_subtotal >= 0),
  supplier_vat_amount numeric(14,2) not null check (supplier_vat_amount >= 0),
  supplier_delivery_fee numeric(14,2) not null check (supplier_delivery_fee >= 0),
  supplier_total numeric(14,2) generated always as (supplier_subtotal + supplier_vat_amount + supplier_delivery_fee) stored,
  platform_commission_rate numeric(5,2) not null check (platform_commission_rate between 0 and 100),
  customer_vat_inclusive boolean not null,
  customer_unit_price numeric(14,2) not null check (customer_unit_price >= 0),
  customer_subtotal numeric(14,2) not null check (customer_subtotal >= 0),
  customer_vat_amount numeric(14,2) not null check (customer_vat_amount >= 0),
  customer_total numeric(14,2) generated always as (customer_subtotal + customer_vat_amount + supplier_delivery_fee) stored,
  platform_markup_amount numeric(14,2) generated always as (customer_subtotal + customer_vat_amount - supplier_subtotal - supplier_vat_amount) stored,
  platform_margin_amount numeric(14,2) generated always as (customer_subtotal - supplier_subtotal) stored,
  created_at timestamptz not null default now(),
  constraint bunya_pricing_customer_gross_math check (
    case when customer_vat_inclusive
      then customer_subtotal + customer_vat_amount = round(quantity * customer_unit_price, 2)
      else customer_subtotal = round(quantity * customer_unit_price, 2)
    end
  ),
  constraint bunya_pricing_customer_vat_math check (
    case when customer_vat_inclusive
      then customer_subtotal = round(quantity * customer_unit_price / 1.15, 2)
      else customer_vat_amount = round(customer_subtotal * 0.15, 2)
    end
  )
);
create index bunya_pricing_quote_provider_idx
  on public.bunya_quote_item_pricing_snapshots(bunya_customer_quote_id, provider_id);
create index bunya_pricing_provider_quote_idx
  on public.bunya_quote_item_pricing_snapshots(provider_id, bunya_customer_quote_id);
create index bunya_pricing_response_idx
  on public.bunya_quote_item_pricing_snapshots(pricing_response_id);

alter table public.bunya_quote_item_pricing_snapshots enable row level security;
revoke all on public.bunya_quote_item_pricing_snapshots from public, anon, authenticated;
grant select on public.bunya_quote_item_pricing_snapshots to authenticated;
create policy bunya_pricing_finance_read
  on public.bunya_quote_item_pricing_snapshots for select to authenticated
  using (public.admin_has_permission('finance.manage'));

comment on table public.bunya_quote_item_pricing_snapshots is
  'Private immutable additive pricing for newly issued quotes. No legacy backfill. Supplier delivery is passed through; markup includes incremental VAT, margin excludes it.';
comment on column public.providers.platform_commission_rate is
  'Additive markup percentage for newly issued customer quotes; frozen privately at assembly. Previously issued quotes and posted transactions retain their original pricing.';

create or replace function public.protect_bunya_pricing_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Quote pricing snapshots are immutable';
end $$;
create trigger bunya_pricing_snapshots_immutable
before update or delete on public.bunya_quote_item_pricing_snapshots
for each row execute function public.protect_bunya_pricing_snapshot();

-- Keep the customer line and the fulfillment source equal to their frozen copy.
create or replace function public.protect_snapshotted_quote_price()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='selected_provider_items' then
    if exists(select 1 from public.bunya_quote_item_pricing_snapshots where selected_provider_item_id=old.id) then
      raise exception 'Issued supplier selection is immutable';
    end if;
  elsif exists(select 1 from public.bunya_quote_item_pricing_snapshots where quote_item_id=old.id) then
    raise exception 'Issued customer quote pricing is immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger selected_provider_items_pricing_immutable
before update of id,selection_result_id,sourcing_request_item_id,pricing_response_id,
  provider_id,quantity,unit_price,subtotal,vat_amount,delivery_fee or delete
on public.selected_provider_items
for each row execute function public.protect_snapshotted_quote_price();
create trigger bunya_quote_items_pricing_immutable
before update of id,bunya_customer_quote_id,quote_request_item_id,product_id,
  product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,
  subtotal,vat_amount,delivery_fee,vat_inclusive or delete
on public.bunya_customer_quote_items
for each row execute function public.protect_snapshotted_quote_price();

create or replace function public.protect_issued_quote_totals()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status<>'preparing'
     and exists(select 1 from public.bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=old.id)
     and (new.customer_request_id is distinct from old.customer_request_id
       or new.subtotal is distinct from old.subtotal or new.vat_amount is distinct from old.vat_amount
       or new.delivery_fee is distinct from old.delivery_fee) then
    raise exception 'Issued customer quote totals are immutable';
  end if;
  return new;
end $$;
create trigger bunya_quotes_pricing_immutable
before update on public.bunya_customer_quotes
for each row execute function public.protect_issued_quote_totals();

create or replace function public.select_best_provider_price(p_sourcing_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_item public.internal_sourcing_request_items%rowtype;
  v_response public.provider_pricing_responses%rowtype;
  v_selection_id uuid;
  v_subtotal numeric(14,2);
  v_vat numeric(14,2);
  v_delivery numeric(14,2);
  v_selected_id uuid;
begin
  if not public.admin_has_permission('sourcing.manage') then
    raise exception 'Not authorized';
  end if;

  select * into v_item
  from public.internal_sourcing_request_items
  where id = p_sourcing_item_id
  for update;
  if not found then raise exception 'Sourcing item not found'; end if;

  -- An issued quote is an immutable offer, including when invoked directly.
  if exists (
    select 1 from public.bunya_customer_quotes quote
    join public.internal_sourcing_requests source on source.customer_request_id=quote.customer_request_id
    where source.id=v_item.sourcing_request_id
      and (quote.status<>'preparing' or exists(select 1 from public.orders where customer_quote_id=quote.id))
  ) then raise exception 'Issued quote cannot be repriced'; end if;

  select r.* into v_response
  from public.provider_pricing_responses r
  join public.provider_availability_confirmations a on a.pricing_response_id = r.id
  join public.provider_delivery_confirmations d on d.pricing_response_id = r.id
  where r.sourcing_request_item_id = v_item.id
    and r.status in ('evaluating','needs_update','selected','not_selected')
    and r.price_expires_at > now()
    and a.available
    and a.available_quantity >= v_item.quantity
    and d.region_eligible
    and now() + make_interval(hours => (d.preparation_duration_hours + d.delivery_duration_hours)::integer) <= v_item.required_at
  order by
    case when r.vat_inclusive
      then round(v_item.quantity * r.unit_price, 2) + d.delivery_fee
      else round(v_item.quantity * r.unit_price * 1.15, 2) + d.delivery_fee
    end,
    r.receipt_confirmed_at,
    r.id
  limit 1
  for update of r;

  if not found then raise exception 'No eligible current provider response'; end if;

  if v_response.vat_inclusive then
    v_subtotal := round((v_item.quantity * v_response.unit_price) / 1.15, 2);
    v_vat := round(v_item.quantity * v_response.unit_price, 2) - v_subtotal;
  else
    v_subtotal := round(v_item.quantity * v_response.unit_price, 2);
    v_vat := round(v_subtotal * 0.15, 2);
  end if;
  select d.delivery_fee into v_delivery from public.provider_delivery_confirmations d where d.pricing_response_id = v_response.id;

  insert into public.internal_selection_results (sourcing_request_id, evaluated_by, selection_notes)
  values (v_item.sourcing_request_id, auth.uid(), 'Minimum eligible landed cost at selection time')
  on conflict (sourcing_request_id) do update set evaluated_by = excluded.evaluated_by
  returning id into v_selection_id;

  insert into public.selected_provider_items (
    selection_result_id, sourcing_request_item_id, pricing_response_id, provider_id,
    quantity, unit_price, subtotal, vat_amount, delivery_fee, selection_reason
  ) values (
    v_selection_id, v_item.id, v_response.id, v_response.provider_id,
    v_item.quantity, v_response.unit_price, v_subtotal, v_vat, v_delivery,
    'minimum_eligible_landed_cost'
  )
  on conflict (selection_result_id, sourcing_request_item_id) do update set
    pricing_response_id = excluded.pricing_response_id,
    provider_id = excluded.provider_id,
    quantity = excluded.quantity,
    unit_price = excluded.unit_price,
    subtotal = excluded.subtotal,
    vat_amount = excluded.vat_amount,
    delivery_fee = excluded.delivery_fee,
    selection_reason = excluded.selection_reason
  returning id into v_selected_id;

  update public.provider_pricing_responses
  set status = case when id = v_response.id then 'selected'::public.provider_pricing_response_status else 'not_selected'::public.provider_pricing_response_status end,
      evaluated_at = now(),
      evaluation_notes = case when id = v_response.id then 'Selected by landed-cost rule' else 'Another eligible response was selected' end
  where sourcing_request_item_id = v_item.id and status in ('evaluating','needs_update','selected','not_selected');

  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values ('sourcing_item', v_item.id, 'provider_price_selected', jsonb_build_object('selected_provider_item_id', v_selected_id));

  return v_selected_id;
end;
$$;


create or replace function public.assemble_bunya_customer_quote(p_sourcing_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_source public.internal_sourcing_requests%rowtype;
  v_existing public.bunya_customer_quotes%rowtype;
  v_item record;
  v_quote uuid;
  v_quote_item uuid;
  v_unit numeric(14,2);
  v_gross numeric(14,2);
  v_subtotal numeric(14,2);
  v_vat numeric(14,2);
  v_rate numeric(5,2);
  v_expected timestamptz;
  v_requested_count integer;
  v_priced_count integer;
begin
  if not public.admin_has_permission('sourcing.manage') then raise exception 'Not authorized'; end if;
  select * into v_source from public.internal_sourcing_requests where id=p_sourcing_request_id for update;
  if not found then raise exception 'Sourcing request not found'; end if;

  select * into v_existing from public.bunya_customer_quotes where customer_request_id=v_source.customer_request_id for update;
  if found then
    if exists(select 1 from public.orders where customer_quote_id=v_existing.id)
       or v_existing.status in ('accepted','rejected','expired') then
      raise exception 'Decided or expired quote cannot be repriced';
    end if;
    -- Also preserve every pre-migration offer. A repeat assembly is idempotent.
    if v_existing.status in ('ready','customer_review') then return v_existing.id; end if;
  end if;

  if v_source.response_deadline_at>now() and exists(
    select 1 from public.internal_sourcing_request_items item
    join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id
    where item.sourcing_request_id=v_source.id and not exists(
      select 1 from public.provider_pricing_responses response
      where response.sourcing_request_item_id=target.sourcing_request_item_id and response.provider_id=target.provider_id
    )
  ) then raise exception 'Provider responses are still pending'; end if;

  for v_item in select id from public.internal_sourcing_request_items where sourcing_request_id=v_source.id order by id loop
    begin
      perform public.select_best_provider_price(v_item.id);
    exception when others then
      if sqlerrm='No eligible current provider response' then
        delete from public.selected_provider_items selected using public.internal_selection_results result
        where selected.selection_result_id=result.id and result.sourcing_request_id=v_source.id
          and selected.sourcing_request_item_id=v_item.id;
      else raise;
      end if;
    end;
  end loop;

  select count(*) into v_requested_count from public.internal_sourcing_request_items where sourcing_request_id=v_source.id;
  select count(*), max(item.required_at) into v_priced_count,v_expected
  from public.selected_provider_items selected
  join public.internal_selection_results result on result.id=selected.selection_result_id
  join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id
  where result.sourcing_request_id=v_source.id;
  if v_priced_count=0 then raise exception 'No items have eligible provider prices'; end if;

  insert into public.bunya_customer_quotes(quote_code,customer_request_id,subtotal,vat_amount,delivery_fee,valid_until,
    expected_delivery_at,terms,status,processing_stage,expected_ready_at,ready_at)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_source.customer_request_id,0,0,0,
    now()+interval '24 hours',v_expected,'عرض موحد من منصة بُنية يشمل الأصناف التي استلمت أسعارًا مؤهلة فقط؛ بيانات المزودين خاصة.','preparing','received',v_source.expected_ready_at,null)
  on conflict(customer_request_id) do update set valid_until=excluded.valid_until,expected_delivery_at=excluded.expected_delivery_at,
    terms=excluded.terms,expected_ready_at=excluded.expected_ready_at,updated_at=now()
  returning id into v_quote;
  delete from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote;

  -- Lock provider rates in a deterministic order; all lines use the same issued rate.
  perform provider.id from public.providers provider
  where provider.id in (
    select selected.provider_id from public.selected_provider_items selected
    join public.internal_selection_results result on result.id=selected.selection_result_id
    where result.sourcing_request_id=v_source.id
  ) order by provider.id for share;

  for v_item in
    select selected.*, item.quote_request_item_id,item.product_id,item.unit_snapshot,item.measurement_snapshot,
      request_item.product_name_snapshot,response.vat_inclusive,provider.platform_commission_rate
    from public.selected_provider_items selected
    join public.internal_selection_results result on result.id=selected.selection_result_id
    join public.internal_sourcing_request_items item on item.id=selected.sourcing_request_item_id
    join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
    join public.provider_pricing_responses response on response.id=selected.pricing_response_id
    join public.providers provider on provider.id=selected.provider_id
    where result.sourcing_request_id=v_source.id order by selected.id
  loop
    v_rate:=v_item.platform_commission_rate;
    -- Preserve the supplier bid's VAT basis. Converting a two-decimal exclusive
    -- unit to an inclusive unit can invent gains/losses for fractional quantities.
    -- At zero markup these formulas exactly preserve the original supplier line.
    v_unit:=round(v_item.unit_price*(1+v_rate/100),2);
    v_gross:=round(v_item.quantity*v_unit,2);
    if v_item.vat_inclusive then
      v_subtotal:=round(v_item.quantity*v_unit/1.15,2);
      v_vat:=v_gross-v_subtotal;
    else
      v_subtotal:=v_gross;
      v_vat:=round(v_subtotal*0.15,2);
    end if;
    insert into public.bunya_customer_quote_items(bunya_customer_quote_id,quote_request_item_id,product_id,
      product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,subtotal,vat_amount,delivery_fee,vat_inclusive)
    values(v_quote,v_item.quote_request_item_id,v_item.product_id,v_item.product_name_snapshot,v_item.quantity,
      v_item.unit_snapshot,v_item.measurement_snapshot,v_unit,v_subtotal,v_vat,v_item.delivery_fee,v_item.vat_inclusive)
    returning id into v_quote_item;

    insert into public.bunya_quote_item_pricing_snapshots(quote_item_id,bunya_customer_quote_id,selected_provider_item_id,
      pricing_response_id,provider_id,quantity,supplier_unit_price,supplier_vat_inclusive,supplier_subtotal,
      supplier_vat_amount,supplier_delivery_fee,platform_commission_rate,customer_unit_price,customer_subtotal,customer_vat_amount,customer_vat_inclusive)
    values(v_quote_item,v_quote,v_item.id,v_item.pricing_response_id,v_item.provider_id,v_item.quantity,v_item.unit_price,
      v_item.vat_inclusive,v_item.subtotal,v_item.vat_amount,v_item.delivery_fee,v_rate,v_unit,v_subtotal,v_vat,v_item.vat_inclusive);
  end loop;

  update public.bunya_customer_quotes quote set
    (subtotal,vat_amount,delivery_fee)=(select sum(item.subtotal),sum(item.vat_amount),sum(item.delivery_fee)
      from public.bunya_customer_quote_items item where item.bunya_customer_quote_id=v_quote),
    status='ready',processing_stage='sent_to_customer',ready_at=now(),updated_at=now()
  where quote.id=v_quote;
  update public.internal_sourcing_requests set stage='sent_to_customer',updated_at=now(),completed_at=now() where id=v_source.id;
  update public.quote_requests set status='verifying'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id and status='sourcing';
  update public.quote_requests set status='quote_ready'::public.quote_request_status,updated_at=now() where id=v_source.customer_request_id;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('customer_quote',v_quote,'customer.quote_ready',jsonb_build_object('requested_item_count',v_requested_count,
    'priced_item_count',v_priced_count,'omitted_item_count',v_requested_count-v_priced_count),'quote-ready:'||v_quote)
  on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),'bunya_customer_quotes',v_quote::text,'quote_assembled',jsonb_build_object('sourcing_request_id',v_source.id,
    'pricing_model','additive_markup_v1','requested_item_count',v_requested_count,'priced_item_count',v_priced_count,
    'omitted_item_count',v_requested_count-v_priced_count));
  return v_quote;
exception when others then
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('sourcing_request',p_sourcing_request_id,'admin.quote_assembly_failed',jsonb_build_object('error',sqlerrm),
    'quote-assembly-failed:'||p_sourcing_request_id||':'||extract(epoch from date_trunc('hour',now()))::bigint)
  on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return null;
end $$;

create or replace function public.accept_customer_quote(p_quote_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_quote public.bunya_customer_quotes%rowtype;
  v_request public.quote_requests%rowtype;
  v_order_id uuid;
  v_existing jsonb;
  v_request_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'Invalid idempotency key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':accept_quote:' || p_idempotency_key, 0));
  v_request_hash := encode(extensions.digest(p_quote_id::text, 'sha256'), 'hex');

  select response_snapshot into v_existing
  from public.idempotency_keys
  where profile_id = auth.uid() and scope = 'accept_customer_quote' and key = p_idempotency_key and request_hash = v_request_hash and status = 'completed';
  if found then return (v_existing ->> 'order_id')::uuid; end if;

  insert into public.idempotency_keys (profile_id, scope, key, request_hash, expires_at)
  values (auth.uid(), 'accept_customer_quote', p_idempotency_key, v_request_hash, now() + interval '24 hours')
  on conflict (profile_id, scope, key) do nothing;

  if exists (select 1 from public.idempotency_keys where profile_id = auth.uid() and scope = 'accept_customer_quote' and key = p_idempotency_key and request_hash <> v_request_hash) then
    raise exception 'Idempotency key was used for another request';
  end if;

  select q.* into v_quote from public.bunya_customer_quotes q where q.id = p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  select r.* into v_request from public.quote_requests r where r.id = v_quote.customer_request_id for update;
  if v_request.requester_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if v_quote.status not in ('ready','customer_review') or v_quote.valid_until <= now() then raise exception 'Quote is not acceptable'; end if;
  if not exists (select 1 from public.bunya_customer_quote_items i where i.bunya_customer_quote_id = v_quote.id) or
     exists (
       select 1 from (
         select round(sum(i.subtotal),2) subtotal, round(sum(i.vat_amount),2) vat_amount,
                round(sum(i.delivery_fee),2) delivery_fee, round(sum(i.line_total),2) total
         from public.bunya_customer_quote_items i where i.bunya_customer_quote_id = v_quote.id
       ) s where s.subtotal <> v_quote.subtotal or s.vat_amount <> v_quote.vat_amount or s.delivery_fee <> v_quote.delivery_fee or s.total <> v_quote.total
     ) then raise exception 'Quote totals do not match quote items'; end if;

  insert into public.orders (
    order_code, customer_quote_id, customer_profile_id, subtotal, vat_amount,
    delivery_fee, discount_amount, total, payment_status, status,
    desired_receipt_at, google_maps_url, latitude, longitude, notes
  ) values (
    'ORD-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_quote.id, auth.uid(), v_quote.subtotal, v_quote.vat_amount,
    v_quote.delivery_fee, 0, v_quote.total, 'pending', 'confirmed',
    v_request.desired_receipt_at, v_request.google_maps_url, v_request.latitude, v_request.longitude, v_request.notes
  ) returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_name_snapshot, measurement_snapshot, unit_price, line_total, vat_inclusive, bunya_customer_quote_item_id)
  select v_order_id, i.product_id, i.product_name_snapshot, i.quantity, i.unit_snapshot, i.measurement_snapshot, i.unit_price, i.line_total, i.vat_inclusive, i.id
  from public.bunya_customer_quote_items i where i.bunya_customer_quote_id = v_quote.id;

  update public.bunya_customer_quotes set status = 'accepted', customer_decided_at = now() where id = v_quote.id;
  update public.quote_requests set status = 'accepted' where id = v_request.id;
  insert into public.order_status_history (order_id, from_status, to_status, label, changed_by)
  values (v_order_id, null, 'confirmed', 'Customer accepted unified Bunya quote', auth.uid());
  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values ('order', v_order_id, 'order_created', jsonb_build_object('customer_quote_id', v_quote.id));

  update public.idempotency_keys set status = 'completed', response_snapshot = jsonb_build_object('order_id', v_order_id)
  where profile_id = auth.uid() and scope = 'accept_customer_quote' and key = p_idempotency_key;
  return v_order_id;
end;
$$;

create or replace function public.complete_accepted_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_invoice uuid;
  v_quote uuid:=new.customer_quote_id;
  v_additive boolean;
begin
  select exists(select 1 from public.bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=v_quote) into v_additive;
  if v_additive and (
    (select count(*) from public.bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=v_quote)
      <> (select count(*) from public.bunya_customer_quote_items where bunya_customer_quote_id=v_quote)
    or exists(
      select 1 from public.bunya_customer_quote_items item
      join public.bunya_quote_item_pricing_snapshots pricing on pricing.quote_item_id=item.id
      where item.bunya_customer_quote_id=v_quote and (
        pricing.bunya_customer_quote_id<>v_quote or pricing.quantity<>item.quantity
        or pricing.customer_unit_price<>item.unit_price or pricing.customer_subtotal<>item.subtotal
        or pricing.customer_vat_amount<>item.vat_amount or pricing.supplier_delivery_fee<>item.delivery_fee
        or pricing.customer_vat_inclusive is distinct from item.vat_inclusive
      )
    )
  ) then raise exception 'Quote pricing snapshot is incomplete'; end if;

  insert into public.invoices(invoice_code,order_id,customer_profile_id,subtotal,vat_amount,delivery_fee,total,status)
  values('INV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),new.id,new.customer_profile_id,new.subtotal,new.vat_amount,new.delivery_fee,new.total,'unpaid')
  returning id into v_invoice;

  insert into public.invoice_items(
    invoice_id,order_item_id,description,quantity,unit_price,vat_rate,vat_amount,line_total,vat_inclusive
  )
  select
    v_invoice,
    order_item.id,
    quote_item.product_name_snapshot,
    quote_item.quantity,
    quote_item.unit_price,
    case when quote_item.vat_inclusive is not null then 15
      when quote_item.subtotal=0 then 0 else round(quote_item.vat_amount/quote_item.subtotal*100,2) end,
    quote_item.vat_amount,
    quote_item.subtotal+quote_item.vat_amount,
    coalesce(quote_item.vat_inclusive,round(quote_item.quantity*quote_item.unit_price,2)=round(quote_item.subtotal+quote_item.vat_amount,2))
  from public.bunya_customer_quote_items quote_item
  -- A product can have several lines with identical quantities. Never multiply
  -- invoice lines through that non-unique join; ambiguous links remain unset.
  left join lateral (
    select case when count(*)=1 then (array_agg(item.id))[1] else null end as id
    from public.order_items item
    where item.order_id=new.id and (
      item.bunya_customer_quote_item_id=quote_item.id or (
      item.bunya_customer_quote_item_id is null and item.product_id=quote_item.product_id
      and item.product_name_snapshot=quote_item.product_name_snapshot
      and item.quantity=quote_item.quantity and item.unit_name_snapshot=quote_item.unit_snapshot
      and item.measurement_snapshot is not distinct from quote_item.measurement_snapshot
      and item.unit_price=quote_item.unit_price and item.line_total=quote_item.line_total))
  ) order_item on true
  where quote_item.bunya_customer_quote_id=v_quote;

  insert into public.payment_records(invoice_id,customer_profile_id,idempotency_key,amount,status)
  values(v_invoice,new.customer_profile_id,'payment-pending:'||new.id,new.total,'pending');

  if v_additive then
    insert into public.internal_fulfillment_orders(
      fulfillment_code,bunya_customer_quote_id,provider_id,delivery_region,required_at,assigned_value,status
    )
    select 'FUL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_quote,
      pricing.provider_id,request.city,request.desired_receipt_at,sum(pricing.supplier_total),'assigned'
    from public.bunya_quote_item_pricing_snapshots pricing
    join public.bunya_customer_quotes quote on quote.id=pricing.bunya_customer_quote_id
    join public.quote_requests request on request.id=quote.customer_request_id
    where pricing.bunya_customer_quote_id=v_quote
    group by pricing.provider_id,request.city,request.desired_receipt_at;

    insert into public.internal_fulfillment_order_items(fulfillment_order_id,selected_provider_item_id)
    select fulfillment.id,pricing.selected_provider_item_id
    from public.internal_fulfillment_orders fulfillment
    join public.bunya_quote_item_pricing_snapshots pricing
      on pricing.bunya_customer_quote_id=fulfillment.bunya_customer_quote_id and pricing.provider_id=fulfillment.provider_id
    where fulfillment.bunya_customer_quote_id=v_quote;
  else
    -- Legacy issued quotes retain their existing supplier assignment semantics.
  insert into public.internal_fulfillment_orders(
    fulfillment_code,bunya_customer_quote_id,provider_id,delivery_region,required_at,assigned_value,status
  )
  select
    'FUL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
    v_quote,selected.provider_id,request.city,request.desired_receipt_at,sum(selected.landed_cost),'assigned'
  from public.selected_provider_items selected
  join public.internal_selection_results selection on selection.id=selected.selection_result_id
  join public.internal_sourcing_requests source on source.id=selection.sourcing_request_id
  join public.quote_requests request on request.id=source.customer_request_id
  where request.id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote)
  group by selected.provider_id,request.city,request.desired_receipt_at;

  insert into public.internal_fulfillment_order_items(fulfillment_order_id,selected_provider_item_id)
  select fulfillment.id,selected.id
  from public.internal_fulfillment_orders fulfillment
  join public.selected_provider_items selected on selected.provider_id=fulfillment.provider_id
  join public.internal_selection_results selection on selection.id=selected.selection_result_id
  join public.internal_sourcing_requests source on source.id=selection.sourcing_request_id
  where fulfillment.bunya_customer_quote_id=v_quote
    and source.customer_request_id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote);

  end if;
  return new;
end
$$;


create or replace function public.record_provider_fulfillment_financials(p_fulfillment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fulfillment public.internal_fulfillment_orders%rowtype;
  v_rate numeric(5,2);
  v_gross numeric(14,2);
  v_commission numeric(14,2);
  v_balance numeric(14,2) := 0;
  v_order_id uuid;
  v_supplier_total numeric(14,2);
  v_posted_at timestamptz := clock_timestamp();
begin
  select f.*
    into v_fulfillment
    from public.internal_fulfillment_orders f
   where f.id = p_fulfillment_id
     and f.payment_released_at is not null
   for update;

  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_fulfillment.provider_id::text || ':provider-ledger', 0)
  );

  if exists (
    select 1
      from public.financial_transactions t
     where t.metadata ->> 'fulfillment_order_id' = v_fulfillment.id::text
       and t.type = 'order_amount'
  ) then
    return;
  end if;

  select p.platform_commission_rate
    into v_rate
    from public.providers p
   where p.id = v_fulfillment.provider_id;

  select o.id
    into v_order_id
    from public.orders o
   where o.customer_quote_id = v_fulfillment.bunya_customer_quote_id;

  select coalesce((
    select t.balance_after
      from public.financial_transactions t
     where t.provider_id = v_fulfillment.provider_id
     order by t.created_at desc, t.id desc
     limit 1
  ), 0)
  into v_balance;

  -- Timestamp after the provider lock so chronological balances remain ordered.
  v_posted_at:=clock_timestamp();
  if exists(select 1 from public.bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=v_fulfillment.bunya_customer_quote_id) then
    select sum(pricing.supplier_total) into v_supplier_total
    from public.bunya_quote_item_pricing_snapshots pricing
    where pricing.bunya_customer_quote_id=v_fulfillment.bunya_customer_quote_id and pricing.provider_id=v_fulfillment.provider_id;
    if v_supplier_total is null or v_supplier_total<>v_fulfillment.assigned_value then
      raise exception 'Fulfillment value does not match supplier pricing snapshot';
    end if;
    -- Platform profit stays in the private immutable quote snapshot. The provider
    -- ledger represents only the supplier's own receivable; no commission debit.
    insert into public.financial_transactions(transaction_code,provider_id,order_id,type,amount,balance_after,
      status,available_at,created_at,metadata)
    values('PGR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_fulfillment.provider_id,
      v_order_id,'order_amount',v_supplier_total,v_balance+v_supplier_total,'available',
      v_fulfillment.payment_released_at,v_posted_at,jsonb_build_object(
        'fulfillment_order_id',v_fulfillment.id,'fulfillment_code',v_fulfillment.fulfillment_code,
        'pricing_model','additive_markup_v1'));
    return;
  end if;

  -- No backfill or repricing: pre-migration offers retain the legacy ledger path.
  v_rate := coalesce(v_rate, 0);
  v_gross := round(v_fulfillment.assigned_value, 2);
  v_commission := round(v_gross * v_rate / 100, 2);

  insert into public.financial_transactions (
    transaction_code,
    provider_id,
    order_id,
    type,
    amount,
    balance_after,
    status,
    available_at,
    created_at,
    metadata
  ) values (
    'PGR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_fulfillment.provider_id,
    v_order_id,
    'order_amount',
    v_gross,
    v_balance + v_gross,
    'available',
    v_fulfillment.payment_released_at,
    v_posted_at,
    jsonb_build_object(
      'fulfillment_order_id', v_fulfillment.id,
      'fulfillment_code', v_fulfillment.fulfillment_code,
      'commission_rate_snapshot', v_rate,
      'commission_amount_snapshot', v_commission
    )
  );

  insert into public.financial_transactions (
    transaction_code,
    provider_id,
    order_id,
    type,
    amount,
    balance_after,
    status,
    available_at,
    created_at,
    metadata
  ) values (
    'PCM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_fulfillment.provider_id,
    v_order_id,
    'commission',
    -v_commission,
    v_balance + v_gross - v_commission,
    'available',
    v_fulfillment.payment_released_at,
    v_posted_at + interval '1 microsecond',
    jsonb_build_object(
      'fulfillment_order_id', v_fulfillment.id,
      'fulfillment_code', v_fulfillment.fulfillment_code,
      'commission_rate_snapshot', v_rate,
      'gross_amount_snapshot', v_gross
    )
  );
end
$$;


create or replace function public.admin_provider_financial_summary()
returns table (
  provider_id uuid,
  company_name text,
  provider_status text,
  commission_rate numeric,
  transaction_count bigint,
  gross_amount numeric,
  bunya_commission numeric,
  net_earned numeric,
  paid_out numeric,
  reserved_for_settlement numeric,
  current_balance numeric,
  available_balance numeric,
  last_transaction_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.admin_has_permission('finance.manage') then
    raise exception 'Finance permission required';
  end if;

  return query
  select
    p.id,
    p.company_name,
    p.status::text,
    p.platform_commission_rate,
    coalesce(f.transaction_count, 0),
    coalesce(f.gross_amount, 0),
    coalesce(f.bunya_commission, 0) + coalesce(markup.platform_margin, 0),
    coalesce(f.net_earned, 0),
    coalesce(s.paid_out, 0),
    coalesce(s.reserved, 0),
    coalesce(latest.balance_after, 0),
    greatest(coalesce(latest.balance_after, 0) - coalesce(s.reserved, 0), 0),
    f.last_transaction_at
  from public.providers p
  left join lateral (
    select
      count(*) filter (where t.type = 'order_amount')::bigint as transaction_count,
      coalesce(sum(t.amount) filter (where t.type = 'order_amount'), 0) as gross_amount,
      coalesce(sum(abs(t.amount)) filter (where t.type = 'commission'), 0) as bunya_commission,
      coalesce(sum(t.amount) filter (
        where t.type in ('order_amount', 'commission', 'refund', 'discount', 'tax')
      ), 0) as net_earned,
      max(t.created_at) as last_transaction_at
    from public.financial_transactions t
    where t.provider_id = p.id
      and t.status in ('available', 'settled', 'reversed')
  ) f on true
  left join lateral (
    select sum(pricing.platform_margin_amount) as platform_margin
    from public.bunya_quote_item_pricing_snapshots pricing
    where pricing.provider_id=p.id and exists(
      select 1 from public.internal_fulfillment_orders fulfillment
      join public.financial_transactions transaction
        on transaction.metadata->>'fulfillment_order_id'=fulfillment.id::text
       and transaction.type='order_amount'
       and transaction.metadata->>'pricing_model'='additive_markup_v1'
       and transaction.status in ('available','settled','reversed')
       and transaction.provider_id=pricing.provider_id
      where fulfillment.bunya_customer_quote_id=pricing.bunya_customer_quote_id
        and fulfillment.provider_id=pricing.provider_id
    )
  ) markup on true
  left join lateral (
    select
      coalesce(sum(sr.amount) filter (where sr.status = 'transferred'), 0) as paid_out,
      coalesce(sum(sr.amount) filter (
        where sr.status in ('pending_review', 'approved', 'transferring')
      ), 0) as reserved
    from public.settlement_requests sr
    where sr.provider_id = p.id
  ) s on true
  left join lateral (
    select t.balance_after
    from public.financial_transactions t
    where t.provider_id = p.id
    order by t.created_at desc, t.id desc
    limit 1
  ) latest on true
  order by coalesce(latest.balance_after, 0) desc, p.company_name;
end
$$;



revoke all on function public.protect_bunya_pricing_snapshot(),
  public.protect_snapshotted_quote_price(), public.protect_issued_quote_totals(), public.complete_accepted_order(),
  public.record_provider_fulfillment_financials(uuid) from public, anon, authenticated;
revoke all on function public.select_best_provider_price(uuid),
  public.assemble_bunya_customer_quote(uuid), public.accept_customer_quote(uuid,text), public.admin_provider_financial_summary() from public, anon;
grant execute on function public.select_best_provider_price(uuid),
  public.assemble_bunya_customer_quote(uuid), public.accept_customer_quote(uuid,text), public.admin_provider_financial_summary() to authenticated;

commit;
