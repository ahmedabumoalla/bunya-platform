-- Six-language foundation shared by the web platform and Flutter application.
-- Free-form customer/provider text is preserved verbatim; curated catalog and
-- operational reference text is selected by locale at presentation time.

alter table public.profiles
  add column if not exists preferred_locale text not null default 'ar'
  constraint profiles_preferred_locale_supported
  check (preferred_locale in ('ar', 'en', 'ur', 'hi', 'bn', 'fil'));

create table if not exists public.product_translations (
  product_id uuid not null references public.products(id) on delete cascade,
  locale text not null check (locale in ('en', 'ur', 'hi', 'bn', 'fil')),
  name text not null check (btrim(name) <> ''),
  short_description text not null default '',
  description text not null default '',
  full_description text not null default '',
  availability_summary text not null default '',
  lead_time_label text not null default '',
  delivery_label text not null default '',
  delivery_window text not null default '',
  delivery_notes text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (product_id, locale)
);

create table if not exists public.product_category_translations (
  category_id uuid not null references public.product_categories(id) on delete cascade,
  locale text not null check (locale in ('en', 'ur', 'hi', 'bn', 'fil')),
  name text not null check (btrim(name) <> ''),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (category_id, locale)
);

create table if not exists public.product_unit_translations (
  unit_id uuid not null references public.product_units(id) on delete cascade,
  locale text not null check (locale in ('en', 'ur', 'hi', 'bn', 'fil')),
  name text not null check (btrim(name) <> ''),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (unit_id, locale)
);

create table if not exists public.product_measurement_translations (
  measurement_id uuid not null references public.product_measurements(id) on delete cascade,
  locale text not null check (locale in ('en', 'ur', 'hi', 'bn', 'fil')),
  label text not null check (btrim(label) <> ''),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (measurement_id, locale)
);

alter table public.quote_request_items
  add column if not exists product_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists unit_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists measurement_label_translations jsonb not null default '{}'::jsonb;

alter table public.bunya_customer_quote_items
  add column if not exists product_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists unit_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists measurement_label_translations jsonb not null default '{}'::jsonb;

alter table public.order_items
  add column if not exists product_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists unit_name_translations jsonb not null default '{}'::jsonb,
  add column if not exists measurement_label_translations jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists title_key text,
  add column if not exists message_key text,
  add column if not exists message_params jsonb not null default '{}'::jsonb;

alter table public.customer_notifications
  add column if not exists title_key text,
  add column if not exists message_key text,
  add column if not exists message_params jsonb not null default '{}'::jsonb;

create or replace function public.snapshot_product_translations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null then return new; end if;

  select coalesce(jsonb_object_agg(t.locale, t.name), '{}'::jsonb)
    into new.product_name_translations
  from public.product_translations t
  where t.product_id = new.product_id and t.reviewed_at is not null;

  if to_jsonb(new) ? 'unit_id' and new.unit_id is not null then
    select coalesce(jsonb_object_agg(t.locale, t.name), '{}'::jsonb)
      into new.unit_name_translations
    from public.product_unit_translations t
    where t.unit_id = new.unit_id and t.reviewed_at is not null;
  end if;

  if to_jsonb(new) ? 'measurement_id' and new.measurement_id is not null then
    select coalesce(jsonb_object_agg(t.locale, t.label), '{}'::jsonb)
      into new.measurement_label_translations
    from public.product_measurement_translations t
    where t.measurement_id = new.measurement_id and t.reviewed_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists quote_request_items_snapshot_translations on public.quote_request_items;
create trigger quote_request_items_snapshot_translations
before insert or update of product_id, unit_id, measurement_id on public.quote_request_items
for each row execute function public.snapshot_product_translations();

create or replace function public.copy_quote_item_translations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select q.product_name_translations, q.unit_name_translations, q.measurement_label_translations
    into new.product_name_translations, new.unit_name_translations, new.measurement_label_translations
  from public.quote_request_items q
  where q.id = new.quote_request_item_id;
  return new;
end;
$$;

drop trigger if exists bunya_quote_items_snapshot_translations on public.bunya_customer_quote_items;
create trigger bunya_quote_items_snapshot_translations
before insert or update of quote_request_item_id on public.bunya_customer_quote_items
for each row execute function public.copy_quote_item_translations();

