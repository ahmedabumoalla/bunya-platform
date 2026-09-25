begin;

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

revoke execute on function public.record_provider_fulfillment_financials(uuid)
  from public, anon, authenticated;

commit;
