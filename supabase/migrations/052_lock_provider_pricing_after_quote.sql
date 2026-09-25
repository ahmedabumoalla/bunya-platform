begin;

create or replace function public.enforce_open_provider_pricing_stage()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_source_stage public.quote_processing_stage;
  v_request_status public.quote_request_status;
begin
  if tg_op='UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.vat_inclusive is not distinct from old.vat_inclusive
     and new.price_expires_at is not distinct from old.price_expires_at
     and new.internal_notes is not distinct from old.internal_notes then
    return new;
  end if;

  select source.stage,request.status
  into v_source_stage,v_request_status
  from public.internal_sourcing_request_items item
  join public.internal_sourcing_requests source on source.id=item.sourcing_request_id
  join public.quote_requests request on request.id=source.customer_request_id
  where item.id=new.sourcing_request_item_id;

  if v_source_stage<>'comparing_prices' or v_request_status<>'sourcing' then
    raise exception 'Pricing is closed because the customer quote has already been assembled';
  end if;

  if tg_op='UPDATE' and old.status not in ('evaluating','needs_update') then
    raise exception 'Selected or closed provider responses cannot be revised';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_open_provider_pricing_stage() from public,anon,authenticated;

drop trigger if exists provider_pricing_open_stage on public.provider_pricing_responses;
create trigger provider_pricing_open_stage
before insert or update of unit_price,vat_inclusive,price_expires_at,internal_notes
on public.provider_pricing_responses
for each row execute function public.enforce_open_provider_pricing_stage();

commit;
