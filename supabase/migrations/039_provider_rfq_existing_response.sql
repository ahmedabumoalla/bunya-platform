begin;

create or replace function public.get_my_provider_rfq_response(p_sourcing_item_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',response.id,'response_code',response.response_code,'status',response.status,
    'unit_price',response.unit_price,'vat_inclusive',response.vat_inclusive,
    'price_expires_at',response.price_expires_at,'notes',response.internal_notes,
    'available',availability.available,'available_quantity',availability.available_quantity,
    'region_eligible',delivery.region_eligible,'preparation_hours',delivery.preparation_duration_hours,
    'delivery_hours',delivery.delivery_duration_hours,'delivery_fee',delivery.delivery_fee,
    'submitted_at',response.receipt_confirmed_at
  )
  from public.provider_pricing_responses response
  left join public.provider_availability_confirmations availability on availability.pricing_response_id=response.id
  left join public.provider_delivery_confirmations delivery on delivery.pricing_response_id=response.id
  where response.sourcing_request_item_id=p_sourcing_item_id
    and public.is_provider_member(response.provider_id)
  order by response.receipt_confirmed_at desc,response.id
  limit 1
$$;

revoke all on function public.get_my_provider_rfq_response(uuid) from public,anon;
grant execute on function public.get_my_provider_rfq_response(uuid) to authenticated;

commit;
