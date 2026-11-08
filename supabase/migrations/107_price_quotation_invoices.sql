begin;
-- Issuance is deliberately disabled until the company's applicable phase and
-- seller data are verified. Phase 2 requires a separate onboarded integration.
create table public.price_invoice_settings (
  singleton boolean primary key default true check(singleton),
  phase text not null default 'unconfigured' check(phase in('unconfigured','phase1','phase2')),
  verified_at timestamptz,
  configured_by uuid references public.profiles(id) on delete restrict,
  seller jsonb not null check(jsonb_typeof(seller)='object'),
  check(phase<>'phase1' or (verified_at is not null and configured_by is not null))
);
insert into public.price_invoice_settings(singleton,seller) values(true,
  '{"name":"شركة العنوان الحصري","vat_number":"312872746700003","commercial_registration":"5850157983","address":"AKAA8043، 8043 حي الخالدية، خميس مشيط 62411، الرقم الإضافي 3076، المملكة العربية السعودية"}');
alter table public.price_invoice_settings enable row level security;
revoke all on public.price_invoice_settings from public,anon,authenticated,service_role;
grant select on public.price_invoice_settings to service_role;

create sequence private.price_invoice_number_seq;
revoke all on sequence private.price_invoice_number_seq from public,anon,authenticated,service_role;
grant usage on sequence private.price_invoice_number_seq to service_role;

create table public.price_invoices (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null unique references public.price_quotations(id) on delete restrict,
  quotation_code text not null,
  invoice_number text not null unique,
  invoice_type text not null check(invoice_type in('standard','simplified')),
  issued_at timestamptz not null,
  supply_date date not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  phase text not null check(phase='phase1'),
  currency text not null default 'SAR' check(currency='SAR'),
  seller jsonb not null check(jsonb_typeof(seller)='object'),
  buyer jsonb not null check(jsonb_typeof(buyer)='object'),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 50),
  subtotal numeric(18,2) not null check(subtotal>=0),
  delivery_fee numeric(18,2) not null check(delivery_fee>=0),
  vat_rate numeric(5,2) not null check(vat_rate=15),
  vat_amount numeric(18,2) not null check(vat_amount=round((subtotal+delivery_fee)*vat_rate/100,2)),
  total numeric(18,2) not null check(total between 0 and 1000000000 and total=subtotal+delivery_fee+vat_amount)
);
create index price_invoices_issued_idx on public.price_invoices(issued_at desc,id);
create index price_invoices_created_by_idx on public.price_invoices(created_by);
alter table public.price_invoices enable row level security;
revoke all on public.price_invoices from public,anon,authenticated,service_role;
grant select,insert on public.price_invoices to service_role;

-- Defense in depth: an issued financial document is never edited or deleted.
-- Corrections need separately designed credit/debit notes, not invoice updates.
create function private.keep_price_invoice_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Issued invoices are immutable' using errcode='42501';
end $$;
revoke all on function private.keep_price_invoice_immutable() from public,anon,authenticated,service_role;
create trigger keep_price_invoice_immutable before update or delete on public.price_invoices
for each row execute function private.keep_price_invoice_immutable();

