begin;

alter table public.invoice_items
  add column vat_inclusive boolean not null default false;

alter table public.invoice_items
  drop constraint invoice_items_total_math,
  add constraint invoice_items_total_math check (
    line_total = case
      when vat_inclusive then round(quantity * unit_price, 2)
      else round(quantity * unit_price + vat_amount, 2)
    end
  );

create or replace function public.complete_accepted_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_invoice uuid;
  v_quote uuid:=new.customer_quote_id;
begin
  insert into public.invoices(invoice_code,order_id,customer_profile_id,subtotal,vat_amount,delivery_fee,total,status)
  values('INV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),new.id,new.customer_profile_id,new.subtotal,new.vat_amount,new.delivery_fee,new.total,'unpaid')
  returning id into v_invoice;

  insert into public.invoice_items(
    invoice_id,order_item_id,description,quantity,unit_price,vat_rate,vat_amount,line_total,vat_inclusive
  )
  select
    v_invoice,
    order_item.id,
    quote_item.product_name_snapshot,
    quote_item.quantity,
    quote_item.unit_price,
    case when quote_item.subtotal=0 then 0 else round(quote_item.vat_amount/quote_item.subtotal*100,2) end,
    quote_item.vat_amount,
    quote_item.subtotal+quote_item.vat_amount,
    round(quote_item.quantity*quote_item.unit_price,2)=round(quote_item.subtotal+quote_item.vat_amount,2)
  from public.bunya_customer_quote_items quote_item
  join public.order_items order_item
    on order_item.order_id=new.id
   and order_item.product_id=quote_item.product_id
   and order_item.quantity=quote_item.quantity
  where quote_item.bunya_customer_quote_id=v_quote;

  insert into public.payment_records(invoice_id,customer_profile_id,idempotency_key,amount,status)
  values(v_invoice,new.customer_profile_id,'payment-pending:'||new.id,new.total,'pending');

  insert into public.internal_fulfillment_orders(
    fulfillment_code,bunya_customer_quote_id,provider_id,delivery_region,required_at,assigned_value,status
  )
  select
    'FUL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
    v_quote,selected.provider_id,request.city,request.desired_receipt_at,sum(selected.landed_cost),'assigned'
  from public.selected_provider_items selected
  join public.internal_selection_results selection on selection.id=selected.selection_result_id
  join public.internal_sourcing_requests source on source.id=selection.sourcing_request_id
  join public.quote_requests request on request.id=source.customer_request_id
  where request.id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote)
  group by selected.provider_id,request.city,request.desired_receipt_at;

  insert into public.internal_fulfillment_order_items(fulfillment_order_id,selected_provider_item_id)
  select fulfillment.id,selected.id
  from public.internal_fulfillment_orders fulfillment
  join public.selected_provider_items selected on selected.provider_id=fulfillment.provider_id
  join public.internal_selection_results selection on selection.id=selected.selection_result_id
  join public.internal_sourcing_requests source on source.id=selection.sourcing_request_id
  where fulfillment.bunya_customer_quote_id=v_quote
    and source.customer_request_id=(select customer_request_id from public.bunya_customer_quotes where id=v_quote);

  return new;
end
$$;

revoke all on function public.complete_accepted_order() from public,anon,authenticated;

commit;
