begin;

create or replace function public.ensure_unique_contractor_catalog_outbox_key()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.idempotency_key is not null
    and (
      new.idempotency_key like 'service-submit:%'
      or new.idempotency_key like 'portfolio-submit:%'
      or new.idempotency_key like 'service-review:%'
      or new.idempotency_key like 'portfolio-review:%'
    )
    and exists (
      select 1
      from public.outbox_events existing
      where existing.idempotency_key = new.idempotency_key
    )
  then
    new.idempotency_key := new.idempotency_key || ':' || replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end
$$;

drop trigger if exists outbox_contractor_catalog_unique_key on public.outbox_events;
create trigger outbox_contractor_catalog_unique_key
before insert on public.outbox_events
for each row
execute function public.ensure_unique_contractor_catalog_outbox_key();

commit;