create function public.price_quotation_issue_invoice(p_actor uuid,p_quotation uuid,p_fingerprint text,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  config public.price_invoice_settings; quote public.price_quotations; existing public.price_invoices;
  v_type text; buyer_data jsonb; issued timestamptz:=statement_timestamp(); v_supply date;
  seq bigint; code text; amount numeric:=0; item jsonb; presented jsonb; result uuid; idx integer:=0;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor)
    or not exists(select 1 from public.admin_users a join public.admin_roles r on r.id=a.role_id
      where a.profile_id=p_actor and a.is_active and (r.role_key='super_admin' or exists(
        select 1 from public.admin_role_permissions rp join public.admin_permissions p on p.id=rp.permission_id
        where rp.role_id=r.id and p.permission_key='finance.manage'))) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_quotation is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid invoice input';end if;
  perform pg_advisory_xact_lock(hashtextextended('price-invoice:'||p_quotation::text,0));
  select * into existing from public.price_invoices where quotation_id=p_quotation;
  if found then
    if existing.request_fingerprint<>p_fingerprint then raise exception 'Invoice already exists with different data' using errcode='23505';end if;
    return existing.id;
  end if;
  select * into config from public.price_invoice_settings where singleton;
  if not found or config.phase<>'phase1' or config.verified_at is null or config.configured_by is null then
    raise exception 'Verified Phase 1 configuration required';
  end if;
  if coalesce(length(btrim(config.seller->>'name')),0) not between 1 and 160
    or octet_length(config.seller->>'name')>255
    or coalesce(length(btrim(config.seller->>'address')),0) not between 1 and 400
    or coalesce(config.seller->>'vat_number','') !~ '^3[0-9]{13}3$'
    or coalesce(config.seller->>'commercial_registration','') !~ '^[0-9]{10}$' then raise exception 'Invalid verified seller';end if;
  select * into quote from public.price_quotations where id=p_quotation;
  if not found then raise exception 'Quotation not found';end if;
  if quote.vat_rate<>15 then raise exception 'Only domestic standard-rate VAT is supported';end if;
  -- Recheck money from the canonical quote; caller cannot supply amounts/items.
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items')<>jsonb_array_length(quote.items) then raise exception 'Invalid invoice items';end if;
  for item in select value from jsonb_array_elements(quote.items) loop
    if (item->>'line_total')::numeric is distinct from round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2) then raise exception 'Invalid quotation line';end if;
    presented:=p_input->'items'->idx;
    if (presented - array['product_name','sku','attributes','category']) is distinct from (item - array['product_name','sku','attributes','category'])
      or jsonb_typeof(presented->'attributes') is distinct from 'array' or coalesce(length(presented->>'product_name'),0)=0 then raise exception 'Invoice item financial fields cannot change';end if;
    amount:=amount+(item->>'line_total')::numeric;
    idx:=idx+1;
  end loop;
  if amount<>quote.subtotal or quote.vat_amount<>round((amount+quote.delivery_fee)*15/100,2)
    or quote.total<>amount+quote.delivery_fee+quote.vat_amount then raise exception 'Invalid quotation totals';end if;
  v_type:=p_input->>'invoice_type';buyer_data:=p_input->'buyer';
  if v_type is null or v_type not in('standard','simplified') or jsonb_typeof(buyer_data) is distinct from 'object'
    or coalesce(length(buyer_data->>'name'),0)>160 or coalesce(length(buyer_data->>'address'),0)>400
    or coalesce(length(buyer_data->>'phone'),0)>30
    or (coalesce(buyer_data->>'phone','')<>'' and buyer_data->>'phone' !~ '^\+9665[0-9]{8}$')
    or (coalesce(buyer_data->>'vat_number','')<>'' and buyer_data->>'vat_number' !~ '^3[0-9]{13}3$') then raise exception 'Invalid buyer';end if;
  if v_type='standard' and (coalesce(length(btrim(buyer_data->>'name')),0)=0
    or coalesce(length(btrim(buyer_data->>'address')),0)=0 or coalesce(buyer_data->>'vat_number','') !~ '^3[0-9]{13}3$') then raise exception 'Standard invoice requires registered buyer data';end if;
  if v_type='simplified' and coalesce(buyer_data->>'vat_number','')<>'' then raise exception 'Registered buyer requires standard invoice';end if;
  if coalesce(p_input->>'supply_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Supply date required';end if;
  v_supply:=(p_input->>'supply_date')::date;
  seq:=nextval('private.price_invoice_number_seq');
  code:='INV-'||to_char(issued at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0');
  insert into public.price_invoices(quotation_id,quotation_code,invoice_number,invoice_type,issued_at,supply_date,created_by,request_fingerprint,phase,seller,buyer,items,subtotal,delivery_fee,vat_rate,vat_amount,total)
  values(quote.id,quote.quotation_code,code,v_type,issued,v_supply,p_actor,p_fingerprint,'phase1',config.seller,
    jsonb_build_object('name',coalesce(buyer_data->>'name',''),'address',coalesce(buyer_data->>'address',''),'phone',coalesce(buyer_data->>'phone',''),'vat_number',coalesce(buyer_data->>'vat_number','')),
    p_input->'items',quote.subtotal,quote.delivery_fee,quote.vat_rate,quote.vat_amount,quote.total) returning id into result;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
    values(p_actor,'price_invoices',result::text,'price_invoice_issued',jsonb_build_object('quotation_id',quote.id,'invoice_number',code,'invoice_type',v_type,'total',quote.total,'phase','phase1'));
  return result;
end $$;
revoke all on function public.price_quotation_issue_invoice(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.price_quotation_issue_invoice(uuid,uuid,text,jsonb) to service_role;
comment on table public.price_invoices is 'Immutable Phase 1 invoice snapshots, service-only access with sourcing and finance permissions. No Phase 2 integration or compliance claim.';
notify pgrst,'reload schema';
commit;
