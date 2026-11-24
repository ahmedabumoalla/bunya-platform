begin;
set local lock_timeout='5s';
-- Forward-only. Originals and earlier revisions remain immutable; no sending is
-- triggered by creating, editing, saving a draft or issuing a correction.
alter table public.price_quotations
  add column revision integer not null default 1 check(revision>0),
  add column customer_national_address jsonb not null default '{}' check(jsonb_typeof(customer_national_address)='object'),
  add column correction_of_invoice_id uuid references public.price_invoices(id) on delete restrict,
  add column correction_reason text not null default '' check(length(correction_reason)<=600),
  add constraint price_quotation_correction_reason_check check(correction_of_invoice_id is null or length(btrim(correction_reason))>0);
create index price_quotation_correction_idx on public.price_quotations(correction_of_invoice_id) where correction_of_invoice_id is not null;
alter table public.sales_customers add column national_address jsonb not null default '{}' check(jsonb_typeof(national_address)='object');
grant update(national_address) on public.sales_customers to service_role;
create table public.price_quotation_revisions (
  quotation_id uuid not null references public.price_quotations(id) on delete restrict,
  revision integer not null, snapshot jsonb not null, changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(), primary key(quotation_id,revision)
);
create table public.price_invoice_drafts (
  quotation_id uuid primary key references public.price_quotations(id) on delete restrict,
  input jsonb not null check(jsonb_typeof(input)='object'), revision integer not null default 1,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table public.price_invoice_corrections (
  id uuid primary key default gen_random_uuid(),
  original_invoice_id uuid not null unique references public.price_invoices(id) on delete restrict,
  replacement_invoice_id uuid not null unique references public.price_invoices(id) on delete restrict,
  credit_note_number text not null unique, issued_at timestamptz not null,
  reason text not null check(length(btrim(reason)) between 1 and 600),
  created_by uuid not null references public.profiles(id),
  check(original_invoice_id<>replacement_invoice_id)
);
create table public.price_invoice_deliveries (
  invoice_id uuid primary key references public.price_invoices(id) on delete restrict,
  status text not null check(status in('sending','submitted','failed','uncertain')),
  claim uuid not null, started_at timestamptz not null default now(), sent_at timestamptz,
  actor_id uuid not null references public.profiles(id), provider_message_id text, error text
);
create index price_quotation_revisions_actor_idx on public.price_quotation_revisions(changed_by);
create index price_invoice_drafts_actor_idx on public.price_invoice_drafts(updated_by);
create index price_invoice_corrections_actor_idx on public.price_invoice_corrections(created_by);
create index price_invoice_deliveries_actor_idx on public.price_invoice_deliveries(actor_id);
alter table public.price_quotation_revisions enable row level security;
alter table public.price_invoice_drafts enable row level security;
alter table public.price_invoice_corrections enable row level security;
alter table public.price_invoice_deliveries enable row level security;
revoke all on public.price_quotation_revisions,public.price_invoice_drafts,public.price_invoice_corrections,public.price_invoice_deliveries from public,anon,authenticated,service_role;
grant select,insert on public.price_quotation_revisions,public.price_invoice_corrections to service_role;
grant select,insert,update on public.price_invoice_drafts,public.price_invoice_deliveries to service_role;
create trigger keep_price_quotation_revision_immutable before update or delete on public.price_quotation_revisions for each row execute function private.keep_price_invoice_immutable();
create trigger keep_price_invoice_correction_immutable before update or delete on public.price_invoice_corrections for each row execute function private.keep_price_invoice_immutable();

create function private.sales_edit_actor_allowed(p_actor uuid,p_finance boolean default false)
returns boolean language sql stable security invoker set search_path='' as $$
  select not private.sales_documents_restricted(p_actor)
    and public.managed_quote_actor_allowed(p_actor,'admin') and not private.admin_archive_frozen(p_actor)
    and (not p_finance or exists(select 1 from public.admin_users a join public.admin_roles r on r.id=a.role_id
      where a.profile_id=p_actor and a.is_active and (r.role_key='super_admin' or exists(
        select 1 from public.admin_role_permissions rp join public.admin_permissions p on p.id=rp.permission_id
        where rp.role_id=r.id and p.permission_key='finance.manage'))));
$$;
revoke all on function private.sales_edit_actor_allowed(uuid,boolean) from public,anon,authenticated;
grant execute on function private.sales_edit_actor_allowed(uuid,boolean) to service_role;

create function private.validate_sales_national_address(p_address jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare pair record;
begin
  if jsonb_typeof(p_address) is distinct from 'object' then raise exception 'Invalid national address';end if;
  for pair in select * from jsonb_each(p_address) loop
    if pair.key not in('building_number','street','district','city','postal_code','additional_number','unit_number','short_address','country')
      or jsonb_typeof(pair.value)<>'string' or length(pair.value #>> '{}')>80 or (pair.value #>> '{}') ~ '[[:cntrl:]]' then raise exception 'Invalid national address field';end if;
  end loop;
  if coalesce(p_address->>'building_number','')<>'' and p_address->>'building_number' !~ '^[0-9]{4}$'
    or coalesce(p_address->>'additional_number','')<>'' and p_address->>'additional_number' !~ '^[0-9]{4}$'
    or coalesce(p_address->>'postal_code','')<>'' and p_address->>'postal_code' !~ '^[0-9]{5}$'
    or coalesce(p_address->>'short_address','')<>'' and p_address->>'short_address' !~ '^[A-Z]{4}[0-9]{4}$' then raise exception 'Invalid national address numbers';end if;
end $$;
revoke all on function private.validate_sales_national_address(jsonb) from public,anon,authenticated;
grant execute on function private.validate_sales_national_address(jsonb) to service_role;

create or replace function public.price_quotation_save(p_actor uuid,p_key uuid,p_fingerprint text,p_payload jsonb,p_id uuid default null,p_revision integer default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.price_quotations; item jsonb; amount numeric:=0; v_source uuid; v_source_code text; v_basis text; v_vat numeric; v_delivery numeric; v_rate numeric; v_total numeric; customer public.sales_customers; customer_key uuid;
begin
  if private.sales_documents_restricted(p_actor) or not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid quotation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':price-quotation:'||p_key::text,0));
  if p_id is null then
  select * into r from public.price_quotations where created_by=p_actor and idempotency_key=p_key;
  if found then
    if r.request_fingerprint<>p_fingerprint then raise exception 'Idempotency conflict' using errcode='23505'; end if;
    return r.id;
  end if;
  else
    select * into r from public.price_quotations where id=p_id for update;
    if not found then raise exception 'Quotation not found';end if;
    if r.request_fingerprint=p_fingerprint and r.revision=p_revision+1 then return r.id;end if;
    if r.revision is distinct from p_revision or r.send_status in('sending','uncertain') then raise exception 'Quotation changed or send pending' using errcode='40001';end if;
    if r.correction_of_invoice_id is distinct from nullif(p_payload->>'correction_of_invoice_id','')::uuid then raise exception 'Cannot change correction reference';end if;
  end if;
  perform private.validate_sales_national_address(coalesce(p_payload->'customer_national_address','{}'));
  if nullif(p_payload->>'correction_of_invoice_id','') is not null then
    if not private.sales_edit_actor_allowed(p_actor,true) then raise exception 'Not authorized' using errcode='42501';end if;
    if not exists(select 1 from public.price_invoices where id=(p_payload->>'correction_of_invoice_id')::uuid)
      or exists(select 1 from public.price_invoice_corrections where original_invoice_id=(p_payload->>'correction_of_invoice_id')::uuid) then raise exception 'Original invoice absent or already corrected';end if;
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
  v_basis:=coalesce(p_payload->>'pricing_basis','exclusive');
  if v_basis not in('exclusive','inclusive') then raise exception 'Invalid pricing basis';end if;
  v_delivery:=(p_payload->>'delivery_fee')::numeric;v_rate:=(p_payload->>'vat_rate')::numeric;
  if v_delivery is null or v_delivery<0 or v_delivery>10000000 or v_delivery<>round(v_delivery,2)
    or v_rate is null or v_rate<0 or v_rate>100 or v_rate<>round(v_rate,2) then raise exception 'Invalid quotation tax or delivery';end if;
  v_vat:=round((amount+v_delivery)*v_rate/(case when v_basis='inclusive' then 100+v_rate else 100 end),2);
  v_total:=amount+v_delivery+case when v_basis='exclusive' then v_vat else 0 end;
  if (p_payload->>'vat_amount')::numeric is distinct from v_vat or (p_payload->>'total')::numeric is distinct from v_total then raise exception 'Invalid quotation totals';end if;
  v_source:=nullif(p_payload->>'source_request_id','')::uuid;
  if v_source is not null then
    select request_code into v_source_code from public.managed_quote_requests where id=v_source;
    if not found then raise exception 'Source request not found';end if;
  end if;
  customer_key:=public.sales_customer_save(p_actor,jsonb_build_object('phone',p_payload->>'customer_phone','name',coalesce(p_payload->>'customer_name',''),'address',coalesce(p_payload->>'customer_address',''),'tax_number',coalesce(p_payload->>'customer_tax_number','')),nullif(p_payload->>'customer_id','')::uuid);
  select * into customer from public.sales_customers where id=customer_key;
  if p_id is not null then
    insert into public.price_quotation_revisions(quotation_id,revision,snapshot,changed_by) values(r.id,r.revision,to_jsonb(r),p_actor);
    update public.price_quotations set customer_id=customer.id,customer_number=customer.customer_number,
      customer_name=coalesce(p_payload->>'customer_name',''),customer_phone=p_payload->>'customer_phone',
      customer_address=coalesce(p_payload->>'customer_address',''),customer_tax_number=coalesce(p_payload->>'customer_tax_number',''),
      customer_national_address=coalesce(p_payload->'customer_national_address','{}'),
      source_request_id=v_source,source_request_code=v_source_code,
      delivery_city=coalesce(p_payload->>'delivery_city',''),delivery_window=coalesce(p_payload->>'delivery_window',''),
      policy_version=p_payload->>'policy_version',items=p_payload->'items',subtotal=amount,vat_rate=v_rate,vat_amount=v_vat,
      delivery_fee=v_delivery,total=v_total,pricing_basis=v_basis,valid_until=nullif(p_payload->>'valid_until','')::timestamptz,
      terms=coalesce(p_payload->>'terms',''),correction_reason=coalesce(p_payload->>'correction_reason',''),
      revision=revision+1,request_fingerprint=p_fingerprint,send_status='draft',sent_at=null,send_claim=null,send_started_at=null,provider_message_id=null,send_error=null
    where id=p_id returning * into r;
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
      values(p_actor,'price_quotations',r.id::text,'price_quotation_edited',jsonb_build_object('revision',r.revision));
  else
  insert into public.price_quotations(quotation_code,source_request_id,source_request_code,created_by,idempotency_key,request_fingerprint,
    customer_name,customer_phone,customer_address,customer_tax_number,delivery_city,delivery_window,policy_version,items,subtotal,vat_rate,vat_amount,delivery_fee,total,valid_until,terms,pricing_basis,customer_id,customer_number)
  values('QUO-'||to_char(now() at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_source,v_source_code,p_actor,p_key,p_fingerprint,
    coalesce(p_payload->>'customer_name',''),p_payload->>'customer_phone',coalesce(p_payload->>'customer_address',''),coalesce(p_payload->>'customer_tax_number',''),
    coalesce(p_payload->>'delivery_city',''),coalesce(p_payload->>'delivery_window',''),p_payload->>'policy_version',p_payload->'items',amount,
    (p_payload->>'vat_rate')::numeric,(p_payload->>'vat_amount')::numeric,(p_payload->>'delivery_fee')::numeric,(p_payload->>'total')::numeric,
    nullif(p_payload->>'valid_until','')::timestamptz,coalesce(p_payload->>'terms',''),v_basis,customer.id,customer.customer_number) returning * into r;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(r.id,p_actor,'created');
  end if;
  update public.price_quotations set customer_national_address=coalesce(p_payload->'customer_national_address','{}'),
    correction_of_invoice_id=nullif(p_payload->>'correction_of_invoice_id','')::uuid,correction_reason=coalesce(p_payload->>'correction_reason','') where id=r.id;
  if coalesce(p_payload->'customer_national_address','{}')<>'{}'::jsonb then
    update public.sales_customers set national_address=p_payload->'customer_national_address' where id=customer.id;
  end if;
  return r.id;
end $$;
revoke all on function public.price_quotation_save(uuid,uuid,text,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.price_quotation_save(uuid,uuid,text,jsonb,uuid,integer) to service_role;
create or replace function public.price_quotation_create(p_actor uuid,p_key uuid,p_fingerprint text,p_payload jsonb)
returns uuid language sql security invoker set search_path='' as $$
 select public.price_quotation_save(p_actor,p_key,p_fingerprint,p_payload,null,null);
$$;

create or replace function public.price_quotation_issue_invoice(p_actor uuid,p_quotation uuid,p_fingerprint text,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  config public.price_invoice_settings; quote public.price_quotations; existing public.price_invoices;
  v_type text; buyer_data jsonb; issued timestamptz:=statement_timestamp(); v_supply date;
  seq bigint; code text; amount numeric:=0; item jsonb; presented jsonb; result uuid; idx integer:=0; customer public.sales_customers; customer_key uuid; original public.price_invoices; note_code text;
begin
  if private.sales_documents_restricted(p_actor) or not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor)
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
  select * into quote from public.price_quotations where id=p_quotation for update;
  if not found then raise exception 'Quotation not found';end if;
  if p_input ? 'quotation_revision' and (p_input->>'quotation_revision')::integer is distinct from quote.revision then raise exception 'Quotation changed' using errcode='40001';end if;
  perform private.validate_sales_national_address(coalesce(p_input->'buyer'->'national_address','{}'));
  if quote.correction_of_invoice_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('invoice-correction:'||quote.correction_of_invoice_id::text,0));
    select * into original from public.price_invoices where id=quote.correction_of_invoice_id;
    if not found or exists(select 1 from public.price_invoice_corrections where original_invoice_id=original.id) then raise exception 'Invoice already corrected';end if;
    if original.seller->>'vat_number' is distinct from config.seller->>'vat_number' then raise exception 'Correction seller mismatch';end if;
  end if;
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
  if amount<>quote.subtotal or quote.vat_amount<>round((amount+quote.delivery_fee)*15/(case when quote.pricing_basis='inclusive' then 115 else 100 end),2)
    or quote.total<>amount+quote.delivery_fee+(case when quote.pricing_basis='exclusive' then quote.vat_amount else 0 end) then raise exception 'Invalid quotation totals';end if;
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
  if coalesce(buyer_data->>'phone','')<>'' then
    customer_key:=public.sales_customer_save(p_actor,jsonb_build_object('phone',buyer_data->>'phone','name',coalesce(buyer_data->>'name',''),'address',coalesce(buyer_data->>'address',''),'tax_number',coalesce(buyer_data->>'vat_number','')));
    select * into customer from public.sales_customers where id=customer_key;
  end if;
  seq:=nextval('private.price_invoice_number_seq');
  code:='INV-'||to_char(issued at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0');
  insert into public.price_invoices(quotation_id,quotation_code,invoice_number,invoice_type,issued_at,supply_date,created_by,request_fingerprint,phase,seller,buyer,items,subtotal,delivery_fee,vat_rate,vat_amount,total,pricing_basis,customer_id,customer_number)
  values(quote.id,quote.quotation_code,code,v_type,issued,v_supply,p_actor,p_fingerprint,'phase1',config.seller,
    jsonb_build_object('name',coalesce(buyer_data->>'name',''),'address',coalesce(buyer_data->>'address',''),'phone',coalesce(buyer_data->>'phone',''),'vat_number',coalesce(buyer_data->>'vat_number',''),'national_address',coalesce(buyer_data->'national_address','{}')),
    p_input->'items',quote.subtotal,quote.delivery_fee,quote.vat_rate,quote.vat_amount,quote.total,quote.pricing_basis,customer.id,customer.customer_number) returning id into result;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
    values(p_actor,'price_invoices',result::text,'price_invoice_issued',jsonb_build_object('quotation_id',quote.id,'invoice_number',code,'invoice_type',v_type,'total',quote.total,'phase','phase1'));
  if quote.correction_of_invoice_id is not null then
    seq:=nextval('private.price_invoice_number_seq');
    note_code:='CN-'||to_char(issued at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0');
    insert into public.price_invoice_corrections(original_invoice_id,replacement_invoice_id,credit_note_number,issued_at,reason,created_by)
      values(original.id,result,note_code,issued,quote.correction_reason,p_actor);
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
      values(p_actor,'price_invoices',original.id::text,'price_invoice_corrected',jsonb_build_object('replacement_invoice_id',result,'credit_note_number',note_code));
  end if;
  return result;
end $$;
create or replace function public.sales_customer_search(p_actor uuid,p_query text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text:=btrim(coalesce(p_query,'')); phone_term text; result jsonb;
begin
  if private.sales_documents_restricted(p_actor) or not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  if length(term)>100 or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid customer search';end if;
  phone_term:=regexp_replace(term,'[[:space:]()+-]','','g');
  if phone_term like '05%' then phone_term:='966'||substr(phone_term,2);end if;
  with matched as (
    select id,customer_number,phone,name,address,tax_number,national_address,updated_at from public.sales_customers
    where term='' or position(lower(term) in lower(name))>0 or position(lower(term) in lower(customer_number))>0
      or (phone_term<>'' and position(phone_term in phone)>0) or (term<>'' and position(term in tax_number)>0)
  ), page as (select * from matched order by updated_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id) from page),'[]'::jsonb),'count',(select count(*) from matched)) into result;
  return result;
end $$;

create function public.price_quotation_claim_revision_send(p_actor uuid,p_id uuid,p_claim uuid,p_revision integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare q public.price_quotations;
begin
  if not private.sales_edit_actor_allowed(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  select * into q from public.price_quotations where id=p_id for update;
  if not found or q.revision is distinct from p_revision then return false;end if;
  return public.price_quotation_claim_send(p_actor,p_id,p_claim);
end $$;
create function public.price_invoice_save_draft(p_actor uuid,p_quotation uuid,p_input jsonb,p_revision integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare current_revision integer;
begin
  if not private.sales_edit_actor_allowed(p_actor,true) then raise exception 'Not authorized' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('price-invoice:'||p_quotation::text,0));
  if exists(select 1 from public.price_invoices where quotation_id=p_quotation) then raise exception 'Invoice already issued';end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>12000 then raise exception 'Invalid draft';end if;
  perform private.validate_sales_national_address(coalesce(p_input->'buyer'->'national_address','{}'));
  select revision into current_revision from public.price_invoice_drafts where quotation_id=p_quotation;
  if coalesce(current_revision,0) is distinct from p_revision then raise exception 'Draft changed' using errcode='40001';end if;
  insert into public.price_invoice_drafts(quotation_id,input,updated_by) values(p_quotation,p_input,p_actor)
    on conflict(quotation_id) do update set input=excluded.input,revision=price_invoice_drafts.revision+1,updated_by=p_actor,updated_at=now()
    returning revision into current_revision;
  return current_revision;
end $$;
create function public.price_invoice_claim_send(p_actor uuid,p_invoice uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if not private.sales_edit_actor_allowed(p_actor,true) then raise exception 'Not authorized' using errcode='42501';end if;
  if not exists(select 1 from public.price_invoices where id=p_invoice and buyer->>'phone' ~ '^\+9665[0-9]{8}$') then raise exception 'Invoice recipient missing';end if;
  insert into public.price_invoice_deliveries(invoice_id,status,claim,actor_id) values(p_invoice,'sending',p_claim,p_actor)
    on conflict(invoice_id) do update set status='sending',claim=p_claim,started_at=now(),actor_id=p_actor,error=null
    where price_invoice_deliveries.status='failed';
  get diagnostics changed=row_count;
  return changed=1;
end $$;
create function public.price_invoice_finish_send(p_actor uuid,p_invoice uuid,p_claim uuid,p_status text,p_provider text,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if not private.sales_edit_actor_allowed(p_actor,true) then raise exception 'Not authorized' using errcode='42501';end if;
  if p_status is null or p_status not in('submitted','failed','uncertain') or (p_status='submitted' and coalesce(p_provider,'')='') then raise exception 'Invalid send result';end if;
  update public.price_invoice_deliveries set status=p_status,provider_message_id=p_provider,error=p_error,sent_at=case when p_status='submitted' then now() else null end
    where invoice_id=p_invoice and claim=p_claim and status='sending' and actor_id=p_actor;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.price_quotation_claim_revision_send(uuid,uuid,uuid,integer),public.price_invoice_save_draft(uuid,uuid,jsonb,integer),public.price_invoice_claim_send(uuid,uuid,uuid),public.price_invoice_finish_send(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.price_quotation_claim_revision_send(uuid,uuid,uuid,integer),public.price_invoice_save_draft(uuid,uuid,jsonb,integer),public.price_invoice_claim_send(uuid,uuid,uuid),public.price_invoice_finish_send(uuid,uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
