begin;

alter table public.quote_request_items
  add column variant_selections jsonb not null default '[]'::jsonb,
  add column variant_label_snapshot text;

alter table public.quote_request_items
  add constraint quote_request_items_variant_selections_array
  check (jsonb_typeof(variant_selections) = 'array');

create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_source uuid;
  v_source_item uuid;
  v_deadline timestamptz;
  v_required timestamptz;
  v_city text;
  v_count integer:=0;
  v_added integer;
  v_open timestamptz;
  v_start timestamptz;
  v_product public.products%rowtype;
  v_variant_ids uuid[];
  v_variant_selections jsonb;
  v_variant_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.customer_profiles where profile_id=auth.uid()) then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid items';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':rfq:'||p_idempotency_key,0));
  select aggregate_id into v_id from public.outbox_events where aggregate_type='quote_request' and idempotency_key='rfq:'||auth.uid()||':'||p_idempotency_key limit 1;
  if found then return v_id;end if;
  v_city:=btrim(p_request->>'city');v_required:=(p_request->>'desired_receipt_at')::timestamptz;
  select pricing_window.pricing_opens_at,pricing_window.pricing_countdown_starts_at,pricing_window.response_deadline_at into v_open,v_start,v_deadline from public.rfq_pricing_window(now()) pricing_window;
  v_deadline:=least(v_deadline,v_required-interval '1 hour');
  if length(v_city)<2 or v_required<=now()+interval '2 hours' or v_deadline<=now() then raise exception 'Invalid request schedule';end if;
  insert into public.quote_requests(request_code,requester_id,requester_role,city,location_hint,desired_receipt_at,quote_window_label,quote_deadline,pricing_opens_at,pricing_countdown_starts_at,notes,status,delivery_mode,project_name,recipient_name,recipient_mobile)
  values('RFQ-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),auth.uid(),'customer',v_city,btrim(coalesce(p_request->>'location_hint',v_city)),v_required,'3 ساعات تسعير · من 8 ص إلى 4 م بتوقيت الرياض',v_deadline,v_open,v_start,nullif(btrim(p_request->>'notes'),''),'submitted',case when p_request->>'delivery_mode'='pickup' then 'pickup' else 'delivery' end,nullif(btrim(p_request->>'project_name'),''),nullif(btrim(p_request->>'recipient_name'),''),nullif(btrim(p_request->>'recipient_mobile'),'')) returning id into v_id;
  insert into public.internal_sourcing_requests(internal_code,customer_request_id,stage,expected_ready_at,response_deadline_at)
  values('SRC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_id,'received',least(v_required,v_deadline+interval '2 hours'),v_deadline) returning id into v_source;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id:=null;
    if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Invalid item quantity';end if;
    select * into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.is_published and p.review_status='approved';
    if not found then raise exception 'Product is not available';end if;

    if jsonb_typeof(coalesce(v_item->'variant_ids','[]'::jsonb))<>'array' then raise exception 'Invalid product variants';end if;
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_variant_ids
    from jsonb_array_elements_text(coalesce(v_item->'variant_ids','[]'::jsonb));
    if cardinality(v_variant_ids)<>jsonb_array_length(coalesce(v_item->'variant_ids','[]'::jsonb)) then raise exception 'Duplicate product variant';end if;
    select
      coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name,'attributes',variant.attributes) order by variant.sort_order,variant.name),'[]'::jsonb),
      string_agg(
        coalesce(
          nullif((select string_agg(attribute.key||': '||attribute.value,'، ' order by attribute.key) from jsonb_each_text(variant.attributes) attribute),''),
          variant.name
        ),
        ' · ' order by variant.sort_order,variant.name
      )
    into v_variant_selections,v_variant_label
    from public.product_variants variant
    where variant.product_id=v_product.id and variant.is_active and variant.id=any(v_variant_ids);
    if jsonb_array_length(v_variant_selections)<>cardinality(v_variant_ids) then raise exception 'Product variant is not available';end if;
    if exists(select 1 from public.product_variants variant where variant.product_id=v_product.id and variant.is_active)
      and cardinality(v_variant_ids)=0 then raise exception 'Product variant is required';end if;
    if exists(
      select 1
      from (
        select distinct available_key.key
        from public.product_variants available
        cross join lateral jsonb_object_keys(available.attributes) available_key(key)
        where available.product_id=v_product.id and available.is_active
      ) required_group
      where not exists(
        select 1
        from public.product_variants selected
        cross join lateral jsonb_object_keys(selected.attributes) selected_key(key)
        where selected.id=any(v_variant_ids) and selected_key.key=required_group.key
      )
    ) then raise exception 'Select every product variant group';end if;
    if exists(
      select selected_key.key
      from public.product_variants selected
      cross join lateral jsonb_object_keys(selected.attributes) selected_key(key)
      where selected.id=any(v_variant_ids)
      group by selected_key.key having count(*)>1
    ) then raise exception 'Select one value per product variant group';end if;

    insert into public.quote_request_items(request_id,product_id,measurement_id,unit_id,product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes,variant_selections,variant_label_snapshot)
    values(v_id,v_product.id,nullif(v_item->>'measurement_id','')::uuid,nullif(v_item->>'unit_id','')::uuid,v_product.name,nullif(btrim(v_item->>'measurement'),''),coalesce(nullif(btrim(v_item->>'unit'),''),v_product.base_unit),(v_item->>'quantity')::numeric,nullif(btrim(v_item->>'notes'),''),v_variant_selections,nullif(v_variant_label,''))
    returning id into v_item_id;
    insert into public.internal_sourcing_request_items(sourcing_request_id,quote_request_item_id,product_id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at)
    select v_source,v_item_id,i.product_id,i.quantity,i.unit_name_snapshot,i.measurement_label_snapshot,v_city,v_required from public.quote_request_items i where i.id=v_item_id returning id into v_source_item;
    insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
    select v_source_item,matched_provider_id,v_deadline from public.match_rfq_providers((v_item->>'product_id')::uuid,v_city,coalesce(p_request->>'delivery_mode','delivery')) on conflict do nothing;
    get diagnostics v_added=row_count;v_count:=v_count+v_added;
  end loop;
  update public.quote_requests set status=(case when v_count>0 then 'sourcing' else 'verifying' end)::public.quote_request_status where id=v_id;
  update public.internal_sourcing_requests set stage=(case when v_count>0 then 'comparing_prices' else 'verifying_availability' end)::public.quote_processing_stage where id=v_source;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('quote_request',v_id,case when v_count>0 then 'rfq.submitted' else 'admin.rfq_no_providers' end,jsonb_build_object('sourcing_request_id',v_source),'rfq:'||auth.uid()||':'||p_idempotency_key);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select 'sourcing_target',target.sourcing_request_item_id,'provider.rfq_new',jsonb_build_object('provider_id',target.provider_id,'sourcing_item_id',target.sourcing_request_item_id),'rfq-target:'||target.sourcing_request_item_id||':'||target.provider_id from public.internal_sourcing_request_targets target join public.internal_sourcing_request_items item on item.id=target.sourcing_request_item_id where item.sourcing_request_id=v_source on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return v_id;
