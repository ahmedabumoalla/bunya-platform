-- Keep immutable operational snapshots multilingual when a human-reviewed
-- catalog translation is approved after the original request was created.

create or replace function public.refresh_product_translation_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid := coalesce(new.product_id, old.product_id);
  v_names jsonb;
begin
  select coalesce(jsonb_object_agg(locale, name), '{}'::jsonb)
  into v_names
  from public.product_translations
  where product_id = v_product_id and reviewed_at is not null;

  update public.quote_request_items
  set product_name_translations = v_names
  where product_id = v_product_id;

  update public.bunya_customer_quote_items
  set product_name_translations = v_names
  where product_id = v_product_id;

  update public.order_items
  set product_name_translations = v_names
  where product_id = v_product_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.refresh_unit_translation_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit_id uuid := coalesce(new.unit_id, old.unit_id);
  v_product_id uuid;
  v_source_name text;
  v_names jsonb;
begin
  select product_id, name into v_product_id, v_source_name
  from public.product_units where id = v_unit_id;
  select coalesce(jsonb_object_agg(locale, name), '{}'::jsonb)
  into v_names
  from public.product_unit_translations
  where unit_id = v_unit_id and reviewed_at is not null;

  update public.quote_request_items
  set unit_name_translations = v_names
  where unit_id = v_unit_id;

  update public.bunya_customer_quote_items b
  set unit_name_translations = v_names
  from public.quote_request_items q
  where q.id = b.quote_request_item_id and q.unit_id = v_unit_id;

  update public.order_items
  set unit_name_translations = v_names
  where product_id = v_product_id and unit_name_snapshot = v_source_name;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.refresh_measurement_translation_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_measurement_id uuid := coalesce(new.measurement_id, old.measurement_id);
  v_product_id uuid;
  v_source_label text;
  v_labels jsonb;
begin
  select product_id, label into v_product_id, v_source_label
  from public.product_measurements where id = v_measurement_id;
  select coalesce(jsonb_object_agg(locale, label), '{}'::jsonb)
  into v_labels
  from public.product_measurement_translations
  where measurement_id = v_measurement_id and reviewed_at is not null;

  update public.quote_request_items
  set measurement_label_translations = v_labels
  where measurement_id = v_measurement_id;

  update public.bunya_customer_quote_items b
  set measurement_label_translations = v_labels
  from public.quote_request_items q
  where q.id = b.quote_request_item_id and q.measurement_id = v_measurement_id;

  update public.order_items
  set measurement_label_translations = v_labels
  where product_id = v_product_id and measurement_snapshot = v_source_label;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists product_translations_refresh_snapshots on public.product_translations;
create trigger product_translations_refresh_snapshots
after insert or update or delete on public.product_translations
for each row execute function public.refresh_product_translation_snapshots();

drop trigger if exists unit_translations_refresh_snapshots on public.product_unit_translations;
create trigger unit_translations_refresh_snapshots
after insert or update or delete on public.product_unit_translations
for each row execute function public.refresh_unit_translation_snapshots();

drop trigger if exists measurement_translations_refresh_snapshots on public.product_measurement_translations;
create trigger measurement_translations_refresh_snapshots
after insert or update or delete on public.product_measurement_translations
for each row execute function public.refresh_measurement_translation_snapshots();

-- Backfill translations approved between migrations 062 and 063.
update public.quote_request_items q
set product_name_translations = coalesce((select jsonb_object_agg(t.locale,t.name) from public.product_translations t where t.product_id=q.product_id and t.reviewed_at is not null), '{}'::jsonb),
    unit_name_translations = coalesce((select jsonb_object_agg(t.locale,t.name) from public.product_unit_translations t where t.unit_id=q.unit_id and t.reviewed_at is not null), '{}'::jsonb),
    measurement_label_translations = coalesce((select jsonb_object_agg(t.locale,t.label) from public.product_measurement_translations t where t.measurement_id=q.measurement_id and t.reviewed_at is not null), '{}'::jsonb);

update public.bunya_customer_quote_items b
set product_name_translations=q.product_name_translations,
    unit_name_translations=q.unit_name_translations,
    measurement_label_translations=q.measurement_label_translations
from public.quote_request_items q where q.id=b.quote_request_item_id;

update public.order_items o
set product_name_translations=coalesce((select jsonb_object_agg(t.locale,t.name) from public.product_translations t where t.product_id=o.product_id and t.reviewed_at is not null), '{}'::jsonb),
    unit_name_translations=coalesce((select jsonb_object_agg(t.locale,t.name) from public.product_units u join public.product_unit_translations t on t.unit_id=u.id where u.product_id=o.product_id and u.name=o.unit_name_snapshot and t.reviewed_at is not null), '{}'::jsonb),
    measurement_label_translations=coalesce((select jsonb_object_agg(t.locale,t.label) from public.product_measurements m join public.product_measurement_translations t on t.measurement_id=m.id where m.product_id=o.product_id and m.label=o.measurement_snapshot and t.reviewed_at is not null), '{}'::jsonb);
