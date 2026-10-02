begin;

-- Preserve legacy image metadata while permitting bounded catalog video files.
alter table public.product_images drop constraint product_images_file_size_bytes_check;
alter table public.product_images add constraint product_images_file_size_bytes_check check (
  file_size_bytes is null or file_size_bytes between 1 and
    case when mime_type in ('video/mp4','video/webm','video/quicktime') then 104857600 else 5242880 end
);
alter table public.product_images add constraint product_images_primary_is_image check (
  not is_primary or mime_type is null or mime_type like 'image/%'
) not valid;

-- Explicit covers must select exactly one image. Old snapshots without any
-- is_primary keys choose the first image, retaining legacy request compatibility.
create or replace function public.normalize_product_catalog_media(p_media jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare
  v_item jsonb;
  v_mime text;
  v_size bigint;
  v_index integer:=0;
  v_image_count integer:=0;
  v_primary_count integer:=0;
  v_first_image integer;
  v_explicit boolean:=false;
  v_result jsonb:='[]'::jsonb;
begin
  if p_media is null or jsonb_typeof(p_media)<>'array' then raise exception 'One to six product media files are required'; end if;
  if jsonb_array_length(p_media) not between 1 and 6 then raise exception 'One to six product media files are required'; end if;
  for v_item in select value from jsonb_array_elements(p_media) loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'Invalid product media'; end if;
    v_mime:=nullif(v_item ->> 'mime_type','');
    if v_mime is not null and v_mime not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime') then
      raise exception 'Unsupported product media type';
    end if;
    v_size:=nullif(v_item ->> 'file_size_bytes','')::bigint;
    if v_size is not null and (v_size<1 or v_size>case when v_mime like 'video/%' then 104857600 else 5242880 end) then
      raise exception 'Product media size exceeds its limit';
    end if;
    if v_mime is null or v_mime like 'image/%' then
      v_image_count:=v_image_count+1;
      v_first_image:=coalesce(v_first_image,v_index);
    end if;
    if v_item ? 'is_primary' then
      v_explicit:=true;
      if jsonb_typeof(v_item -> 'is_primary')<>'boolean' then raise exception 'Invalid primary image selection'; end if;
    end if;
    if v_item -> 'is_primary' = 'true'::jsonb then
      if v_mime like 'video/%' then raise exception 'The primary product media must be an image'; end if;
      v_primary_count:=v_primary_count+1;
    end if;
    v_index:=v_index+1;
  end loop;
  if v_image_count=0 then raise exception 'At least one product image is required'; end if;
  if v_explicit and v_primary_count<>1 then raise exception 'Exactly one primary product image is required'; end if;
  v_index:=0;
  for v_item in select value from jsonb_array_elements(p_media) loop
    v_result:=v_result || jsonb_build_array(v_item || jsonb_build_object('is_primary',
      case when v_explicit then coalesce((v_item ->> 'is_primary')::boolean,false) else v_index=v_first_image end));
    v_index:=v_index+1;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.normalize_product_catalog_media(jsonb) from public,anon,authenticated,service_role;

-- Client role checks use the effective database role, not a user-settable GUC.
-- Trusted SECURITY DEFINER commands and service/admin review keep their authority.
create or replace function public.guard_product_review_client_mutation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if current_user not in ('authenticated','anon') or public.admin_has_permission('reviews.manage') then return new; end if;
  if tg_op='INSERT' then
    if new.provider_id is not null and (new.is_published or new.review_status not in ('draft','pending_review')) then
      raise exception 'Product publication requires an authorized review';
    end if;
  elsif old.provider_id is not null or new.provider_id is not null then
    if new.provider_id is distinct from old.provider_id then raise exception 'Product provider cannot be reassigned'; end if;
    if new.is_published or (old.review_status<>'draft' and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at'))
       or (old.review_status='draft' and new.review_status not in ('draft','pending_review')) then
      raise exception 'Reviewed product changes require an authorized command';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_product_review_client_mutation() from public,anon,authenticated;
create trigger products_guard_review_client_mutation before insert or update on public.products
for each row execute function public.guard_product_review_client_mutation();

create or replace function public.guard_product_media_client_mutation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_product public.products%rowtype; v_product_id uuid;
begin
  if current_user not in ('authenticated','anon') or public.admin_has_permission('reviews.manage') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  v_product_id:=case when tg_op='DELETE' then old.product_id else new.product_id end;
  if tg_op='UPDATE' and old.product_id is distinct from new.product_id then raise exception 'Product media cannot be reassigned'; end if;
  select * into v_product from public.products where id=v_product_id for update;
  if v_product.provider_id is not null then
    if v_product.review_status<>'draft' then raise exception 'Reviewed product media requires an authorized command'; end if;
    if tg_op<>'DELETE' and (tg_op='INSERT' or new.storage_path is distinct from old.storage_path) then
      if new.storage_path is null or public.safe_storage_folder_uuid(new.storage_path) is distinct from v_product.provider_id
         or split_part(new.storage_path,'/',2)<>v_product_id::text
         or not exists(select 1 from storage.objects where bucket_id='provider-product-images' and name=new.storage_path) then
        raise exception 'Product media must reference an owned uploaded object';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_product_media_client_mutation() from public,anon,authenticated;
create trigger product_images_guard_review_client_mutation before insert or update or delete on public.product_images
for each row execute function public.guard_product_media_client_mutation();

-- Review decisions stay immutable to providers; SELECT is scoped by membership.
create policy product_reviews_provider_read on public.product_review_decisions
for select to authenticated using (exists (
  select 1 from public.products product where product.id=product_id and public.is_provider_member(product.provider_id)
));
grant select on public.product_review_decisions to authenticated;

-- Internal application primitive: callers own authorization, locking and status transitions.
create or replace function public.apply_product_catalog_snapshot(p_product_id uuid,p_snapshot jsonb,p_application_id uuid)
returns void language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare
  v_core jsonb;
  v_item jsonb;
  v_index integer;
  v_base_unit_id uuid;
  v_availability_summary text;
begin
  p_snapshot := jsonb_set(p_snapshot,'{images}',public.normalize_product_catalog_media(p_snapshot -> 'images'));
    v_core := p_snapshot -> 'core';
    v_availability_summary := case v_core ->> 'availability_status'
      when 'limited' then format('كمية محدودة: %s %s', coalesce(v_core ->> 'stock_quantity', '0'), v_core ->> 'base_unit')
      when 'on_request' then 'متوفر حسب الطلب'
      when 'unavailable' then 'غير متوفر حاليًا'
      else 'متوفر لدى المزود'
    end;

    update public.products set
      category_id = nullif(v_core ->> 'category_id', '')::uuid,
      custom_category = nullif(v_core ->> 'custom_category', ''),
      sku = nullif(v_core ->> 'sku', ''),
      name = v_core ->> 'name',
      base_unit = v_core ->> 'base_unit',
      short_description = v_core ->> 'short_description',
      description = v_core ->> 'description',
      full_description = v_core ->> 'full_description',
      availability_summary = v_availability_summary,
      availability_status = (v_core ->> 'availability_status')::public.product_availability_status,
      lead_time_label = v_core ->> 'lead_time_label',
      delivery_label = 'يتم تنسيق التسليم مع العميل',
      delivery_window = v_core ->> 'delivery_window',
      delivery_notes = v_core ->> 'delivery_notes',
      offer_type = (v_core ->> 'offer_type')::public.product_offer_type,
      minimum_order = nullif(v_core ->> 'minimum_order', '')::numeric,
      stock_quantity = nullif(v_core ->> 'stock_quantity', '')::numeric,
      rental_duration_value = nullif(v_core ->> 'rental_duration_value', '')::numeric,
      rental_duration_unit = nullif(v_core ->> 'rental_duration_unit', ''),
      updated_at = now()
    where id = p_product_id;

    select id into v_base_unit_id from public.product_units
    where product_id = p_product_id and is_base limit 1;

    delete from public.product_measurements where product_id = p_product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'measurements') loop
      insert into public.product_measurements(product_id, unit_id, label, is_default, sort_order)
      values(p_product_id, v_base_unit_id, btrim(v_item ->> 'label'), v_index = 0, v_index);
      v_index := v_index + 1;
    end loop;

    delete from public.product_variants where product_id = p_product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'variants') loop
      insert into public.product_variants(product_id, sku, name, attributes, is_active, sort_order)
      values(
        p_product_id,
        coalesce(nullif(v_core ->> 'sku',''), 'VAR') || '-CHG-' || substr(p_application_id::text,1,8) || '-' || (v_index + 1),
        btrim(v_item ->> 'name'),
        coalesce(v_item -> 'attributes', '{}'::jsonb),
        coalesce((v_item ->> 'is_active')::boolean, true),
        v_index
      );
      v_index := v_index + 1;
    end loop;

    delete from public.product_specifications where product_id = p_product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'specifications') loop
      insert into public.product_specifications(product_id, value, sort_order)
      values(p_product_id, btrim(v_item ->> 'value'), v_index);
      v_index := v_index + 1;
    end loop;

    delete from public.product_warranties where product_id = p_product_id;
    v_item := p_snapshot -> 'warranty';
    if v_item is not null and jsonb_typeof(v_item) = 'object' then
      insert into public.product_warranties(
        product_id, label, duration, details, is_available,
        duration_value, duration_unit, no_warranty_accepted
      ) values(
        p_product_id,
        coalesce(nullif(v_item ->> 'label',''), 'ضمان المنتج'),
        coalesce(nullif(v_item ->> 'duration',''), 'حسب شروط المزود'),
        coalesce(nullif(v_item ->> 'details',''), 'حسب شروط وضمان المزود'),
        true,
        coalesce(nullif(v_item ->> 'duration_value','')::numeric, 1),
        coalesce(nullif(v_item ->> 'duration_unit',''), v_item ->> 'duration', 'مدة'),
        false
      );
    end if;

    delete from public.product_availability_regions where product_id = p_product_id;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'availability_regions') loop
      insert into public.product_availability_regions(product_id, city, scope)
      values(p_product_id, btrim(v_item ->> 'city'), coalesce(nullif(btrim(v_item ->> 'scope'),''), 'المدينة'));
    end loop;

    delete from public.product_delivery_regions where product_id = p_product_id;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'delivery_regions') loop
      insert into public.product_delivery_regions(product_id, region_name)
      values(p_product_id, btrim(v_item ->> 'region_name'));
    end loop;

    delete from public.product_delivery_configs where product_id = p_product_id;
    v_item := p_snapshot -> 'delivery_config';
    if v_item is not null and jsonb_typeof(v_item) = 'object' then
      insert into public.product_delivery_configs(
        product_id, is_available, maximum_duration, duration_unit,
        price_per_km, maximum_distance_km, notes
      ) values(
        p_product_id,
        coalesce((v_item ->> 'is_available')::boolean, false),
        nullif(v_item ->> 'maximum_duration','')::numeric,
        nullif(v_item ->> 'duration_unit',''),
        nullif(v_item ->> 'price_per_km','')::numeric,
        nullif(v_item ->> 'maximum_distance_km','')::numeric,
        nullif(v_item ->> 'notes','')
      );
    end if;

    delete from public.product_images where product_id = p_product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(p_snapshot -> 'images') loop
      insert into public.product_images(
        product_id, label, alt_text, tone, image_url, storage_path,
        file_name, mime_type, file_size_bytes, is_primary, sort_order
      ) values(
        p_product_id,
        coalesce(nullif(v_item ->> 'label',''), (v_core ->> 'name') || ' - صورة ' || (v_index + 1)),
        coalesce(nullif(v_item ->> 'alt_text',''), 'صورة المنتج ' || (v_core ->> 'name')),
        coalesce(nullif(v_item ->> 'tone',''), 'tools')::public.product_image_tone,
        nullif(v_item ->> 'image_url',''),
        nullif(v_item ->> 'storage_path',''),
        nullif(v_item ->> 'file_name',''),
        nullif(v_item ->> 'mime_type',''),
        nullif(v_item ->> 'file_size_bytes','')::bigint,
        (v_item ->> 'is_primary')::boolean,
        v_index
      );
      v_index := v_index + 1;
    end loop;
