begin;
-- Forward-only expansion: historical quotes/invoices remain exclusive with their
-- original financial snapshots. New inclusive snapshots retain entered gross
-- prices and extract VAT once. Do not drop this marker after inclusive issuance;
-- rollback application traffic to exclusive inputs, preserving both row formats.
set local lock_timeout='5s';
alter table public.price_quotations add column pricing_basis text not null default 'exclusive' check(pricing_basis in('exclusive','inclusive'));
alter table public.price_invoices add column pricing_basis text not null default 'exclusive' check(pricing_basis in('exclusive','inclusive'));
alter table public.price_quotations
  drop constraint price_quotations_check,
  drop constraint price_quotations_check1,
  add constraint price_quotations_vat_by_basis_check check(vat_amount>=0 and vat_amount=round((subtotal+delivery_fee)*vat_rate/(case when pricing_basis='inclusive' then 100+vat_rate else 100 end),2)),
  add constraint price_quotations_total_by_basis_check check(total between 0 and 1000000000 and total=subtotal+delivery_fee+case when pricing_basis='exclusive' then vat_amount else 0 end);
comment on column public.price_quotations.pricing_basis is 'exclusive: item prices, line totals, subtotal and delivery exclude VAT; inclusive: these amounts include VAT, and vat_amount is the included component.';
alter table public.price_invoices
  drop constraint price_invoices_check,
  drop constraint price_invoices_check1,
  add constraint price_invoices_vat_by_basis_check check(vat_amount>=0 and vat_amount=round((subtotal+delivery_fee)*vat_rate/(case when pricing_basis='inclusive' then 100+vat_rate else 100 end),2)),
  add constraint price_invoices_total_by_basis_check check(total between 0 and 1000000000 and total=subtotal+delivery_fee+case when pricing_basis='exclusive' then vat_amount else 0 end);
comment on column public.price_invoices.pricing_basis is 'exclusive: item prices, line totals, subtotal and delivery exclude VAT; inclusive: these amounts include VAT, and vat_amount is the included component.';

create or replace function public.price_quotation_create(p_actor uuid,p_key uuid,p_fingerprint text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.price_quotations; item jsonb; amount numeric:=0; v_source uuid; v_source_code text; v_basis text; v_vat numeric; v_delivery numeric; v_rate numeric; v_total numeric;
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
  insert into public.price_quotations(quotation_code,source_request_id,source_request_code,created_by,idempotency_key,request_fingerprint,
    customer_name,customer_phone,customer_address,customer_tax_number,delivery_city,delivery_window,policy_version,items,subtotal,vat_rate,vat_amount,delivery_fee,total,valid_until,terms,pricing_basis)
  values('QUO-'||to_char(now() at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_source,v_source_code,p_actor,p_key,p_fingerprint,
    coalesce(p_payload->>'customer_name',''),p_payload->>'customer_phone',coalesce(p_payload->>'customer_address',''),coalesce(p_payload->>'customer_tax_number',''),
    coalesce(p_payload->>'delivery_city',''),coalesce(p_payload->>'delivery_window',''),p_payload->>'policy_version',p_payload->'items',amount,
    (p_payload->>'vat_rate')::numeric,(p_payload->>'vat_amount')::numeric,(p_payload->>'delivery_fee')::numeric,(p_payload->>'total')::numeric,
    nullif(p_payload->>'valid_until','')::timestamptz,coalesce(p_payload->>'terms',''),v_basis) returning * into r;
  insert into public.price_quotation_events(quotation_id,actor_id,action) values(r.id,p_actor,'created');
  return r.id;
end $$;

create or replace function public.price_quotation_issue_invoice(p_actor uuid,p_quotation uuid,p_fingerprint text,p_input jsonb)
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
  seq:=nextval('private.price_invoice_number_seq');
  code:='INV-'||to_char(issued at time zone 'Asia/Riyadh','YYYYMMDD')||'-'||lpad(seq::text,greatest(6,length(seq::text)),'0');
  insert into public.price_invoices(quotation_id,quotation_code,invoice_number,invoice_type,issued_at,supply_date,created_by,request_fingerprint,phase,seller,buyer,items,subtotal,delivery_fee,vat_rate,vat_amount,total,pricing_basis)
  values(quote.id,quote.quotation_code,code,v_type,issued,v_supply,p_actor,p_fingerprint,'phase1',config.seller,
    jsonb_build_object('name',coalesce(buyer_data->>'name',''),'address',coalesce(buyer_data->>'address',''),'phone',coalesce(buyer_data->>'phone',''),'vat_number',coalesce(buyer_data->>'vat_number','')),
    p_input->'items',quote.subtotal,quote.delivery_fee,quote.vat_rate,quote.vat_amount,quote.total,quote.pricing_basis) returning id into result;
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
