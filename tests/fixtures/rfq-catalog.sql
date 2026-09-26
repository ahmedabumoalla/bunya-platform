create schema auth;
create schema extensions;
create role anon;
create role authenticated;
create role service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

create type public.quote_request_status as enum ('draft','submitted','sourcing','verifying');
create type public.quote_processing_stage as enum ('received','comparing_prices','verifying_availability');
create table public.customer_profiles(profile_id uuid primary key);
insert into public.customer_profiles values ('00000000-0000-4000-8000-000000000001');
create table public.product_brands(id uuid primary key, name text, is_active boolean default true);
create table public.products(
  id uuid primary key, name text not null, base_unit text not null,
  is_published boolean default true, review_status text default 'approved',
  availability_status text default 'available', minimum_order numeric(14,3),
  stock_quantity numeric(14,3), offer_type text default 'sale',
  rental_duration_value numeric(10,2), rental_duration_unit text,
  brand_id uuid references public.product_brands(id), unit_price numeric(14,2),
  vat_inclusive boolean default true, short_description text default 'Fixture description', description text default 'Fixture description'
);
create table public.product_specifications(id uuid primary key, product_id uuid references public.products(id), value text, sort_order integer default 0);
create table public.product_units(
  id uuid primary key, product_id uuid references public.products(id), name text not null,
  is_base boolean default false, sort_order integer default 0
);
create table public.product_measurements(
  id uuid primary key, product_id uuid references public.products(id),
  unit_id uuid references public.product_units(id), label text not null,
  is_default boolean default false, sort_order integer default 0
);
create table public.product_variants(
  id uuid primary key, product_id uuid references public.products(id), name text not null,
  attributes jsonb default '{}'::jsonb, is_active boolean default true, sort_order integer default 0
);
create table public.product_translations(product_id uuid, locale text, name text, reviewed_at timestamptz, short_description text, description text);
create table public.product_unit_translations(unit_id uuid, locale text, name text, reviewed_at timestamptz);
create table public.product_measurement_translations(measurement_id uuid, locale text, label text, reviewed_at timestamptz);
create table public.quote_requests(
  id uuid primary key default gen_random_uuid(), request_code text, requester_id uuid, requester_role text,
  city text, location_hint text, desired_receipt_at timestamptz, quote_window_label text,
  quote_deadline timestamptz, pricing_opens_at timestamptz, pricing_countdown_starts_at timestamptz,
  notes text, status public.quote_request_status, delivery_mode text,
  project_name text, recipient_name text, recipient_mobile text
);
create table public.quote_request_items(
  id uuid primary key default gen_random_uuid(), request_id uuid references public.quote_requests(id),
  product_id uuid not null references public.products(id) on delete restrict,
  measurement_id uuid references public.product_measurements(id) on delete restrict,
  unit_id uuid references public.product_units(id) on delete restrict, product_name_snapshot text not null,
  measurement_label_snapshot text, unit_name_snapshot text not null,
  quantity numeric(14,3) not null check(quantity > 0), notes text,
  product_name_translations jsonb default '{}'::jsonb,
  unit_name_translations jsonb default '{}'::jsonb,
  measurement_label_translations jsonb default '{}'::jsonb
);
create table public.internal_sourcing_requests(
  id uuid primary key default gen_random_uuid(), internal_code text,
  customer_request_id uuid references public.quote_requests(id), stage public.quote_processing_stage,
  expected_ready_at timestamptz, response_deadline_at timestamptz
);
create table public.internal_sourcing_request_items(
  id uuid primary key default gen_random_uuid(), sourcing_request_id uuid references public.internal_sourcing_requests(id),
  quote_request_item_id uuid references public.quote_request_items(id), product_id uuid references public.products(id),
  quantity numeric(14,3), unit_snapshot text, measurement_snapshot text, delivery_region text, required_at timestamptz
);
create table public.internal_sourcing_request_targets(
  sourcing_request_item_id uuid references public.internal_sourcing_request_items(id), provider_id uuid,
  response_deadline_at timestamptz, primary key(sourcing_request_item_id, provider_id)
);
create table public.outbox_events(
  id uuid primary key default gen_random_uuid(), aggregate_type text, aggregate_id uuid,
  event_type text, payload jsonb, idempotency_key text
);
create unique index outbox_events_idempotency_idx on public.outbox_events(idempotency_key) where idempotency_key is not null;
create table public.profiles(id uuid primary key, preferred_locale text);
insert into public.profiles values ('00000000-0000-4000-8000-000000000001','en');
create function public.get_provider_rfq_context_base(uuid) returns jsonb language sql stable as $$ select '{"fixture":"authorized provider base stub"}'::jsonb $$;
create function public.get_my_provider_rfq_list_base() returns jsonb language sql stable as $$ select coalesce(jsonb_agg(jsonb_build_object('sourcing_request_item_id',id)),'[]'::jsonb) from internal_sourcing_request_items $$;
create function public.rfq_pricing_window(timestamptz)
returns table(pricing_opens_at timestamptz, pricing_countdown_starts_at timestamptz, response_deadline_at timestamptz)
language sql stable as $$ select now(), now(), now() + interval '3 hours' $$;
create function public.match_rfq_providers(uuid,text,text) returns table(matched_provider_id uuid)
language sql stable as $$ select '00000000-0000-4000-8000-000000000099'::uuid $$;

insert into public.product_brands values ('10000000-0000-4000-8000-000000000001','Fixture brand',true);
insert into public.products(id,name,base_unit,minimum_order,brand_id) values
  ('20000000-0000-4000-8000-000000000001','Fixture product','piece',2,'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','Other product','metre',null,null),
  ('20000000-0000-4000-8000-000000000003','Unitless catalog product','piece',null,null);
insert into public.product_units(id,product_id,name,is_base,sort_order) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','piece',true,0),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','box',false,1),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','metre',true,0);
insert into public.product_measurements(id,product_id,unit_id,label,is_default,sort_order) values
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10 x 20',true,0),
  ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Pack of 12',false,1),
  ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','2 metres',true,0);
insert into public.product_variants(id,product_id,name,attributes,is_active,sort_order) values
  ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Red','{"color":"red"}',true,0),
  ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Blue','{"color":"blue"}',true,1),
  ('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Large','{"size":"large"}',true,2),
  ('50000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Inactive','{"color":"gray"}',false,3),
  ('50000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','Other variant','{"kind":"other"}',true,0);
insert into public.product_specifications values ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Manufacturer: Fixture brand',0);
insert into public.product_translations(product_id,locale,name,reviewed_at) values ('20000000-0000-4000-8000-000000000001','en','Translated product',now());
insert into public.product_unit_translations values ('30000000-0000-4000-8000-000000000001','en','Translated unit',now());
insert into public.product_measurement_translations values ('40000000-0000-4000-8000-000000000001','en','Translated measurement',now());