end;
$$;
revoke all on function public.apply_product_catalog_snapshot(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.submit_product_change_request(
  p_product_id uuid,
  p_proposed_snapshot jsonb,
  p_request_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_provider_name text;
  v_before jsonb;
  v_proposed jsonb;
  v_core jsonb;
  v_changes jsonb;
  v_request_id uuid;
  v_event_id uuid;
  v_existing uuid;
  v_resubmission_key text;
  v_images jsonb;
  v_category_id uuid;
  v_custom_category text;
  v_name text;
  v_base_unit text;
  v_description text;
  v_offer_type text;
  v_availability text;
  v_stock numeric;
  v_minimum numeric;
  v_rental numeric;
  v_note text := nullif(btrim(coalesce(p_request_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(coalesce(p_idempotency_key, '')) not between 8 and 120 then raise exception 'Invalid idempotency key'; end if;
  if jsonb_typeof(p_proposed_snapshot) <> 'object' then raise exception 'Invalid proposed product data'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'Request note is too long'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':product-change:' || p_product_id::text, 0));

  select request.id into v_existing
  from public.product_change_requests request
  where request.provider_id in (select provider.id from public.providers provider where public.is_provider_member(provider.id))
    and request.product_id = p_product_id
    and request.idempotency_key = p_idempotency_key
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('request_id', v_existing, 'replayed', true);
  end if;

  select *
    into v_product
    from public.products product
   where product.id = p_product_id
   for update;

  if not found then raise exception 'Product not found'; end if;
  select provider.company_name
    into v_provider_name
    from public.providers provider
   where provider.id = v_product.provider_id;
  if not public.is_provider_member(v_product.provider_id) then raise exception 'Product provider membership required'; end if;
  v_resubmission_key := 'product-resubmission:' || p_product_id || ':' || v_product.provider_id || ':' || p_idempotency_key;
  select id into v_event_id from public.outbox_events
  where idempotency_key=v_resubmission_key and aggregate_id=p_product_id and event_type='product.resubmitted';
  if found then
    return jsonb_build_object('product_id',p_product_id,'review_status','pending_review','event_id',v_event_id,'replayed',true);
  end if;
  if v_product.review_status <> 'needs_changes'
     and (v_product.review_status <> 'approved' or not v_product.is_published) then
    raise exception 'Only approved published products or products needing changes can submit changes';
  end if;
  if exists (select 1 from public.product_change_requests where product_id = p_product_id and status = 'pending') then
    raise exception 'A product change request is already pending';
  end if;

  v_core := p_proposed_snapshot -> 'core';
  if jsonb_typeof(v_core) <> 'object' then raise exception 'Product core data is required'; end if;
  v_name := btrim(coalesce(v_core ->> 'name', ''));
  v_base_unit := btrim(coalesce(v_core ->> 'base_unit', ''));
  v_description := btrim(coalesce(v_core ->> 'description', ''));
  v_offer_type := coalesce(v_core ->> 'offer_type', 'sale');
  v_availability := coalesce(v_core ->> 'availability_status', 'available');
  v_minimum := nullif(v_core ->> 'minimum_order', '')::numeric;
  v_stock := nullif(v_core ->> 'stock_quantity', '')::numeric;
  v_rental := nullif(v_core ->> 'rental_duration_value', '')::numeric;
  v_category_id := nullif(v_core ->> 'category_id', '')::uuid;
  v_custom_category := nullif(btrim(coalesce(v_core ->> 'custom_category', '')), '');

  if length(v_name) not between 2 and 160 or length(v_base_unit) not between 1 and 80 or length(v_description) < 10 then
    raise exception 'Complete the product name, unit, and description';
  end if;
  if (v_minimum is not null and v_minimum <= 0) or (v_stock is not null and v_stock < 0) then
    raise exception 'Invalid product quantity';
  end if;
  if v_offer_type not in ('sale','rental') or v_availability not in ('available','limited','on_request','unavailable') then
    raise exception 'Invalid product offer or availability status';
  end if;
  if v_availability = 'limited' and coalesce(v_stock, 0) <= 0 then raise exception 'Limited stock quantity is required'; end if;
  if v_offer_type = 'rental' and (coalesce(v_rental, 0) <= 0 or nullif(btrim(coalesce(v_core ->> 'rental_duration_unit', '')), '') is null) then
    raise exception 'Rental duration is required';
  end if;
  if (v_category_id is null) = (v_custom_category is null) then raise exception 'Choose a standard or custom category'; end if;
  if v_category_id is not null and not exists (select 1 from public.product_categories where id = v_category_id and is_active) then
    raise exception 'Selected category is unavailable';
  end if;
  if v_custom_category is not null and length(v_custom_category) not between 2 and 80 then raise exception 'Invalid custom category'; end if;
  if exists (select 1 from public.products where sku = nullif(btrim(v_core ->> 'sku'), '') and id <> p_product_id) then
    raise exception 'Product SKU is already used';
  end if;
  v_images := public.normalize_product_catalog_media(p_proposed_snapshot -> 'images');
  if jsonb_typeof(coalesce(p_proposed_snapshot -> 'measurements', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposed_snapshot -> 'measurements', '[]'::jsonb)) > 40 then raise exception 'Invalid measurements'; end if;
  if jsonb_typeof(coalesce(p_proposed_snapshot -> 'variants', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposed_snapshot -> 'variants', '[]'::jsonb)) > 60 then raise exception 'Invalid product options'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_proposed_snapshot -> 'images') image
    where (
      nullif(image ->> 'storage_path', '') is null
      and nullif(image ->> 'image_url', '') is null
    ) or (
      nullif(image ->> 'storage_path', '') is not null
      and not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'provider-product-images'
          and object.name = image ->> 'storage_path'
          and public.safe_storage_folder_uuid(object.name) = v_product.provider_id
      )
    )
  ) then raise exception 'A proposed image is unavailable'; end if;

  v_proposed := jsonb_build_object(
    'core', jsonb_build_object(
      'category_id', v_category_id,
      'custom_category', v_custom_category,
      'sku', nullif(btrim(v_core ->> 'sku'), ''),
      'name', v_name,
      'base_unit', v_base_unit,
      'short_description', coalesce(nullif(btrim(v_core ->> 'short_description'), ''), v_description),
      'description', v_description,
      'full_description', coalesce(nullif(btrim(v_core ->> 'full_description'), ''), v_description),
      'availability_status', v_availability,
      'lead_time_label', btrim(coalesce(v_core ->> 'lead_time_label', '')),
      'delivery_window', btrim(coalesce(v_core ->> 'delivery_window', '')),
      'delivery_notes', btrim(coalesce(v_core ->> 'delivery_notes', '')),
      'offer_type', v_offer_type,
      'minimum_order', v_minimum,
      'stock_quantity', v_stock,
      'rental_duration_value', case when v_offer_type = 'rental' then v_rental end,
      'rental_duration_unit', case when v_offer_type = 'rental' then nullif(btrim(v_core ->> 'rental_duration_unit'), '') end
    ),
    'images', v_images,
    'measurements', coalesce(p_proposed_snapshot -> 'measurements', '[]'::jsonb),
    'variants', coalesce(p_proposed_snapshot -> 'variants', '[]'::jsonb),
    'specifications', coalesce(p_proposed_snapshot -> 'specifications', '[]'::jsonb),
    'warranty', p_proposed_snapshot -> 'warranty',
    'availability_regions', coalesce(p_proposed_snapshot -> 'availability_regions', '[]'::jsonb),
    'delivery_config', p_proposed_snapshot -> 'delivery_config',
    'delivery_regions', coalesce(p_proposed_snapshot -> 'delivery_regions', '[]'::jsonb)
  );
  if nullif(v_proposed #>> '{core,lead_time_label}', '') is null
     or nullif(v_proposed #>> '{core,delivery_window}', '') is null
     or nullif(v_proposed #>> '{core,delivery_notes}', '') is null then
    raise exception 'Preparation and delivery details are required';
  end if;

  v_before := public.capture_product_change_snapshot(p_product_id);
  v_changes := public.product_change_snapshot_diff(v_before #- '{core,unit_price}' #- '{core,vat_inclusive}', v_proposed);
  if jsonb_array_length(v_changes) = 0 and v_product.review_status <> 'needs_changes' then
    raise exception 'No product data was changed';
  end if;

  if v_product.review_status='needs_changes' then
    -- A processed internal event is the durable idempotency receipt. The existing
    -- pending-review triggers deliver reviewer alerts once after the full apply.
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key,status,processed_at)
    values('product',p_product_id,'product.resubmitted',
      jsonb_build_object('product_id',p_product_id,'provider_id',v_product.provider_id,'review_status','pending_review'),
      v_resubmission_key,'processed',now()) returning id into v_event_id;
    perform public.apply_product_catalog_snapshot(p_product_id,v_proposed,v_event_id);
    update public.products set review_status='pending_review',is_published=false,updated_at=now()
    where id=p_product_id;
    insert into public.audit_logs(actor_profile_id,provider_id,entity_table,entity_id,action,old_data,new_data)
    values(auth.uid(),v_product.provider_id,'products',p_product_id::text,'product_resubmitted',
      v_before,jsonb_build_object('snapshot',v_proposed,'review_status','pending_review','is_published',false,
        'request_note',v_note,'event_id',v_event_id));
    return jsonb_build_object('product_id',p_product_id,'review_status','pending_review','event_id',v_event_id,'replayed',false);
  end if;

  insert into public.product_change_requests(
    product_id, provider_id, requested_by, before_snapshot, proposed_snapshot,
    changes, request_note, idempotency_key
  ) values (
    p_product_id, v_product.provider_id, auth.uid(), v_before, v_proposed,
    v_changes, v_note, p_idempotency_key
  ) returning id into v_request_id;

  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values(
    'product_change_request', v_request_id, 'admin.product_change_requested',
    jsonb_build_object(
      'request_id', v_request_id,
      'product_id', p_product_id,
      'provider_id', v_product.provider_id,
      'provider_name', v_provider_name,
      'product_name', v_name,
      'change_count', jsonb_array_length(v_changes)
    ),
    'product-change-request:' || v_request_id
  ) returning id into v_event_id;

  perform set_config('bunya.internal_notification_write', 'on', true);
  insert into public.notifications(
    profile_id, actor_profile_id, type, title, message, action_url,
    entity_type, entity_id, metadata, event_key
  )
  select
    admin_user.profile_id,
    auth.uid(),
    'admin.product_change_requested',
    'طلب تعديل بيانات منتج',
    format('أرسلت منشأة %s طلب تعديل للمنتج «%s». عدد مجموعات البيانات المتغيرة: %s.', v_provider_name, v_name, jsonb_array_length(v_changes)),
    '/admin/products/changes/' || v_request_id,
    'product_change_request',
    v_request_id,
    jsonb_build_object('product_id', p_product_id, 'provider_id', v_product.provider_id, 'change_count', jsonb_array_length(v_changes)),
    'outbox-' || v_event_id || '-' || admin_user.profile_id
  from public.admin_users admin_user
  where admin_user.is_active;
  perform set_config('bunya.internal_notification_write', 'off', true);

  insert into public.audit_logs(actor_profile_id, provider_id, entity_table, entity_id, action, old_data, new_data)
  values(auth.uid(), v_product.provider_id, 'product_change_requests', v_request_id::text, 'product_change_requested', v_before, v_proposed);

  return jsonb_build_object('request_id', v_request_id, 'event_id', v_event_id, 'replayed', false);
end;
$$;

create or replace function public.review_product_change_request(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_request public.product_change_requests%rowtype;
  v_product public.products%rowtype;
  v_admin_user_id uuid;
  v_event_id uuid;
  v_owner uuid;
  v_provider_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.admin_has_permission('reviews.manage') then raise exception 'Product review permission required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid change request decision'; end if;
  if length(v_reason) < 5 then raise exception 'A clear review reason is required'; end if;
  if length(coalesce(p_idempotency_key, '')) not between 8 and 120 then raise exception 'Invalid idempotency key'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':product-change-review:' || p_request_id::text, 0));

  select * into v_request from public.product_change_requests where id = p_request_id for update;
  if not found then raise exception 'Product change request not found'; end if;
  if v_request.status <> 'pending' then
    if v_request.decision_idempotency_key = p_idempotency_key then
      return jsonb_build_object('request_id', p_request_id, 'status', v_request.status, 'replayed', true);
    end if;
    raise exception 'Product change request was already reviewed';
  end if;

  select id into v_admin_user_id from public.admin_users where profile_id = auth.uid() and is_active limit 1;
  if v_admin_user_id is null then raise exception 'Active admin account required'; end if;

  select *
    into v_product
    from public.products product
   where product.id = v_request.product_id
   for update;
  if not found then raise exception 'Product not found'; end if;
  select provider.owner_profile_id, provider.company_name
    into v_owner, v_provider_name
    from public.providers provider
   where provider.id = v_product.provider_id;

  if p_decision = 'approved' then
    perform public.apply_product_catalog_snapshot(v_request.product_id,v_request.proposed_snapshot,v_request.id);
    update public.products set is_published=true,review_status='approved',updated_at=now()
    where id=v_request.product_id;
  end if;

  update public.product_change_requests set
    status = p_decision,
    review_reason = v_reason,
    reviewed_by = v_admin_user_id,
    reviewed_at = now(),
    decision_idempotency_key = p_idempotency_key
  where id = p_request_id;

  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values(
    'product_change_request', p_request_id, 'provider.product_change_' || p_decision,
    jsonb_build_object(
      'request_id', p_request_id,
      'product_id', v_request.product_id,
      'provider_id', v_request.provider_id,
      'product_name', v_request.proposed_snapshot #>> '{core,name}',
      'reason', v_reason
    ),
    'product-change-decision:' || p_request_id
  ) returning id into v_event_id;

  perform set_config('bunya.internal_notification_write', 'on', true);
  insert into public.notifications(
    profile_id, actor_profile_id, type, title, message, action_url,
    entity_type, entity_id, metadata, event_key
  ) values(
    v_owner,
    auth.uid(),
    'provider.product_change_' || p_decision,
    case when p_decision = 'approved' then 'تم اعتماد تعديلات المنتج' else 'تم رفض تعديلات المنتج' end,
    format('%s للمنتج «%s». ملاحظة الإدارة: %s',
      case when p_decision = 'approved' then 'تم اعتماد وتطبيق التعديلات' else 'تم رفض طلب التعديل' end,
      v_request.proposed_snapshot #>> '{core,name}', v_reason),
    '/merchant/products',
    'product',
    v_request.product_id,
    jsonb_build_object('change_request_id', p_request_id, 'decision', p_decision),
    'outbox-' || v_event_id || '-' || v_owner
  ) on conflict(event_key) where event_key is not null do nothing;
  perform set_config('bunya.internal_notification_write', 'off', true);

  insert into public.audit_logs(actor_profile_id, provider_id, entity_table, entity_id, action, old_data, new_data)
  values(auth.uid(), v_request.provider_id, 'product_change_requests', p_request_id::text, 'product_change_' || p_decision, v_request.before_snapshot, v_request.proposed_snapshot);

  return jsonb_build_object('request_id', p_request_id, 'status', p_decision, 'event_id', v_event_id, 'replayed', false);
end;
$$;

create or replace function public.enqueue_product_review_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_name text;
begin
  if new.review_status <> 'pending_review' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.review_status = new.review_status then
    return new;
  end if;

  select company_name
    into v_provider_name
    from public.providers
   where id = new.provider_id;

  insert into public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    'product',
    new.id,
    'admin.product_pending_review',
    jsonb_build_object(
      'provider_id', new.provider_id,
      'provider_name', v_provider_name,
      'product_name', new.name
    ),
    'product-review-whatsapp:' || new.id ||
      case when tg_op='UPDATE' and old.review_status='needs_changes' then ':resubmission:' || gen_random_uuid()::text else '' end
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return new;
end;
$$;

revoke execute on function public.enqueue_product_review_whatsapp() from public,anon,authenticated;
revoke execute on function public.submit_product_change_request(uuid,jsonb,text,text),public.review_product_change_request(uuid,text,text,text) from public,anon;
grant execute on function public.submit_product_change_request(uuid,jsonb,text,text),public.review_product_change_request(uuid,text,text,text) to authenticated;
create or replace function public.submit_product_for_review(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_product
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if not public.is_provider_member(v_product.provider_id) and not public.is_admin() then
    raise exception 'Product provider membership required';
  end if;

  if v_product.review_status <> 'draft' then
    raise exception 'Product cannot be submitted from its current status';
  end if;

  if not exists (
    select 1 from public.product_images image where image.product_id = p_product_id
  ) then
    raise exception 'At least one product image is required';
  end if;

  perform public.normalize_product_catalog_media(public.capture_product_change_snapshot(p_product_id) -> 'images');

  update public.products
     set review_status = 'pending_review',
         is_published = false,
         updated_at = now()
   where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'review_status', 'pending_review'
  );
end
$$;
revoke execute on function public.submit_product_for_review(uuid) from public,anon;
grant execute on function public.submit_product_for_review(uuid) to authenticated;

commit;
