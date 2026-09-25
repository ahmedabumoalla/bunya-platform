begin;

drop index if exists public.outbox_events_idempotency_idx;

alter table public.outbox_events
  add constraint outbox_events_idempotency_key_unique unique (idempotency_key);

commit;