end $$;

revoke execute on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;

create or replace function public.get_provider_rfq_context(p_sourcing_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_locale text;v_request_item public.quote_request_items%rowtype;v_product_description text;
begin
  v_result:=public.get_provider_rfq_context_base(p_sourcing_item_id);
  select preferred_locale into v_locale from public.profiles where id=auth.uid();
  select q.* into v_request_item from public.internal_sourcing_request_items i join public.quote_request_items q on q.id=i.quote_request_item_id where i.id=p_sourcing_item_id;
  select case when v_locale='ar' then coalesce(p.short_description,p.description) else coalesce(nullif(t.short_description,''),nullif(t.description,''),p.short_description,p.description) end into v_product_description
  from public.products p left join public.product_translations t on t.product_id=p.id and t.locale=v_locale and t.reviewed_at is not null where p.id=v_request_item.product_id;
  return v_result||jsonb_build_object(
    'product_name',public.localize_snapshot(v_request_item.product_name_snapshot,v_request_item.product_name_translations,v_locale),
    'unit_snapshot',public.localize_snapshot(v_request_item.unit_name_snapshot,v_request_item.unit_name_translations,v_locale),
    'measurement_snapshot',public.localize_snapshot(v_request_item.measurement_label_snapshot,v_request_item.measurement_label_translations,v_locale),
    'variant_snapshot',v_request_item.variant_label_snapshot,
    'variant_selections',v_request_item.variant_selections,
    'product_description',v_product_description
  );
end $$;

create or replace function public.get_my_provider_rfq_list()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source jsonb;v_locale text;v_result jsonb;
begin
  v_source:=public.get_my_provider_rfq_list_base();
  select preferred_locale into v_locale from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(
    entry.value||jsonb_build_object(
      'product_name',public.localize_snapshot(q.product_name_snapshot,q.product_name_translations,v_locale),
      'unit_snapshot',public.localize_snapshot(q.unit_name_snapshot,q.unit_name_translations,v_locale),
      'measurement_snapshot',public.localize_snapshot(q.measurement_label_snapshot,q.measurement_label_translations,v_locale),
      'variant_snapshot',q.variant_label_snapshot,
      'variant_selections',q.variant_selections,
      'product_description',case when v_locale='ar' then coalesce(p.short_description,p.description) else coalesce(nullif(t.short_description,''),nullif(t.description,''),p.short_description,p.description) end
    ) order by entry.ordinality
  ),'[]'::jsonb) into v_result
  from jsonb_array_elements(v_source) with ordinality entry(value,ordinality)
  join public.internal_sourcing_request_items i on i.id=(entry.value->>'sourcing_request_item_id')::uuid
  join public.quote_request_items q on q.id=i.quote_request_item_id
  join public.products p on p.id=i.product_id
  left join public.product_translations t on t.product_id=p.id and t.locale=v_locale and t.reviewed_at is not null;
  return v_result;
end $$;

revoke all on function public.get_provider_rfq_context(uuid) from public,anon;
revoke all on function public.get_my_provider_rfq_list() from public,anon;
grant execute on function public.get_provider_rfq_context(uuid) to authenticated;
grant execute on function public.get_my_provider_rfq_list() to authenticated;

commit;
