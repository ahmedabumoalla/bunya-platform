begin;
set local lock_timeout='5s';
-- A sales address book, not Auth identities or customer login accounts.
create sequence private.sales_customer_number_seq;
revoke all on sequence private.sales_customer_number_seq from public,anon,authenticated,service_role;
grant usage on sequence private.sales_customer_number_seq to service_role;
create table public.sales_customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique check(customer_number ~ '^CUS-[0-9]{6,}$'),
  phone text not null unique check(phone ~ '^\+9665[0-9]{8}$'),
  name text not null default '' check(length(name)<=160),
  address text not null default '' check(length(address)<=400),
  tax_number text not null default '' check(tax_number='' or tax_number ~ '^[0-9]{15}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,customer_number)
);
create index sales_customers_updated_idx on public.sales_customers(updated_at desc,id);
alter table public.sales_customers enable row level security;
revoke all on public.sales_customers from public,anon,authenticated,service_role;
grant select,insert on public.sales_customers to service_role;
grant update(name,address,tax_number,updated_by,updated_at) on public.sales_customers to service_role;
comment on table public.sales_customers is 'Private sales contacts with stable phone-keyed customer numbers. No Auth account, verified identity, platform role or outbound notification is created. Server requires sourcing authorization.';

create function public.sales_customer_save(p_actor uuid,p_input jsonb,p_customer uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.sales_customers; v_phone text; v_name text; v_address text; v_tax text; seq bigint; changed boolean:=false;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid customer';end if;
  if jsonb_typeof(p_input->'phone') is distinct from 'string'
    or (p_input ? 'name' and jsonb_typeof(p_input->'name') is distinct from 'string')
    or (p_input ? 'address' and jsonb_typeof(p_input->'address') is distinct from 'string')
    or (p_input ? 'tax_number' and jsonb_typeof(p_input->'tax_number') is distinct from 'string') then raise exception 'Invalid customer fields';end if;
  v_phone:=regexp_replace(p_input->>'phone','[[:space:]()+-]','','g');
  if v_phone like '05%' then v_phone:='966'||substr(v_phone,2);elsif v_phone like '5%' then v_phone:='966'||v_phone;end if;
  if v_phone !~ '^9665[0-9]{8}$' then raise exception 'Invalid customer phone';end if;
  v_phone:='+'||v_phone;
  v_name:=btrim(coalesce(p_input->>'name',''));v_address:=btrim(coalesce(p_input->>'address',''));v_tax:=btrim(coalesce(p_input->>'tax_number',''));
  if length(v_name)>160 or length(v_address)>400 or (v_tax<>'' and v_tax !~ '^[0-9]{15}$')
    or translate(v_name,chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]'
    or translate(v_address,chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]' then raise exception 'Invalid customer details' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-customer:'||v_phone,0));
  if p_customer is not null and not exists(select 1 from public.sales_customers where id=p_customer and phone=v_phone) then raise exception 'Selected customer does not match phone' using errcode='22023';end if;
  select * into r from public.sales_customers where phone=v_phone for update;
  if not found then
    seq:=nextval('private.sales_customer_number_seq');
    insert into public.sales_customers(customer_number,phone,name,address,tax_number,created_by,updated_by)
      values('CUS-'||lpad(seq::text,greatest(6,length(seq::text)),'0'),v_phone,v_name,v_address,v_tax,p_actor,p_actor) returning * into r;
    changed:=true;
  elsif (v_name<>'' and v_name<>r.name) or (v_address<>'' and v_address<>r.address) or (v_tax<>'' and v_tax<>r.tax_number) then
    -- Blank optional fields never erase known details during automatic saving.
    update public.sales_customers set name=coalesce(nullif(v_name,''),name),address=coalesce(nullif(v_address,''),address),tax_number=coalesce(nullif(v_tax,''),tax_number),updated_by=p_actor,updated_at=now()
      where id=r.id returning * into r;
    changed:=true;
  end if;
  if changed then
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
      values(p_actor,'sales_customers',r.id::text,'sales_customer_saved',jsonb_build_object('customer_number',r.customer_number));
  end if;
  return r.id;
end $$;
revoke all on function public.sales_customer_save(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sales_customer_save(uuid,jsonb,uuid) to service_role;

create function public.sales_customer_search(p_actor uuid,p_query text default '',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text:=btrim(coalesce(p_query,'')); phone_term text; result jsonb;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') or private.admin_archive_frozen(p_actor) then raise exception 'Not authorized' using errcode='42501';end if;
  if length(term)>100 or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid customer search';end if;
  phone_term:=regexp_replace(term,'[[:space:]()+-]','','g');
  if phone_term like '05%' then phone_term:='966'||substr(phone_term,2);end if;
  with matched as (
    select id,customer_number,phone,name,address,tax_number,updated_at from public.sales_customers
    where term='' or position(lower(term) in lower(name))>0 or position(lower(term) in lower(customer_number))>0
      or (phone_term<>'' and position(phone_term in phone)>0) or (term<>'' and position(term in tax_number)>0)
  ), page as (select * from matched order by updated_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id) from page),'[]'::jsonb),'count',(select count(*) from matched)) into result;
  return result;
