begin;

create table if not exists public.product_change_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  before_snapshot jsonb not null,
  proposed_snapshot jsonb not null,
  changes jsonb not null check (jsonb_typeof(changes) = 'array'),
  request_note text,
  review_reason text,
  reviewed_by uuid references public.admin_users(id) on delete set null,
  reviewed_at timestamptz,
  idempotency_key text not null,
  decision_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_change_request_note_length check (request_note is null or length(request_note) <= 1000),
  constraint product_change_review_reason_length check (review_reason is null or length(review_reason) <= 1000),
  constraint product_change_review_shape check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null)
  ),
  unique (provider_id, idempotency_key)
);

create unique index if not exists product_change_requests_one_pending_idx
  on public.product_change_requests(product_id) where status = 'pending';
create unique index if not exists product_change_requests_decision_key_idx
  on public.product_change_requests(decision_idempotency_key)
  where decision_idempotency_key is not null;
create index if not exists product_change_requests_admin_queue_idx
  on public.product_change_requests(status, created_at desc);
create index if not exists product_change_requests_provider_idx
  on public.product_change_requests(provider_id, created_at desc);

drop trigger if exists product_change_requests_set_updated_at on public.product_change_requests;
create trigger product_change_requests_set_updated_at
before update on public.product_change_requests
for each row execute function public.set_updated_at();

alter table public.product_change_requests enable row level security;

drop policy if exists product_change_requests_provider_read on public.product_change_requests;
create policy product_change_requests_provider_read
on public.product_change_requests for select to authenticated
using (public.is_provider_member(provider_id) or public.is_admin());

grant select on public.product_change_requests to authenticated;

create or replace function public.capture_product_change_snapshot(p_product_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'core', jsonb_build_object(
      'category_id', product.category_id,
      'custom_category', product.custom_category,
      'sku', product.sku,
      'name', product.name,
      'base_unit', product.base_unit,
      'short_description', product.short_description,
      'description', product.description,
      'full_description', product.full_description,
      'availability_status', product.availability_status,
      'lead_time_label', product.lead_time_label,
      'delivery_window', product.delivery_window,
      'delivery_notes', product.delivery_notes,
      'offer_type', product.offer_type,
      'unit_price', product.unit_price,
      'minimum_order', product.minimum_order,
      'stock_quantity', product.stock_quantity,
      'vat_inclusive', product.vat_inclusive,
      'rental_duration_value', product.rental_duration_value,
      'rental_duration_unit', product.rental_duration_unit
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', image.id,
        'label', image.label,
        'alt_text', image.alt_text,
        'tone', image.tone,
        'image_url', image.image_url,
        'storage_path', image.storage_path,
        'file_name', image.file_name,
        'mime_type', image.mime_type,
        'file_size_bytes', image.file_size_bytes,
        'is_primary', image.is_primary,
        'sort_order', image.sort_order
      ) order by image.is_primary desc, image.sort_order, image.id)
      from public.product_images image where image.product_id = product.id
    ), '[]'::jsonb),
    'measurements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', measurement.label,
        'is_default', measurement.is_default,
        'sort_order', measurement.sort_order
      ) order by measurement.is_default desc, measurement.sort_order, measurement.id)
      from public.product_measurements measurement where measurement.product_id = product.id
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', variant.name,
        'attributes', variant.attributes,
        'is_active', variant.is_active,
        'sort_order', variant.sort_order
      ) order by variant.sort_order, variant.id)
      from public.product_variants variant where variant.product_id = product.id
    ), '[]'::jsonb),
    'specifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'value', specification.value,
        'sort_order', specification.sort_order
      ) order by specification.sort_order, specification.id)
      from public.product_specifications specification where specification.product_id = product.id
    ), '[]'::jsonb),
    'warranty', (
      select to_jsonb(warranty) - 'product_id' - 'created_at' - 'updated_at'
      from public.product_warranties warranty where warranty.product_id = product.id
    ),
    'availability_regions', coalesce((
      select jsonb_agg(jsonb_build_object('city', region.city, 'scope', region.scope) order by region.city, region.scope)
      from public.product_availability_regions region where region.product_id = product.id
    ), '[]'::jsonb),
    'delivery_config', (
      select to_jsonb(config) - 'product_id' - 'created_at' - 'updated_at'
      from public.product_delivery_configs config where config.product_id = product.id
    ),
    'delivery_regions', coalesce((
      select jsonb_agg(jsonb_build_object('region_name', region.region_name) order by region.region_name)
      from public.product_delivery_regions region where region.product_id = product.id
    ), '[]'::jsonb)
  )
  from public.products product
  where product.id = p_product_id;