create or replace function public.snapshot_order_item_translations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null then return new; end if;
  select coalesce(jsonb_object_agg(t.locale, t.name), '{}'::jsonb)
    into new.product_name_translations
  from public.product_translations t
  where t.product_id = new.product_id and t.reviewed_at is not null;
  select coalesce(jsonb_object_agg(t.locale, t.name), '{}'::jsonb)
    into new.unit_name_translations
  from public.product_units u
  join public.product_unit_translations t on t.unit_id = u.id and t.reviewed_at is not null
  where u.product_id = new.product_id and u.name = new.unit_name_snapshot;
  select coalesce(jsonb_object_agg(t.locale, t.label), '{}'::jsonb)
    into new.measurement_label_translations
  from public.product_measurements m
  join public.product_measurement_translations t on t.measurement_id = m.id and t.reviewed_at is not null
  where m.product_id = new.product_id and m.label = new.measurement_snapshot;
  return new;
end;
$$;

drop trigger if exists order_items_snapshot_translations on public.order_items;
create trigger order_items_snapshot_translations
before insert or update of product_id, unit_name_snapshot, measurement_snapshot on public.order_items
for each row execute function public.snapshot_order_item_translations();

update public.quote_request_items q
set product_name_translations = coalesce((
      select jsonb_object_agg(t.locale, t.name) from public.product_translations t
      where t.product_id = q.product_id and t.reviewed_at is not null
    ), '{}'::jsonb),
    unit_name_translations = coalesce((
      select jsonb_object_agg(t.locale, t.name) from public.product_unit_translations t
      where t.unit_id = q.unit_id and t.reviewed_at is not null
    ), '{}'::jsonb),
    measurement_label_translations = coalesce((
      select jsonb_object_agg(t.locale, t.label) from public.product_measurement_translations t
      where t.measurement_id = q.measurement_id and t.reviewed_at is not null
    ), '{}'::jsonb);

update public.bunya_customer_quote_items b
set product_name_translations = q.product_name_translations,
    unit_name_translations = q.unit_name_translations,
    measurement_label_translations = q.measurement_label_translations
from public.quote_request_items q
where q.id = b.quote_request_item_id;

update public.order_items o
set product_name_translations = coalesce((
      select jsonb_object_agg(t.locale, t.name) from public.product_translations t
      where t.product_id = o.product_id and t.reviewed_at is not null
    ), '{}'::jsonb),
    unit_name_translations = coalesce((
      select jsonb_object_agg(t.locale, t.name)
      from public.product_units u join public.product_unit_translations t on t.unit_id = u.id
      where u.product_id = o.product_id and u.name = o.unit_name_snapshot and t.reviewed_at is not null
    ), '{}'::jsonb),
    measurement_label_translations = coalesce((
      select jsonb_object_agg(t.locale, t.label)
      from public.product_measurements m join public.product_measurement_translations t on t.measurement_id = m.id
      where m.product_id = o.product_id and m.label = o.measurement_snapshot and t.reviewed_at is not null
    ), '{}'::jsonb);

create or replace function public.localize_snapshot(
  source_text text,
  translations jsonb,
  requested_locale text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when requested_locale in ('en', 'ur', 'hi', 'bn', 'fil')
      then coalesce(nullif(btrim(translations ->> requested_locale), ''), source_text)
    else source_text
  end;
$$;

alter table public.product_translations enable row level security;
alter table public.product_category_translations enable row level security;
alter table public.product_unit_translations enable row level security;
alter table public.product_measurement_translations enable row level security;

create policy product_translations_public_read on public.product_translations
for select to anon, authenticated using (
  exists (select 1 from public.products p where p.id = product_id and p.is_published)
  or public.is_admin()
  or exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id))
);
create policy product_translations_owner_write on public.product_translations
for all to authenticated using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id))
) with check (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id))
);

