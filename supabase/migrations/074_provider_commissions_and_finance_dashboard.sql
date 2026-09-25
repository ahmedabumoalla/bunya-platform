begin;

alter table public.providers
  add column if not exists platform_commission_rate numeric(5,2) not null default 0;

alter table public.providers
  drop constraint if exists providers_platform_commission_rate_check;
alter table public.providers
  add constraint providers_platform_commission_rate_check
  check (platform_commission_rate between 0 and 100);

create unique index if not exists financial_transactions_fulfillment_type_unique
  on public.financial_transactions ((metadata ->> 'fulfillment_order_id'), type)
  where metadata ? 'fulfillment_order_id';

create unique index if not exists financial_transactions_settlement_unique
  on public.financial_transactions ((metadata ->> 'settlement_request_id'))
  where metadata ? 'settlement_request_id';

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
    jsonb_build_object(
      'fulfillment_order_id', v_fulfillment.id,
      'fulfillment_code', v_fulfillment.fulfillment_code,
      'commission_rate_snapshot', v_rate,
      'gross_amount_snapshot', v_gross
    )
  );
end
$$;

create or replace function public.record_provider_fulfillment_financials_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.record_provider_fulfillment_financials(new.id);
  return new;
end
$$;

drop trigger if exists internal_fulfillment_record_financials
  on public.internal_fulfillment_orders;
create trigger internal_fulfillment_record_financials
after update of payment_released_at on public.internal_fulfillment_orders
for each row
when (old.payment_released_at is null and new.payment_released_at is not null)
execute function public.record_provider_fulfillment_financials_trigger();

create or replace function public.record_provider_settlement_financials_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(14,2) := 0;
begin
  if old.status = 'transferred' or new.status <> 'transferred' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.provider_id::text || ':provider-ledger', 0)
  );

  if exists (
    select 1
      from public.financial_transactions t
     where t.metadata ->> 'settlement_request_id' = new.id::text
  ) then
    return new;
  end if;

  select coalesce((
    select t.balance_after
      from public.financial_transactions t
     where t.provider_id = new.provider_id
     order by t.created_at desc, t.id desc
     limit 1
  ), 0)
  into v_balance;

  insert into public.financial_transactions (
    transaction_code,
    provider_id,
    type,
    amount,
    balance_after,
    status,
    available_at,
    metadata
  ) values (
    'PST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    new.provider_id,
    'settlement',
    -new.amount,
    v_balance - new.amount,
    'settled',
    coalesce(new.transferred_at, now()),
    jsonb_build_object(
      'settlement_request_id', new.id,
      'settlement_code', new.settlement_code
    )
  );

  return new;
end
$$;

drop trigger if exists settlement_request_record_financials
  on public.settlement_requests;
create trigger settlement_request_record_financials
after update of status on public.settlement_requests
for each row
when (old.status is distinct from new.status)
execute function public.record_provider_settlement_financials_trigger();

create or replace function public.admin_set_provider_commission(
  p_provider_id uuid,
  p_rate numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous numeric(5,2);
  v_rate numeric(5,2);
begin
  if not public.admin_has_permission('finance.manage') then
    raise exception 'Finance permission required';
  end if;

  v_rate := round(p_rate, 2);
  if v_rate is null or v_rate < 0 or v_rate > 100 then
    raise exception 'Commission rate must be between 0 and 100';
  end if;

  select p.platform_commission_rate
    into v_previous
    from public.providers p
   where p.id = p_provider_id
   for update;

  if not found then
    raise exception 'Provider not found';
  end if;

  update public.providers
     set platform_commission_rate = v_rate,
         updated_at = now()
   where id = p_provider_id;

  insert into public.audit_logs (
    actor_profile_id,
    provider_id,
    entity_table,
    entity_id,
    action,
    old_data,
    new_data
  ) values (
    auth.uid(),
    p_provider_id,
    'providers',
    p_provider_id::text,
    'provider_commission_rate_updated',
    jsonb_build_object('platform_commission_rate', v_previous),
    jsonb_build_object('platform_commission_rate', v_rate)
  );

  return v_rate;
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
    coalesce(f.bunya_commission, 0),
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

create or replace function public.protect_provider_financial_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Provider financial history is immutable';
end
$$;

drop trigger if exists financial_transactions_immutable_update
  on public.financial_transactions;
create trigger financial_transactions_immutable_update
before update on public.financial_transactions
for each row
execute function public.protect_provider_financial_update();

do $$
declare
  v_fulfillment record;
begin
  for v_fulfillment in
    select f.id
      from public.internal_fulfillment_orders f
     where f.payment_released_at is not null
     order by f.payment_released_at, f.id
  loop
    perform public.record_provider_fulfillment_financials(v_fulfillment.id);
  end loop;
end
$$;

revoke execute on function public.record_provider_fulfillment_financials(uuid)
  from public, anon, authenticated;
revoke execute on function public.record_provider_fulfillment_financials_trigger()
  from public, anon, authenticated;
revoke execute on function public.record_provider_settlement_financials_trigger()
  from public, anon, authenticated;
revoke execute on function public.protect_provider_financial_update()
  from public, anon, authenticated;
revoke execute on function public.admin_set_provider_commission(uuid, numeric)
  from public, anon;
revoke execute on function public.admin_provider_financial_summary()
  from public, anon;

grant execute on function public.admin_set_provider_commission(uuid, numeric)
  to authenticated;
grant execute on function public.admin_provider_financial_summary()
  to authenticated;

comment on column public.providers.platform_commission_rate is
  'Percentage charged by Bunya on new paid provider fulfillments. Historical transactions keep their rate snapshot.';

commit;
