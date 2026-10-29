begin;

-- Independent, immutable sales quotations. Customer accounts and requests are
-- optional. Only authorized server routes may expose private contact details.
create table public.price_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_code text not null unique,
  source_request_id uuid references public.managed_quote_requests(id) on delete restrict,
  source_request_code text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  customer_name text not null default '' check(length(customer_name)<=160),
  customer_phone text not null check(customer_phone ~ '^\+9665[0-9]{8}$'),
  customer_address text not null default '' check(length(customer_address)<=400),
  customer_tax_number text not null default '' check(customer_tax_number='' or customer_tax_number ~ '^[0-9]{15}$'),
  delivery_city text not null default '' check(length(delivery_city)<=160),
  delivery_window text not null default '' check(length(delivery_window)<=240),
  policy_version text not null check(length(policy_version) between 1 and 80),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 50),
  subtotal numeric(18,2) not null check(subtotal>=0),
  vat_rate numeric(5,2) not null check(vat_rate between 0 and 100),
  vat_amount numeric(18,2) not null check(vat_amount>=0 and vat_amount=round((subtotal+delivery_fee)*vat_rate/100,2)),
  delivery_fee numeric(18,2) not null check(delivery_fee>=0),
  total numeric(18,2) not null check(total between 0 and 1000000000 and total=subtotal+delivery_fee+vat_amount),
  valid_until timestamptz,
  terms text not null default '' check(length(terms)<=3000),
  send_status text not null default 'draft' check(send_status in('draft','sending','submitted','failed','uncertain')),
  send_claim uuid,
  send_started_at timestamptz,
  send_attempts integer not null default 0 check(send_attempts>=0),
  sent_at timestamptz,
  provider_message_id text,
  send_error text,
  created_at timestamptz not null default now(),
  unique(created_by,idempotency_key),
  check((source_request_id is null)=(source_request_code is null)),
  check(send_status<>'submitted' or (sent_at is not null and provider_message_id is not null))
);
create index price_quotations_created_idx on public.price_quotations(created_at desc,id);
create index price_quotations_source_idx on public.price_quotations(source_request_id) where source_request_id is not null;
create table public.price_quotation_events (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.price_quotations(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check(action in('created','sending','submitted','failed','uncertain')),
  created_at timestamptz not null default now()
);
create index price_quotation_events_quote_idx on public.price_quotation_events(quotation_id,created_at);
create index price_quotation_events_actor_idx on public.price_quotation_events(actor_id);
alter table public.price_quotations enable row level security;
alter table public.price_quotation_events enable row level security;
revoke all on public.price_quotations,public.price_quotation_events from public,anon,authenticated;
grant select,insert,update on public.price_quotations to service_role;
grant select,insert on public.price_quotation_events to service_role;
comment on table public.price_quotations is 'Service-only immutable quotation snapshots. No anonymous or authenticated Data API access. Server requires active sourcing administrator and excludes frozen archive actors.';

create function public.price_quotation_create(p_actor uuid,p_key uuid,p_fingerprint text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.price_quotations; item jsonb; amount numeric:=0; v_source uuid; v_source_code text;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid quotation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':price-quotation:'||p_key::text,0));
  select * into r from public.price_quotations where created_by=p_actor and idempotency_key=p_key;
  if found then
    if r.request_fingerprint<>p_fingerprint then raise exception 'Idempotency conflict' using errcode='23505'; end if;
    return r.id;
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 50 then raise exception 'Invalid items';end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(length(item->>'product_id'),0)=0 or coalesce(length(item->>'product_name'),0)=0
      or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number'
      or jsonb_typeof(item->'line_total') is distinct from 'number' or jsonb_typeof(item->'attributes') is distinct from 'array'
      or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>1000000 or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,3)
      or (item->>'unit_price')::numeric<0 or (item->>'unit_price')::numeric>10000000 or (item->>'unit_price')::numeric<>round((item->>'unit_price')::numeric,2)
      or (item->>'line_total')::numeric<>round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2)
      or coalesce(length(item->>'unit'),0)=0 or coalesce(length(item->>'notes'),0)>600 then raise exception 'Invalid quotation line';end if;
    amount:=amount+(item->>'line_total')::numeric;
  end loop;
  if (p_payload->>'subtotal')::numeric is distinct from amount then raise exception 'Subtotal mismatch';end if;
  v_source:=nullif(p_payload->>'source_request_id','')::uuid;
  if v_source is not null then
    select request_code into v_source_code from public.managed_quote_requests where id=v_source;
    if not found then raise exception 'Source request not found';end if;
  end if;
  insert into public.price_quotations(quotation_code,source_request_id,source_request_code,created_by,idempotency_key,request_fingerprint,
    customer_name,customer_phone,customer_address,customer_tax_number,delivery_city,delivery_window,policy_version,items,subtotal,vat_rate,vat_amount,delivery_fee,total,valid_until,terms)
  values('QUO-'||to_char(now() at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_source,v_source_code,p_actor,p_key,p_fingerprint,
    coalesce(p_payload->>'customer_name',''),p_payload->>'customer_phone',coalesce(p_payload->>'customer_address',''),coalesce(p_payload->>'customer_tax_number',''),
    coalesce(p_payload->>'delivery_city',''),coalesce(p_payload->>'delivery_window',''),p_payload->>'policy_version',p_payload->'items',amount,
    (p_payload->>'vat_rate')::numeric,(p_payload->>'vat_amount')::numeric,(p_payload->>'delivery_fee')::numeric,(p_payload->>'total')::numeric,
    nullif(p_payload->>'valid_until','')::timestamptz,coalesce(p_payload->>'terms','')) returning * into r;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(r.id,p_actor,'created');
  return r.id;
end $$;

create function public.price_quotation_claim_send(p_actor uuid,p_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.price_quotations;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  if p_claim is null then raise exception 'Missing claim';end if;
  select * into r from public.price_quotations where id=p_id for update;
  if not found or r.send_status not in('draft','failed') or (r.valid_until is not null and r.valid_until<now()) then return false;end if;
  update public.price_quotations set send_status='sending',send_claim=p_claim,send_started_at=now(),send_attempts=send_attempts+1,send_error=null where id=p_id;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(p_id,p_actor,'sending');
  return true;
end $$;

create function public.price_quotation_finish_send(p_actor uuid,p_id uuid,p_claim uuid,p_status text,p_provider_id text,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  if p_status not in('submitted','failed','uncertain') or p_status is null or length(coalesce(p_error,''))>120 or length(coalesce(p_provider_id,''))>200 or (p_status='submitted' and nullif(p_provider_id,'') is null) then raise exception 'Invalid result';end if;
  update public.price_quotations set send_status=p_status,provider_message_id=p_provider_id,send_error=p_error,sent_at=case when p_status='submitted' then now() else null end
  where id=p_id and send_status='sending' and send_claim=p_claim;
  if not found then return false;end if;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(p_id,p_actor,p_status);
  return true;
end $$;

revoke all on function public.price_quotation_create(uuid,uuid,text,jsonb),public.price_quotation_claim_send(uuid,uuid,uuid),public.price_quotation_finish_send(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.price_quotation_create(uuid,uuid,text,jsonb),public.price_quotation_claim_send(uuid,uuid,uuid),public.price_quotation_finish_send(uuid,uuid,uuid,text,text,text) to service_role;

notify pgrst,'reload schema';
commit;