end $$;
revoke all on function public.sales_customer_search(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.sales_customer_search(uuid,text,integer,integer) to service_role;

alter table public.price_quotations add column customer_id uuid,add column customer_number text,
  add constraint price_quotations_customer_pair_check check((customer_id is null)=(customer_number is null)),
  add constraint price_quotations_customer_fkey foreign key(customer_id,customer_number) references public.sales_customers(id,customer_number) on delete restrict;
alter table public.price_invoices add column customer_id uuid,add column customer_number text,
  add constraint price_invoices_customer_pair_check check((customer_id is null)=(customer_number is null)),
  add constraint price_invoices_customer_fkey foreign key(customer_id,customer_number) references public.sales_customers(id,customer_number) on delete restrict;
create index price_quotations_customer_idx on public.price_quotations(customer_id);
create index price_invoices_customer_idx on public.price_invoices(customer_id);

-- Backfill contact details only; no Auth identity or issued invoice is changed.
-- Earliest transaction orders number assignment. Latest nonblank details win.
do $$
declare contact record; seq bigint;
begin
  for contact in
    with sources as (
      select id,customer_phone phone,customer_name name,customer_address address,customer_tax_number tax_number,created_by,created_at from public.price_quotations
      union all
      select id,buyer->>'phone',coalesce(buyer->>'name',''),coalesce(buyer->>'address',''),coalesce(buyer->>'vat_number',''),created_by,issued_at from public.price_invoices where buyer->>'phone' ~ '^\+9665[0-9]{8}$'
    ) select phone,
      coalesce((array_agg(name order by created_at desc,id desc) filter(where btrim(name)<>''))[1],'') name,
      coalesce((array_agg(address order by created_at desc,id desc) filter(where btrim(address)<>''))[1],'') address,
      coalesce((array_agg(tax_number order by created_at desc,id desc) filter(where btrim(tax_number)<>''))[1],'') tax_number,
      (array_agg(created_by order by created_at,id))[1] creator,(array_agg(created_by order by created_at desc,id desc))[1] updater,min(created_at) first_at,max(created_at) last_at
      from sources where phone ~ '^\+9665[0-9]{8}$' group by phone order by min(created_at),phone
  loop
    seq:=nextval('private.sales_customer_number_seq');
    insert into public.sales_customers(customer_number,phone,name,address,tax_number,created_by,updated_by,created_at,updated_at)
      values('CUS-'||lpad(seq::text,greatest(6,length(seq::text)),'0'),contact.phone,contact.name,contact.address,contact.tax_number,contact.creator,contact.updater,contact.first_at,contact.last_at);
  end loop;
end $$;
update public.price_quotations q set customer_id=c.id,customer_number=c.customer_number from public.sales_customers c where c.phone=q.customer_phone;

create or replace function public.price_quotation_create(p_actor uuid,p_key uuid,p_fingerprint text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.price_quotations; item jsonb; amount numeric:=0; v_source uuid; v_source_code text; v_basis text; v_vat numeric; v_delivery numeric; v_rate numeric; v_total numeric; customer public.sales_customers; customer_key uuid;
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
  insert into public.price_quotations(quotation_code,source_request_id,source_request_code,created_by,idempotency_key,request_fingerprint,
    customer_name,customer_phone,customer_address,customer_tax_number,delivery_city,delivery_window,policy_version,items,subtotal,vat_rate,vat_amount,delivery_fee,total,valid_until,terms,pricing_basis,customer_id,customer_number)
  values('QUO-'||to_char(now() at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_source,v_source_code,p_actor,p_key,p_fingerprint,
    coalesce(p_payload->>'customer_name',''),p_payload->>'customer_phone',coalesce(p_payload->>'customer_address',''),coalesce(p_payload->>'customer_tax_number',''),
    coalesce(p_payload->>'delivery_city',''),coalesce(p_payload->>'delivery_window',''),p_payload->>'policy_version',p_payload->'items',amount,
    (p_payload->>'vat_rate')::numeric,(p_payload->>'vat_amount')::numeric,(p_payload->>'delivery_fee')::numeric,(p_payload->>'total')::numeric,
    nullif(p_payload->>'valid_until','')::timestamptz,coalesce(p_payload->>'terms',''),v_basis,customer.id,customer.customer_number) returning * into r;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(r.id,p_actor,'created');
  return r.id;
end $$;

create or replace function public.price_quotation_issue_invoice(p_actor uuid,p_quotation uuid,p_fingerprint text,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  config public.price_invoice_settings; quote public.price_quotations; existing public.price_invoices;
  v_type text; buyer_data jsonb; issued timestamptz:=statement_timestamp(); v_supply date;
  seq bigint; code text; amount numeric:=0; item jsonb; presented jsonb; result uuid; idx integer:=0; customer public.sales_customers; customer_key uuid;
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
    jsonb_build_object('name',coalesce(buyer_data->>'name',''),'address',coalesce(buyer_data->>'address',''),'phone',coalesce(buyer_data->>'phone',''),'vat_number',coalesce(buyer_data->>'vat_number','')),
    p_input->'items',quote.subtotal,quote.delivery_fee,quote.vat_rate,quote.vat_amount,quote.total,quote.pricing_basis,customer.id,customer.customer_number) returning id into result;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
    values(p_actor,'price_invoices',result::text,'price_invoice_issued',jsonb_build_object('quotation_id',quote.id,'invoice_number',code,'invoice_type',v_type,'total',quote.total,'phase','phase1'));
  return result;
end $$;
revoke all on function public.price_quotation_issue_invoice(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.price_quotation_issue_invoice(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.price_quotation_create(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.price_quotation_create(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
