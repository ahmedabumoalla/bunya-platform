begin;

-- The digest remains the source of truth for verification. This ciphertext is
-- decrypted only by the authenticated customer API after ownership and payment
-- checks, so drivers/providers can validate a code but cannot retrieve it.
alter table public.delivery_confirmation_codes
  add column if not exists customer_code_ciphertext text;

alter table public.delivery_confirmation_codes
  drop constraint if exists delivery_confirmation_customer_ciphertext_format;
alter table public.delivery_confirmation_codes
  add constraint delivery_confirmation_customer_ciphertext_format
  check (
    customer_code_ciphertext is null
    or customer_code_ciphertext ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  );

comment on column public.delivery_confirmation_codes.customer_code_ciphertext is
  'AES-256-GCM ciphertext for customer-only display through the trusted backend; never selected by client roles.';

commit;