$$;

revoke all on function public.capture_product_change_snapshot(uuid)
  from public, anon, authenticated;

create or replace function public.product_change_snapshot_diff(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  with keys as (
    select key from jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) key
    union
    select key from jsonb_object_keys(coalesce(p_after, '{}'::jsonb)) key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'field', key,
    'before', p_before -> key,
    'after', p_after -> key
  ) order by key) filter (where (p_before -> key) is distinct from (p_after -> key)), '[]'::jsonb)
  from keys;
$$;

revoke all on function public.product_change_snapshot_diff(jsonb, jsonb)
  from public, anon, authenticated;

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
  v_category_id uuid;
  v_custom_category text;
  v_name text;
  v_base_unit text;
  v_description text;
  v_offer_type text;
  v_availability text;
  v_unit_price numeric;
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
  if v_product.review_status <> 'approved' or not v_product.is_published then
    raise exception 'Only approved published products can request data changes';
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
  v_unit_price := nullif(v_core ->> 'unit_price', '')::numeric;
  v_minimum := nullif(v_core ->> 'minimum_order', '')::numeric;
  v_stock := nullif(v_core ->> 'stock_quantity', '')::numeric;
  v_rental := nullif(v_core ->> 'rental_duration_value', '')::numeric;
  v_category_id := nullif(v_core ->> 'category_id', '')::uuid;
  v_custom_category := nullif(btrim(coalesce(v_core ->> 'custom_category', '')), '');

  if length(v_name) not between 2 and 160 or length(v_base_unit) not between 1 and 80 or length(v_description) < 10 then
    raise exception 'Complete the product name, unit, and description';
  end if;
  if v_unit_price is null or v_unit_price < 0 or (v_minimum is not null and v_minimum <= 0) or (v_stock is not null and v_stock < 0) then
    raise exception 'Invalid product price or quantity';
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
  if jsonb_typeof(coalesce(p_proposed_snapshot -> 'images', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposed_snapshot -> 'images', '[]'::jsonb)) not between 1 and 6 then
    raise exception 'One to six product images are required';
  end if;
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
      'unit_price', v_unit_price,
      'minimum_order', v_minimum,
      'stock_quantity', v_stock,
      'vat_inclusive', coalesce((v_core ->> 'vat_inclusive')::boolean, true),
      'rental_duration_value', case when v_offer_type = 'rental' then v_rental end,
      'rental_duration_unit', case when v_offer_type = 'rental' then nullif(btrim(v_core ->> 'rental_duration_unit'), '') end
    ),
    'images', p_proposed_snapshot -> 'images',
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
  v_changes := public.product_change_snapshot_diff(v_before, v_proposed);
  if jsonb_array_length(v_changes) = 0 then raise exception 'No product data was changed'; end if;

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

