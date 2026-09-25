begin;

do $$
begin
  if exists (
    select event_key
    from public.contractor_notifications
    where event_key is not null
    group by event_key
    having count(*) > 1
  ) then
    raise exception '079 cannot enforce contractor notification idempotency because duplicates exist';
  end if;
end
$$;

drop index if exists public.contractor_notifications_event_key_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contractor_notifications'::regclass
      and conname = 'contractor_notifications_event_key_unique'
  ) then
    alter table public.contractor_notifications
      add constraint contractor_notifications_event_key_unique unique (event_key);
  end if;
end
$$;

comment on column public.contractor_notifications.event_key is
  'Stable event key used to prevent duplicate contractor notices.';

commit;
