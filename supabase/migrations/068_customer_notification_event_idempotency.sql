begin;

alter table public.customer_notifications
  add column if not exists event_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_notifications'::regclass
      and conname = 'customer_notifications_event_key_unique'
  ) then
    alter table public.customer_notifications
      add constraint customer_notifications_event_key_unique unique (event_key);
  end if;
end
$$;

comment on column public.customer_notifications.event_key is
  'Stable notification event key used to prevent duplicate customer notices.';

commit;
