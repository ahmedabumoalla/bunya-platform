begin;

create table public.pending_quote_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pending_quote_drafts_expiry_idx on public.pending_quote_drafts (expires_at);
alter table public.pending_quote_drafts enable row level security;
revoke all on table public.pending_quote_drafts from anon, authenticated;

create or replace function public.submit_storefront_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_request_id := public.submit_customer_rfq(p_request, p_items, p_idempotency_key);

  update public.quote_requests
  set google_maps_url = nullif(btrim(p_request ->> 'google_maps_url'), '')
  where id = v_request_id
    and requester_id = auth.uid();

  return v_request_id;
end
$$;

revoke execute on function public.submit_storefront_rfq(jsonb,jsonb,text) from public, anon;
grant execute on function public.submit_storefront_rfq(jsonb,jsonb,text) to authenticated;

commit;
