begin;

create or replace function public.enforce_provider_price_customer_validity()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_required_until timestamptz;
begin
  select target.response_deadline_at + interval '48 hours'
  into v_required_until
  from public.internal_sourcing_request_targets target
  where target.sourcing_request_item_id = new.sourcing_request_item_id
    and target.provider_id = new.provider_id;

  if v_required_until is null or new.price_expires_at < v_required_until then
    raise exception 'Price validity must cover the 48-hour customer quote window';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_provider_price_customer_validity() from public,anon,authenticated;

drop trigger if exists provider_price_customer_validity on public.provider_pricing_responses;
create trigger provider_price_customer_validity
before insert or update of price_expires_at on public.provider_pricing_responses
for each row execute function public.enforce_provider_price_customer_validity();

commit;
