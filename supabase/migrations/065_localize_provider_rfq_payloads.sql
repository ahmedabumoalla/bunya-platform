-- Localize provider RFQ payloads at the trusted data boundary so both web and
-- Flutter receive the same reviewed product, unit, and measurement wording.

alter function public.get_provider_rfq_context(uuid)
  rename to get_provider_rfq_context_base;
alter function public.get_my_provider_rfq_list()
  rename to get_my_provider_rfq_list_base;

revoke all on function public.get_provider_rfq_context_base(uuid) from public, anon, authenticated;
revoke all on function public.get_my_provider_rfq_list_base() from public, anon, authenticated;

create function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_locale text;
  v_request_item public.quote_request_items%rowtype;
  v_product_description text;
begin
  v_result := public.get_provider_rfq_context_base(p_sourcing_item_id);
  select preferred_locale into v_locale from public.profiles where id=auth.uid();
  select q.* into v_request_item
  from public.internal_sourcing_request_items i
  join public.quote_request_items q on q.id=i.quote_request_item_id
  where i.id=p_sourcing_item_id;
  select case when v_locale='ar' then coalesce(p.short_description,p.description)
    else coalesce(nullif(t.short_description,''),nullif(t.description,''),p.short_description,p.description) end
  into v_product_description
  from public.products p
  left join public.product_translations t on t.product_id=p.id and t.locale=v_locale and t.reviewed_at is not null
  where p.id=v_request_item.product_id;
  return v_result || jsonb_build_object(
    'product_name', public.localize_snapshot(v_request_item.product_name_snapshot,v_request_item.product_name_translations,v_locale),
    'unit_snapshot', public.localize_snapshot(v_request_item.unit_name_snapshot,v_request_item.unit_name_translations,v_locale),
    'measurement_snapshot', public.localize_snapshot(v_request_item.measurement_label_snapshot,v_request_item.measurement_label_translations,v_locale),
    'product_description', v_product_description
  );
end;
$$;

create function public.get_my_provider_rfq_list()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_source jsonb;
  v_locale text;
  v_result jsonb;
begin
  v_source := public.get_my_provider_rfq_list_base();
  select preferred_locale into v_locale from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(
    entry.value || jsonb_build_object(
      'product_name', public.localize_snapshot(q.product_name_snapshot,q.product_name_translations,v_locale),
      'unit_snapshot', public.localize_snapshot(q.unit_name_snapshot,q.unit_name_translations,v_locale),
      'measurement_snapshot', public.localize_snapshot(q.measurement_label_snapshot,q.measurement_label_translations,v_locale),
      'product_description', case when v_locale='ar' then coalesce(p.short_description,p.description)
        else coalesce(nullif(t.short_description,''),nullif(t.description,''),p.short_description,p.description) end
    )
    order by entry.ordinality
  ), '[]'::jsonb) into v_result
  from jsonb_array_elements(v_source) with ordinality entry(value,ordinality)
  join public.internal_sourcing_request_items i on i.id=(entry.value->>'sourcing_request_item_id')::uuid
  join public.quote_request_items q on q.id=i.quote_request_item_id
  join public.products p on p.id=i.product_id
  left join public.product_translations t on t.product_id=p.id and t.locale=v_locale and t.reviewed_at is not null;
  return v_result;
end;
$$;

revoke all on function public.get_provider_rfq_context(uuid) from public,anon;
revoke all on function public.get_my_provider_rfq_list() from public,anon;
grant execute on function public.get_provider_rfq_context(uuid) to authenticated;
grant execute on function public.get_my_provider_rfq_list() to authenticated;
