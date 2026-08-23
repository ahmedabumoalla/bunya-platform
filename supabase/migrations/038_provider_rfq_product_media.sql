begin;

-- Published catalog images are customer-facing assets. Permit signed reads of
-- only objects that are still attached to an approved, published product.
drop policy if exists provider_product_images_published_read on storage.objects;
create policy provider_product_images_published_read
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'provider-product-images'
  and exists (
    select 1
    from public.product_images image
    join public.products product on product.id = image.product_id
    where image.storage_path = storage.objects.name
      and product.is_published
      and product.review_status = 'approved'
  )
);

create or replace function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_context jsonb;v_lowest_unit numeric;v_lowest_landed numeric;
begin
  if not exists (
    select 1 from public.internal_sourcing_request_targets target
    where target.sourcing_request_item_id=p_sourcing_item_id and public.is_provider_member(target.provider_id)
  ) then raise exception 'Target not found';end if;

  select response.unit_price,
    case when response.vat_inclusive
      then round(item.quantity*response.unit_price,2)+delivery.delivery_fee
      else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee
    end
  into v_lowest_unit,v_lowest_landed
  from public.provider_pricing_responses response
  join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  join public.internal_sourcing_request_items item on item.id=response.sourcing_request_item_id
  where response.sourcing_request_item_id=p_sourcing_item_id
    and response.price_expires_at>now() and availability.available and availability.available_quantity>=item.quantity
    and delivery.region_eligible
    and now()+make_interval(hours=>(delivery.preparation_duration_hours+delivery.delivery_duration_hours)::integer)<=item.required_at
  order by case when response.vat_inclusive then round(item.quantity*response.unit_price,2)+delivery.delivery_fee else round(item.quantity*response.unit_price*1.15,2)+delivery.delivery_fee end,response.receipt_confirmed_at,response.id
  limit 1;

  select jsonb_build_object(
    'sourcing_request_item_id',item.id,'response_deadline_at',target.response_deadline_at,
    'request_code',request.request_code,'internal_code',sourcing.internal_code,
    'product_id',product.id,'product_name',request_item.product_name_snapshot,'product_sku',product.sku,
    'product_description',coalesce(product.short_description,product.description),
    'product_image_storage_path',image.storage_path,'product_image_url',image.image_url,
    'quantity',item.quantity,'unit_snapshot',item.unit_snapshot,'measurement_snapshot',item.measurement_snapshot,
    'item_notes',request_item.notes,'delivery_region',item.delivery_region,'required_at',item.required_at,
    'location_hint',request.location_hint,'google_maps_url',request.google_maps_url,
    'delivery_mode',request.delivery_mode,'request_notes',request.notes,
    'current_lowest_unit_price',v_lowest_unit,'current_lowest_landed_cost',v_lowest_landed
  ) into v_context
  from public.internal_sourcing_request_items item
  join public.internal_sourcing_request_targets target on target.sourcing_request_item_id=item.id and public.is_provider_member(target.provider_id)
  join public.quote_request_items request_item on request_item.id=item.quote_request_item_id
  join public.products product on product.id=item.product_id
  join public.internal_sourcing_requests sourcing on sourcing.id=item.sourcing_request_id
  join public.quote_requests request on request.id=sourcing.customer_request_id
  left join lateral (
    select product_image.storage_path,product_image.image_url
    from public.product_images product_image
    where product_image.product_id=product.id
    order by product_image.is_primary desc,product_image.sort_order,product_image.created_at
    limit 1
  ) image on true
  where item.id=p_sourcing_item_id limit 1;
  return v_context;
end $$;

revoke all on function public.get_provider_rfq_context(uuid) from public,anon;
grant execute on function public.get_provider_rfq_context(uuid) to authenticated;

commit;