create policy category_translations_public_read on public.product_category_translations
for select to anon, authenticated using (true);
create policy category_translations_admin_write on public.product_category_translations
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy unit_translations_public_read on public.product_unit_translations
for select to anon, authenticated using (true);
create policy unit_translations_owner_write on public.product_unit_translations
for all to authenticated using (
  public.is_admin() or exists (
    select 1 from public.product_units u join public.products p on p.id = u.product_id
    where u.id = unit_id and public.is_provider_member(p.provider_id)
  )
) with check (
  public.is_admin() or exists (
    select 1 from public.product_units u join public.products p on p.id = u.product_id
    where u.id = unit_id and public.is_provider_member(p.provider_id)
  )
);

create policy measurement_translations_public_read on public.product_measurement_translations
for select to anon, authenticated using (true);
create policy measurement_translations_owner_write on public.product_measurement_translations
for all to authenticated using (
  public.is_admin() or exists (
    select 1 from public.product_measurements m join public.products p on p.id = m.product_id
    where m.id = measurement_id and public.is_provider_member(p.provider_id)
  )
) with check (
  public.is_admin() or exists (
    select 1 from public.product_measurements m join public.products p on p.id = m.product_id
    where m.id = measurement_id and public.is_provider_member(p.provider_id)
  )
);

grant select on public.product_translations, public.product_category_translations,
  public.product_unit_translations, public.product_measurement_translations to anon, authenticated;
grant insert, update, delete on public.product_translations, public.product_category_translations,
  public.product_unit_translations, public.product_measurement_translations to authenticated;
grant execute on function public.localize_snapshot(text, jsonb, text) to anon, authenticated;

drop function if exists public.get_my_driver_deliveries();
create function public.get_my_driver_deliveries()
returns table (
  delivery_id uuid,
  order_id uuid,
  order_code text,
  fulfillment_code text,
  delivery_status public.provider_delivery_status,
  expected_at timestamptz,
  delivered_at timestamptz,
  google_maps_url text,
  location_hint text,
  recipient_name text,
  recipient_mobile text,
  site_responsible_name text,
  site_responsible_mobile text,
  working_hours text,
  loading_option text,
  unloading_option text,
  road_access text,
  access_instructions text,
  can_confirm boolean,
  items jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select a.id,o.id,o.order_code,f.fulfillment_code,a.status,a.expected_at,a.delivered_at,
         r.google_maps_url,r.location_hint,r.recipient_name,r.recipient_mobile,
         r.site_responsible_name,r.site_responsible_mobile,r.working_hours,
         r.loading_option,r.unloading_option,r.road_access,r.access_instructions,
         (a.status='arrived' and c.verified_at is null and c.expires_at>now()
          and c.attempts<c.max_attempts and coalesce(c.locked_until,'-infinity'::timestamptz)<=now()),
         coalesce(lines.items, '[]'::jsonb)
  from public.provider_delivery_assignments a
  join public.orders o on o.id=a.order_id
  join public.internal_fulfillment_orders f on f.id=a.fulfillment_order_id
  join public.bunya_customer_quotes q on q.id=o.customer_quote_id
  join public.quote_requests r on r.id=q.customer_request_id
  left join public.delivery_confirmation_codes c on c.assignment_id=a.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'product_name', public.localize_snapshot(i.product_name_snapshot, i.product_name_translations, p.preferred_locale),
      'quantity', i.quantity,
      'unit_name', public.localize_snapshot(i.unit_name_snapshot, i.unit_name_translations, p.preferred_locale),
      'measurement', public.localize_snapshot(i.measurement_snapshot, i.measurement_label_translations, p.preferred_locale)
    ) order by i.id) as items
    from public.order_items i
    join public.profiles p on p.id=auth.uid()
    where i.order_id=o.id
  ) lines on true
  where a.assigned_driver_id=public.current_provider_driver_id()
    and exists(
      select 1 from public.provider_drivers d
      where d.id=a.assigned_driver_id and d.status='active'
    )
  order by case when a.status in ('delivered','failed_delivery') then 1 else 0 end,a.expected_at;
$$;

revoke execute on function public.get_my_driver_deliveries() from public,anon;
grant execute on function public.get_my_driver_deliveries() to authenticated;

comment on column public.profiles.preferred_locale is
  'Shared UI/content locale for web and Flutter: ar, en, ur, hi, bn, fil.';
comment on table public.product_translations is
  'Human-reviewed catalog translations. Unreviewed rows never enter immutable order snapshots.';