revoke execute on function public.submit_product_change_request(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.submit_product_change_request(uuid, jsonb, text, text)
  to authenticated;

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
  v_core jsonb;
  v_item jsonb;
  v_index integer;
  v_base_unit_id uuid;
  v_event_id uuid;
  v_owner uuid;
  v_provider_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_availability_summary text;
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
    v_core := v_request.proposed_snapshot -> 'core';
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
      unit_price = nullif(v_core ->> 'unit_price', '')::numeric,
      minimum_order = nullif(v_core ->> 'minimum_order', '')::numeric,
      stock_quantity = nullif(v_core ->> 'stock_quantity', '')::numeric,
      vat_inclusive = coalesce((v_core ->> 'vat_inclusive')::boolean, true),
      rental_duration_value = nullif(v_core ->> 'rental_duration_value', '')::numeric,
      rental_duration_unit = nullif(v_core ->> 'rental_duration_unit', ''),
      is_published = true,
      review_status = 'approved'
    where id = v_request.product_id;

    select id into v_base_unit_id from public.product_units
    where product_id = v_request.product_id and is_base limit 1;

    delete from public.product_measurements where product_id = v_request.product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'measurements') loop
      insert into public.product_measurements(product_id, unit_id, label, is_default, sort_order)
      values(v_request.product_id, v_base_unit_id, btrim(v_item ->> 'label'), v_index = 0, v_index);
      v_index := v_index + 1;
    end loop;

    delete from public.product_variants where product_id = v_request.product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'variants') loop
      insert into public.product_variants(product_id, sku, name, attributes, is_active, sort_order)
      values(
        v_request.product_id,
        coalesce(nullif(v_core ->> 'sku',''), 'VAR') || '-CHG-' || substr(v_request.id::text,1,8) || '-' || (v_index + 1),
        btrim(v_item ->> 'name'),
        coalesce(v_item -> 'attributes', '{}'::jsonb),
        coalesce((v_item ->> 'is_active')::boolean, true),
        v_index
      );
      v_index := v_index + 1;
    end loop;

    delete from public.product_specifications where product_id = v_request.product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'specifications') loop
      insert into public.product_specifications(product_id, value, sort_order)
      values(v_request.product_id, btrim(v_item ->> 'value'), v_index);
      v_index := v_index + 1;
    end loop;

    delete from public.product_warranties where product_id = v_request.product_id;
    v_item := v_request.proposed_snapshot -> 'warranty';
    if v_item is not null and jsonb_typeof(v_item) = 'object' then
      insert into public.product_warranties(
        product_id, label, duration, details, is_available,
        duration_value, duration_unit, no_warranty_accepted
      ) values(
        v_request.product_id,
        coalesce(nullif(v_item ->> 'label',''), 'ضمان المنتج'),
        coalesce(nullif(v_item ->> 'duration',''), 'حسب شروط المزود'),
        coalesce(nullif(v_item ->> 'details',''), 'حسب شروط وضمان المزود'),
        true,
        coalesce(nullif(v_item ->> 'duration_value','')::numeric, 1),
        coalesce(nullif(v_item ->> 'duration_unit',''), v_item ->> 'duration', 'مدة'),
        false
      );
    end if;

    delete from public.product_availability_regions where product_id = v_request.product_id;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'availability_regions') loop
      insert into public.product_availability_regions(product_id, city, scope)
      values(v_request.product_id, btrim(v_item ->> 'city'), coalesce(nullif(btrim(v_item ->> 'scope'),''), 'المدينة'));
    end loop;

    delete from public.product_delivery_regions where product_id = v_request.product_id;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'delivery_regions') loop
      insert into public.product_delivery_regions(product_id, region_name)
      values(v_request.product_id, btrim(v_item ->> 'region_name'));
    end loop;

    delete from public.product_delivery_configs where product_id = v_request.product_id;
    v_item := v_request.proposed_snapshot -> 'delivery_config';
    if v_item is not null and jsonb_typeof(v_item) = 'object' then
      insert into public.product_delivery_configs(
        product_id, is_available, maximum_duration, duration_unit,
        price_per_km, maximum_distance_km, notes
      ) values(
        v_request.product_id,
        coalesce((v_item ->> 'is_available')::boolean, false),
        nullif(v_item ->> 'maximum_duration','')::numeric,
        nullif(v_item ->> 'duration_unit',''),
        nullif(v_item ->> 'price_per_km','')::numeric,
        nullif(v_item ->> 'maximum_distance_km','')::numeric,
        nullif(v_item ->> 'notes','')
      );
    end if;

    delete from public.product_images where product_id = v_request.product_id;
    v_index := 0;
    for v_item in select value from jsonb_array_elements(v_request.proposed_snapshot -> 'images') loop
      insert into public.product_images(
        product_id, label, alt_text, tone, image_url, storage_path,
        file_name, mime_type, file_size_bytes, is_primary, sort_order
      ) values(
        v_request.product_id,
        coalesce(nullif(v_item ->> 'label',''), (v_core ->> 'name') || ' - صورة ' || (v_index + 1)),
        coalesce(nullif(v_item ->> 'alt_text',''), 'صورة المنتج ' || (v_core ->> 'name')),
        coalesce(nullif(v_item ->> 'tone',''), 'tools')::public.product_image_tone,
        nullif(v_item ->> 'image_url',''),
        nullif(v_item ->> 'storage_path',''),
        nullif(v_item ->> 'file_name',''),
        nullif(v_item ->> 'mime_type',''),
        nullif(v_item ->> 'file_size_bytes','')::bigint,
        v_index = 0,
        v_index
      );
      v_index := v_index + 1;
    end loop;
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

revoke execute on function public.review_product_change_request(uuid, text, text, text)
  from public, anon;
grant execute on function public.review_product_change_request(uuid, text, text, text)
  to authenticated;

commit;
