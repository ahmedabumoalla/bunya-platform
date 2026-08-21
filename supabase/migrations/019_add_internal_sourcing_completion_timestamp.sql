begin;

do $$
begin
  if to_regclass('public.internal_sourcing_requests') is null then
    raise exception '019 requires internal_sourcing_requests from migration 001';
  end if;
  if to_regprocedure('public.assemble_bunya_customer_quote(uuid)') is null then
    raise exception '019 requires assemble_bunya_customer_quote from migration 005';
  end if;
end
$$;

-- assemble_bunya_customer_quote records completion after producing the unified
-- quote. Migration 005 referenced this field without adding it to the table.
alter table public.internal_sourcing_requests
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'internal_sourcing_requests'
      and column_name = 'completed_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception '019 internal_sourcing_requests.completed_at has an incompatible type';
  end if;
end
$$;

commit;
