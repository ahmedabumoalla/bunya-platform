-- Bunya platform production schema baseline.
-- This is the single foundational migration (001); the application is not connected yet.
-- Passwords and password-reset secrets MUST remain in Supabase Auth and never in public tables.

begin;

create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('customer', 'contractor', 'merchant', 'driver', 'admin');
create type public.application_status as enum ('pending', 'approved', 'rejected', 'needs_changes');
create type public.provider_account_status as enum ('pending', 'approved', 'suspended');
create type public.product_availability_status as enum ('available', 'limited', 'on_request', 'unavailable');
create type public.product_image_tone as enum ('cement', 'steel', 'blocks', 'insulation', 'plumbing', 'electric', 'wood', 'paint', 'tools');
create type public.quote_requester_role as enum ('customer', 'contractor');
create type public.quote_request_status as enum (
  'draft',
  'new',
  'viewed',
  'quoted',
  'expired',
  'unavailable',
  'submitted',
  'sourcing',
  'verifying',
  'quote_ready',
  'customer_review',
  'accepted',
  'rejected',
  'collecting_quotes',
  'final_offer_ready',
  'paid',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled'
);
create type public.merchant_quote_status as enum ('draft', 'sent', 'qualified', 'selected', 'rejected');
create type public.final_offer_status as enum ('ready', 'accepted', 'paid');
create type public.delivery_status as enum ('assigned', 'arrived', 'picked_up', 'out_for_delivery', 'delivered');
create type public.subscription_status as enum ('pending', 'active', 'past_due', 'cancelled', 'expired');
create type public.product_review_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'needs_changes', 'inactive');
create type public.product_offer_type as enum ('sale', 'rental');
create type public.provider_quote_status as enum ('draft', 'pending_customer', 'approved', 'rejected', 'expired', 'modified');
create type public.provider_order_status as enum ('confirmed', 'preparing', 'ready_for_pickup', 'assigned_driver', 'out_for_delivery', 'delivered', 'completed', 'cancelled');
create type public.financial_transaction_type as enum ('order_amount', 'commission', 'tax', 'discount', 'settlement', 'refund');
create type public.financial_transaction_status as enum ('pending', 'available', 'settled', 'reversed');
create type public.settlement_request_status as enum ('pending_review', 'approved', 'transferring', 'rejected', 'transferred');
create type public.support_ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.support_ticket_priority as enum ('low', 'normal', 'high');
create type public.invoice_status as enum ('unpaid', 'paid', 'refunded', 'cancelled');
create type public.payment_record_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'cancelled');
create type public.price_freshness_status as enum ('valid', 'expiring_soon', 'expired', 'needs_confirmation');
create type public.quote_processing_stage as enum ('received', 'comparing_prices', 'verifying_availability', 'verifying_delivery', 'building_quote', 'sent_to_customer');
create type public.provider_pricing_response_status as enum ('evaluating', 'selected', 'not_selected', 'expired', 'needs_update', 'rejected');
create type public.bunya_customer_quote_status as enum ('preparing', 'ready', 'customer_review', 'accepted', 'rejected', 'expired');
create type public.internal_fulfillment_status as enum ('assigned', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled');
create type public.contractor_availability_status as enum ('available', 'busy', 'temporarily_unavailable');
create type public.contractor_service_status as enum ('active', 'hidden', 'pending_review');
create type public.contractor_pricing_method as enum ('meter', 'project', 'hour', 'day', 'starting_from', 'inspection');
create type public.contractor_opportunity_status as enum ('new', 'viewed', 'proposed', 'expired');
create type public.contractor_proposal_status as enum ('draft', 'under_review', 'needs_changes', 'accepted', 'rejected', 'expired', 'withdrawn');
create type public.contractor_project_status as enum ('awaiting_start', 'active', 'paused', 'delayed', 'awaiting_milestone_approval', 'completed', 'cancelled');
create type public.contractor_milestone_status as enum ('not_started', 'in_progress', 'awaiting_customer_approval', 'approved', 'delayed');
create type public.contractor_document_status as enum ('not_uploaded', 'pending_review', 'approved', 'rejected', 'expired', 'expiring_soon');
create type public.contractor_financial_type as enum ('advance', 'milestone_payment', 'final_payment', 'commission', 'tax', 'discount', 'refund', 'settlement');
create type public.contractor_financial_status as enum ('pending', 'available', 'completed');
create type public.contractor_settlement_status as enum ('pending_review', 'approved', 'transferring', 'transferred', 'rejected');
create type public.contractor_notification_type as enum ('opportunity', 'deadline', 'proposal', 'project', 'milestone', 'payment', 'review', 'document', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  username text,
  full_name text,
  mobile text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[^[:space:]]{4,40}$'),
  constraint profiles_mobile_not_blank check (mobile is null or btrim(mobile) <> ''),
  constraint profiles_email_not_blank check (email is null or btrim(email) <> '')
);

create unique index profiles_username_unique_idx on public.profiles (lower(username)) where username is not null;
create unique index profiles_mobile_unique_idx on public.profiles (mobile) where mobile is not null;
create unique index profiles_email_unique_idx on public.profiles (lower(email)) where email is not null;
create index profiles_role_idx on public.profiles (role);

create table public.customer_profiles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_not_blank check (btrim(name) <> ''),
  constraint product_categories_slug_format check (slug ~ '^[a-z0-9-]+$')
);

create unique index product_categories_name_unique_idx on public.product_categories (lower(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  external_key text unique,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  name text not null,
  base_unit text not null,
  short_description text not null,
  description text not null,
  full_description text not null,
  availability_summary text not null,
  availability_status public.product_availability_status not null default 'available',
  lead_time_label text not null,
  delivery_label text not null,
  delivery_window text not null,
  delivery_notes text not null,
  is_new boolean not null default false,
  is_published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_base_unit_not_blank check (btrim(base_unit) <> '')
);

create index products_category_published_idx on public.products (category_id, is_published);
create index products_name_search_idx on public.products using gin (to_tsvector('simple', name || ' ' || description));

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  external_key text,
  label text not null,
  alt_text text not null,
  tone public.product_image_tone not null,
  image_url text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (product_id, external_key),
  constraint product_images_label_not_blank check (btrim(label) <> ''),
  constraint product_images_alt_not_blank check (btrim(alt_text) <> '')
);

create index product_images_product_sort_idx on public.product_images (product_id, sort_order);

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint product_units_name_not_blank check (btrim(name) <> '')
);

create unique index product_units_product_name_unique_idx on public.product_units (product_id, lower(name));

create table public.product_measurements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  unit_id uuid not null references public.product_units (id) on delete restrict,
  external_key text,
  label text not null,
  is_default boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (product_id, external_key),
  constraint product_measurements_label_not_blank check (btrim(label) <> '')
);

create unique index product_measurements_one_default_idx on public.product_measurements (product_id) where is_default;
create index product_measurements_product_sort_idx on public.product_measurements (product_id, sort_order);

create table public.product_specifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint product_specifications_value_not_blank check (btrim(value) <> '')
);

create unique index product_specifications_unique_idx on public.product_specifications (product_id, lower(value));

create table public.product_warranties (
  product_id uuid primary key references public.products (id) on delete cascade,
  label text not null,
  duration text not null,
  details text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_availability_regions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  city text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  constraint product_availability_regions_city_not_blank check (btrim(city) <> ''),
  constraint product_availability_regions_scope_not_blank check (btrim(scope) <> '')
);

create unique index product_availability_regions_unique_idx on public.product_availability_regions (product_id, lower(city), lower(scope));
create index product_availability_regions_city_idx on public.product_availability_regions (lower(city));

create table public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid references public.profiles (id) on delete set null,
  company_name text not null,
  contact_name text not null,
  mobile text not null,
  email text not null,
  requested_username text not null,
  google_maps_url text not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  discount_code text,
  delivery_available boolean not null default false,
  status public.application_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_applications_company_not_blank check (btrim(company_name) <> ''),
  constraint provider_applications_contact_not_blank check (btrim(contact_name) <> ''),
  constraint provider_applications_mobile_not_blank check (btrim(mobile) <> ''),
  constraint provider_applications_email_not_blank check (btrim(email) <> ''),
  constraint provider_applications_username_not_blank check (btrim(requested_username) <> ''),
  constraint provider_applications_maps_not_blank check (btrim(google_maps_url) <> ''),
  constraint provider_applications_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint provider_applications_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint provider_applications_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint provider_applications_review_consistency check (
    (reviewed_at is null and reviewed_by is null)
    or (reviewed_at is not null and reviewed_by is not null)
  )
);

create unique index provider_applications_pending_email_idx on public.provider_applications (lower(email)) where status in ('pending', 'needs_changes');
create unique index provider_applications_pending_mobile_idx on public.provider_applications (mobile) where status in ('pending', 'needs_changes');
create unique index provider_applications_pending_username_idx on public.provider_applications (lower(requested_username)) where status in ('pending', 'needs_changes');
create index provider_applications_status_created_idx on public.provider_applications (status, created_at desc);

create table public.provider_application_categories (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.provider_applications (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete restrict,
  custom_category text,
  created_at timestamptz not null default now(),
  constraint provider_application_categories_source check (
    (category_id is not null and custom_category is null)
    or (category_id is null and custom_category is not null and btrim(custom_category) <> '')
  )
);

create unique index provider_application_categories_standard_unique_idx on public.provider_application_categories (application_id, category_id) where category_id is not null;
create unique index provider_application_categories_custom_unique_idx on public.provider_application_categories (application_id, lower(custom_category)) where custom_category is not null;

create table public.provider_delivery_regions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.provider_applications (id) on delete cascade,
  region_name text not null,
  created_at timestamptz not null default now(),
  constraint provider_delivery_regions_name_not_blank check (btrim(region_name) <> '')
);

create unique index provider_delivery_regions_unique_idx on public.provider_delivery_regions (application_id, lower(region_name));

create table public.contractor_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_profile_id uuid references public.profiles (id) on delete set null,
  contractor_name text not null,
  mobile text not null,
  email text not null,
  status public.application_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_applications_name_not_blank check (btrim(contractor_name) <> ''),
  constraint contractor_applications_mobile_not_blank check (btrim(mobile) <> ''),
  constraint contractor_applications_email_not_blank check (btrim(email) <> ''),
  constraint contractor_applications_review_consistency check (
    (reviewed_at is null and reviewed_by is null)
    or (reviewed_at is not null and reviewed_by is not null)
  )
);

create unique index contractor_applications_pending_email_idx on public.contractor_applications (lower(email)) where status in ('pending', 'needs_changes');
create unique index contractor_applications_pending_mobile_idx on public.contractor_applications (mobile) where status in ('pending', 'needs_changes');
create index contractor_applications_status_created_idx on public.contractor_applications (status, created_at desc);

create table public.contractor_work_regions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.contractor_applications (id) on delete cascade,
  region_name text not null,
  created_at timestamptz not null default now(),
  constraint contractor_work_regions_name_not_blank check (btrim(region_name) <> '')
);

create unique index contractor_work_regions_unique_idx on public.contractor_work_regions (application_id, lower(region_name));

create table public.contractor_specialties (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.contractor_applications (id) on delete cascade,
  specialty_name text not null,
  created_at timestamptz not null default now(),
  constraint contractor_specialties_name_not_blank check (btrim(specialty_name) <> '')
);

create unique index contractor_specialties_unique_idx on public.contractor_specialties (application_id, lower(specialty_name));

create table public.contractor_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.contractor_applications (id) on delete cascade,
  contractor_profile_id uuid,
  document_type text,
  document_number text,
  issued_at date,
  expires_at date,
  status public.contractor_document_status not null default 'pending_review',
  rejection_reason text,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now(),
  constraint contractor_documents_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint contractor_documents_file_name_not_blank check (btrim(file_name) <> ''),
  constraint contractor_documents_allowed_type check (mime_type = 'application/pdf' or mime_type like 'image/%'),
  unique (application_id, storage_path),
  constraint contractor_documents_owner_source check (application_id is not null or contractor_profile_id is not null)
);

create index contractor_documents_application_idx on public.contractor_documents (application_id);

create table public.contractor_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  application_id uuid unique references public.contractor_applications (id) on delete set null,
  display_name text not null,
  commercial_name text not null,
  city text not null,
  badge text not null,
  years_experience smallint not null check (years_experience >= 0 and years_experience <= 100),
  summary text not null,
  phone text not null,
  email text not null,
  subscription_active boolean not null default false,
  approval_status public.application_status not null default 'pending',
  availability public.contractor_availability_status not null default 'available',
  google_maps_url text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  logo_path text,
  average_rating numeric(2,1) not null default 0 check (average_rating between 0 and 5),
  projects_count integer not null default 0 check (projects_count >= 0),
  directory_visible boolean not null default false,
  professional_links text[] not null default '{}',
  sensitive_changes_pending_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_profiles_approved_source check (approval_status <> 'approved' or application_id is not null),
  constraint contractor_profiles_coordinates_pair check ((latitude is null) = (longitude is null))
);

create index contractor_profiles_public_directory_idx on public.contractor_profiles (approval_status, subscription_active, city);

create table public.contractor_profile_specialties (
  profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  specialty_name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (profile_id, specialty_name)
);

create table public.contractor_profile_regions (
  profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  region_name text not null,
  primary key (profile_id, region_name)
);

create table public.contractor_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  title text not null,
  project_type text,
  city text,
  execution_year smallint check (execution_year between 1900 and 2200),
  description text,
  specialties text[] not null default '{}',
  execution_duration text,
  approximate_value numeric(14,2) check (approximate_value is null or approximate_value >= 0),
  is_visible boolean not null default false,
  is_approved boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint contractor_portfolio_items_title_not_blank check (btrim(title) <> '')
);

alter table public.contractor_documents add constraint contractor_documents_profile_fk foreign key (contractor_profile_id) references public.contractor_profiles (id) on delete cascade;

create table public.contractor_services (
  id uuid primary key default gen_random_uuid(),
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  name text not null,
  primary_specialty text not null,
  secondary_specialties text[] not null default '{}',
  description text not null,
  pricing_method public.contractor_pricing_method not null,
  minimum_price numeric(14,2) check (minimum_price is null or minimum_price >= 0),
  maximum_price numeric(14,2) check (maximum_price is null or maximum_price >= minimum_price),
  estimated_duration text not null,
  status public.contractor_service_status not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_services_name_not_blank check (btrim(name) <> ''),
  constraint contractor_services_inspection_no_fixed_price check (pricing_method <> 'inspection' or (minimum_price is null and maximum_price is null))
);
create index contractor_services_profile_status_idx on public.contractor_services (contractor_profile_id, status);

create table public.contractor_service_regions (
  service_id uuid not null references public.contractor_services (id) on delete cascade,
  region_name text not null,
  primary key (service_id, region_name)
);
create index contractor_service_regions_region_idx on public.contractor_service_regions (lower(region_name));

create table public.contractor_availability (
  contractor_profile_id uuid primary key references public.contractor_profiles (id) on delete cascade,
  status public.contractor_availability_status not null default 'available',
  available_from date,
  note text,
  updated_at timestamptz not null default now()
);

create table public.project_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  project_type text not null,
  description text not null,
  scope text not null,
  city text not null,
  region text not null,
  quantity_label text,
  estimated_budget_min numeric(14,2) not null check (estimated_budget_min >= 0),
  estimated_budget_max numeric(14,2) not null check (estimated_budget_max >= estimated_budget_min),
  expected_start_at date not null,
  estimated_duration text not null,
  proposal_deadline_at timestamptz not null,
  minimum_rating numeric(2,1) check (minimum_rating is null or minimum_rating between 0 and 5),
  google_maps_url text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  customer_label text not null,
  terms text[] not null default '{}',
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_requests_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint project_requests_deadline_valid check (proposal_deadline_at > created_at)
);
create index project_requests_customer_created_idx on public.project_requests (customer_profile_id, created_at desc);
create index project_requests_region_deadline_idx on public.project_requests (lower(region), proposal_deadline_at) where is_open;

create table public.project_request_specialties (
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  specialty_name text not null,
  primary key (project_request_id, specialty_name)
);
create index project_request_specialties_name_idx on public.project_request_specialties (lower(specialty_name));

create table public.contractor_opportunities (
  id uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  status public.contractor_opportunity_status not null default 'new',
  viewed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_request_id, contractor_profile_id)
);
create index contractor_opportunities_profile_status_deadline_idx on public.contractor_opportunities (contractor_profile_id, status, expires_at);

create table public.contractor_opportunity_matches (
  opportunity_id uuid primary key references public.contractor_opportunities (id) on delete cascade,
  specialty_matched boolean not null,
  region_matched boolean not null,
  account_approved boolean not null,
  availability_matched boolean not null,
  rating_matched boolean not null,
  eligible boolean not null,
  reasons text[] not null default '{}',
  evaluated_at timestamptz not null default now()
);
create index contractor_opportunity_matches_eligible_idx on public.contractor_opportunity_matches (eligible, evaluated_at desc);

create table public.contractor_proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_code text not null unique,
  opportunity_id uuid not null references public.contractor_opportunities (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  vat_inclusive boolean not null default false,
  execution_duration text,
  proposed_start_at date,
  scope_details text,
  includes text[] not null default '{}',
  excludes text[] not null default '{}',
  valid_until timestamptz,
  warranty text,
  team text,
  notes text,
  policy_accepted boolean not null default false,
  status public.contractor_proposal_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  change_request text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, contractor_profile_id),
  constraint contractor_proposals_submission_complete check (status = 'draft' or (amount > 0 and policy_accepted and submitted_at is not null and valid_until > submitted_at))
);
create index contractor_proposals_profile_status_idx on public.contractor_proposals (contractor_profile_id, status, updated_at desc);

create table public.contractor_proposal_stages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.contractor_proposals (id) on delete cascade,
  name text not null,
  description text not null,
  duration text not null,
  value_percentage numeric(5,2) not null check (value_percentage > 0 and value_percentage <= 100),
  expected_at date not null,
  sort_order integer not null default 0 check (sort_order >= 0)
);
create index contractor_proposal_stages_proposal_sort_idx on public.contractor_proposal_stages (proposal_id, sort_order);

create table public.contractor_proposal_documents (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.contractor_proposals (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  unique (proposal_id, storage_path)
);

create table public.contractor_projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique,
  accepted_proposal_id uuid not null unique references public.contractor_proposals (id) on delete restrict,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete restrict,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  customer_label text not null,
  project_value numeric(14,2) not null check (project_value >= 0),
  start_at date not null,
  expected_end_at date not null,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  status public.contractor_project_status not null default 'awaiting_start',
  payment_status text not null default 'pending',
  next_payment_label text,
  scope text not null,
  google_maps_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_projects_dates_valid check (expected_end_at >= start_at)
);
create index contractor_projects_contractor_status_idx on public.contractor_projects (contractor_profile_id, status, updated_at desc);
create index contractor_projects_customer_status_idx on public.contractor_projects (customer_profile_id, status, updated_at desc);

create table public.contractor_project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.contractor_projects (id) on delete cascade,
  name text not null,
  description text not null,
  start_at date not null,
  expected_end_at date not null,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  value_percentage numeric(5,2) not null check (value_percentage > 0 and value_percentage <= 100),
  status public.contractor_milestone_status not null default 'not_started',
  submitted_for_approval_at timestamptz,
  approved_at timestamptz,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint contractor_milestones_dates_valid check (expected_end_at >= start_at),
  constraint contractor_milestones_approval_consistency check (status <> 'approved' or approved_at is not null)
);
create index contractor_project_milestones_project_sort_idx on public.contractor_project_milestones (project_id, sort_order);

create table public.contractor_project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.contractor_projects (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  update_type text not null check (update_type in ('daily_report','weekly_report','note','evidence','issue')),
  title text not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index contractor_project_updates_project_time_idx on public.contractor_project_updates (project_id, created_at desc);

create table public.contractor_project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.contractor_projects (id) on delete cascade,
  milestone_id uuid references public.contractor_project_milestones (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  document_type text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  unique (project_id, storage_path)
);

create table public.contractor_portfolio_media (
  id uuid primary key default gen_random_uuid(),
  portfolio_item_id uuid not null references public.contractor_portfolio_items (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (portfolio_item_id, storage_path)
);
create unique index contractor_portfolio_media_one_primary_idx on public.contractor_portfolio_media (portfolio_item_id) where is_primary;

create table public.contractor_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.contractor_projects (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  commitment smallint not null check (commitment between 1 and 5),
  quality smallint not null check (quality between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  timeliness smallint not null check (timeliness between 1 and 5),
  comment text not null,
  admin_review_requested_at timestamptz,
  created_at timestamptz not null default now()
);
create index contractor_reviews_profile_time_idx on public.contractor_reviews (contractor_profile_id, created_at desc);

create table public.contractor_review_replies (
  review_id uuid primary key references public.contractor_reviews (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  reply text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractor_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  iban_encrypted text not null,
  iban_last4 text not null check (iban_last4 ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contractor_bank_accounts_one_default_idx on public.contractor_bank_accounts (contractor_profile_id) where is_default;

create table public.contractor_financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_code text not null unique,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  project_id uuid not null references public.contractor_projects (id) on delete restrict,
  milestone_id uuid references public.contractor_project_milestones (id) on delete set null,
  transaction_type public.contractor_financial_type not null,
  amount numeric(14,2) not null,
  status public.contractor_financial_status not null default 'pending',
  balance_after numeric(14,2) not null,
  occurred_at timestamptz not null default now()
);
create index contractor_financial_profile_status_time_idx on public.contractor_financial_transactions (contractor_profile_id, status, occurred_at desc);

create table public.contractor_settlement_requests (
  id uuid primary key default gen_random_uuid(),
  settlement_code text not null unique,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  bank_account_id uuid not null references public.contractor_bank_accounts (id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  status public.contractor_settlement_status not null default 'pending_review',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contractor_settlements_profile_status_idx on public.contractor_settlement_requests (contractor_profile_id, status, created_at desc);

create table public.contractor_notifications (
  id uuid primary key default gen_random_uuid(),
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  notification_type public.contractor_notification_type not null,
  title text not null,
  message text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index contractor_notifications_profile_unread_idx on public.contractor_notifications (contractor_profile_id, created_at desc) where read_at is null;

create table public.contractor_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  subject text not null,
  category text not null,
  priority public.support_ticket_priority not null default 'normal',
  reference_code text,
  message text not null,
  status public.support_ticket_status not null default 'open',
  assigned_to uuid references public.profiles (id) on delete set null,
  admin_response text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contractor_support_tickets_profile_status_idx on public.contractor_support_tickets (contractor_profile_id, status, created_at desc);

create table public.contractor_support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.contractor_support_tickets (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  unique (ticket_id, storage_path)
);

create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  requester_id uuid not null references public.profiles (id) on delete restrict,
  requester_role public.quote_requester_role not null,
  city text not null,
  location_hint text not null,
  google_maps_url text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  desired_receipt_at timestamptz not null,
  quote_window_label text not null,
  quote_deadline timestamptz not null,
  payment_status text not null default 'pending',
  delivery_promise text,
  handshake_code_hash text,
  notes text,
  status public.quote_request_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_requests_city_not_blank check (btrim(city) <> ''),
  constraint quote_requests_location_not_blank check (btrim(location_hint) <> ''),
  constraint quote_requests_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint quote_requests_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint quote_requests_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint quote_requests_deadline_after_creation check (quote_deadline > created_at),
  constraint quote_requests_handshake_not_plain check (handshake_code_hash is null or length(handshake_code_hash) >= 32)
);

create index quote_requests_requester_created_idx on public.quote_requests (requester_id, created_at desc);
create index quote_requests_status_deadline_idx on public.quote_requests (status, quote_deadline);
create index quote_requests_city_idx on public.quote_requests (lower(city));

create table public.quote_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  measurement_id uuid references public.product_measurements (id) on delete restrict,
  unit_id uuid references public.product_units (id) on delete restrict,
  product_name_snapshot text not null,
  measurement_label_snapshot text,
  unit_name_snapshot text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index quote_request_items_request_idx on public.quote_request_items (request_id);
create index quote_request_items_product_idx on public.quote_request_items (product_id);

create table public.merchant_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id) on delete cascade,
  merchant_profile_id uuid not null references public.profiles (id) on delete restrict,
  price numeric(14, 2) not null check (price >= 0),
  delivery_duration text not null,
  notes text,
  eligible boolean not null default false,
  status public.merchant_quote_status not null default 'draft',
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, merchant_profile_id)
);

create index merchant_quotes_request_status_price_idx on public.merchant_quotes (request_id, status, price);
create index merchant_quotes_merchant_created_idx on public.merchant_quotes (merchant_profile_id, created_at desc);

create table public.final_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.quote_requests (id) on delete cascade,
  selected_merchant_quote_id uuid not null unique references public.merchant_quotes (id) on delete restrict,
  platform_name text not null default 'بُنية',
  total_price numeric(14, 2) not null check (total_price >= 0),
  delivery_duration text not null,
  payment_status text not null default 'pending',
  offer_status public.final_offer_status not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id) on delete cascade,
  title text not null,
  description text not null,
  status public.quote_request_status not null,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index order_events_request_time_idx on public.order_events (request_id, occurred_at);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.quote_requests (id) on delete cascade,
  driver_profile_id uuid references public.profiles (id) on delete set null,
  destination text not null,
  map_label text,
  estimated_arrival_at timestamptz,
  status public.delivery_status not null default 'assigned',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliveries_delivered_consistency check ((status = 'delivered') = (delivered_at is not null))
);

create index deliveries_driver_status_idx on public.deliveries (driver_profile_id, status);

create table public.subscription_plans (
  id text primary key,
  role public.user_role not null check (role in ('merchant', 'contractor')),
  name text not null,
  price_monthly numeric(10, 2) not null check (price_monthly >= 0),
  description text not null,
  benefits text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null references public.subscription_plans (id) on delete restrict,
  status public.subscription_status not null default 'pending',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_valid check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create unique index subscriptions_one_active_plan_idx on public.subscriptions (profile_id, plan_id) where status in ('pending', 'active', 'past_due');
create index subscriptions_profile_status_idx on public.subscriptions (profile_id, status);

-- Provider workspace domain. The application remains local-only; these tables define
-- the future production ownership model without storing passwords or Auth secrets.
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null unique references public.profiles (id) on delete restrict,
  application_id uuid unique references public.provider_applications (id) on delete set null,
  company_name text not null,
  contact_name text not null,
  mobile text not null,
  email text not null,
  google_maps_url text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  logo_path text,
  status public.provider_account_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint providers_company_not_blank check (btrim(company_name) <> ''),
  constraint providers_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint providers_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint providers_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint providers_review_consistency check ((status = 'pending' and reviewed_at is null) or status <> 'pending')
);
create index providers_status_idx on public.providers (status, created_at desc);

create table public.provider_profiles (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  public_description text,
  username text,
  delivery_available boolean not null default false,
  sensitive_changes_pending_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_profiles_username_format check (username is null or username ~ '^[^[:space:]]{4,40}$')
);
create unique index provider_profiles_username_unique_idx on public.provider_profiles (lower(username)) where username is not null;

create table public.provider_members (
  provider_id uuid not null references public.providers (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (provider_id, profile_id),
  constraint provider_members_role_allowed check (member_role in ('owner', 'manager', 'catalog', 'quotes', 'finance', 'driver_coordinator', 'staff'))
);
create unique index provider_members_one_owner_idx on public.provider_members (provider_id) where member_role = 'owner' and is_active;

create table public.provider_settings (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  vat_rate numeric(5,4) not null default 0.15 check (vat_rate between 0 and 1),
  currency_code text not null default 'SAR' check (currency_code ~ '^[A-Z]{3}$'),
  default_quote_validity_days integer not null default 7 check (default_quote_validity_days between 1 and 90),
  settlement_review_days integer not null default 7 check (settlement_review_days between 1 and 60),
  delivery_available boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.products
  add column provider_id uuid references public.providers (id) on delete cascade,
  add column review_status public.product_review_status not null default 'draft',
  add column offer_type public.product_offer_type not null default 'sale',
  add column unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  add column vat_inclusive boolean not null default true,
  add column minimum_order numeric(14,3) check (minimum_order is null or minimum_order > 0),
  add column stock_quantity numeric(14,3) check (stock_quantity is null or stock_quantity >= 0),
  add column rental_duration_value numeric(10,2) check (rental_duration_value is null or rental_duration_value > 0),
  add column rental_duration_unit text,
  add constraint products_rental_consistency check (
    offer_type = 'sale' or (rental_duration_value is not null and nullif(btrim(rental_duration_unit), '') is not null)
  );
create index products_provider_review_idx on public.products (provider_id, review_status, updated_at desc);

alter table public.product_images
  add column storage_path text,
  add column file_name text,
  add column mime_type text,
  add column file_size_bytes bigint check (file_size_bytes is null or file_size_bytes between 1 and 5242880),
  add column is_primary boolean not null default false;
create unique index product_images_one_primary_idx on public.product_images (product_id) where is_primary;

alter table public.product_units add column is_base boolean not null default false;
create unique index product_units_one_base_idx on public.product_units (product_id) where is_base;

alter table public.product_measurements
  add column length_value numeric(12,3),
  add column width_value numeric(12,3),
  add column thickness_value numeric(12,3),
  add column custom_unit text,
  add column description text,
  add constraint product_measurements_positive_values check (
    (length_value is null or length_value > 0) and
    (width_value is null or width_value > 0) and
    (thickness_value is null or thickness_value > 0)
  );

alter table public.product_warranties
  add column is_available boolean not null default true,
  add column duration_value numeric(10,2),
  add column duration_unit text,
  add column no_warranty_accepted boolean not null default false,
  add constraint product_warranties_availability_consistency check (
    (is_available and duration_value is not null and duration_value > 0) or
    (not is_available and no_warranty_accepted)
  );

create table public.product_delivery_configs (
  product_id uuid primary key references public.products (id) on delete cascade,
  is_available boolean not null default false,
  maximum_duration numeric(10,2) check (maximum_duration is null or maximum_duration > 0),
  duration_unit text,
  price_per_km numeric(12,2) check (price_per_km is null or price_per_km >= 0),
  maximum_distance_km numeric(10,2) check (maximum_distance_km is null or maximum_distance_km > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_delivery_required_values check (
    not is_available or (maximum_duration is not null and nullif(btrim(duration_unit), '') is not null)
  )
);
create table public.product_delivery_regions (
  product_id uuid not null references public.products (id) on delete cascade,
  region_name text not null,
  created_at timestamptz not null default now(),
  primary key (product_id, region_name),
  constraint product_delivery_regions_not_blank check (btrim(region_name) <> '')
);

create table public.product_review_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  from_status public.product_review_status,
  to_status public.product_review_status not null,
  notes text,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index product_review_history_product_time_idx on public.product_review_history (product_id, changed_at desc);

create table public.provider_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_code text not null unique,
  request_id uuid not null references public.quote_requests (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_inclusive boolean not null default true,
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  total numeric(14,2) not null check (total >= 0),
  delivery_duration text not null,
  valid_until date not null,
  provider_notes text,
  terms text not null,
  status public.provider_quote_status not null default 'draft',
  rejection_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, provider_id),
  constraint provider_quotes_total_math check (total = subtotal + vat_amount + delivery_fee)
);
create index provider_quotes_provider_status_idx on public.provider_quotes (provider_id, status, created_at desc);

create table public.provider_quote_items (
  id uuid primary key default gen_random_uuid(),
  provider_quote_id uuid not null references public.provider_quotes (id) on delete cascade,
  request_item_id uuid not null references public.quote_request_items (id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (provider_quote_id, request_item_id)
);
create table public.provider_quote_attachments (
  id uuid primary key default gen_random_uuid(),
  provider_quote_id uuid not null references public.provider_quotes (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);
create table public.provider_quote_status_history (
  id uuid primary key default gen_random_uuid(),
  provider_quote_id uuid not null references public.provider_quotes (id) on delete cascade,
  from_status public.provider_quote_status,
  to_status public.provider_quote_status not null,
  reason text,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  provider_quote_id uuid not null unique references public.provider_quotes (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  discount_code text,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total numeric(14,2) not null check (total >= 0),
  payment_status text not null default 'pending',
  status public.provider_order_status not null default 'confirmed',
  desired_receipt_at timestamptz,
  google_maps_url text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_math check (total = subtotal + vat_amount + delivery_fee - discount_amount),
  constraint orders_coordinates_pair check ((latitude is null) = (longitude is null))
);
create index orders_provider_status_idx on public.orders (provider_id, status, created_at desc);
create index orders_customer_created_idx on public.orders (customer_profile_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_name_snapshot text not null,
  measurement_snapshot text,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.provider_order_status,
  to_status public.provider_order_status not null,
  label text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index order_status_history_order_time_idx on public.order_status_history (order_id, changed_at);

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  delivery_code text not null unique,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  driver_profile_id uuid not null references public.profiles (id) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete set null,
  status public.delivery_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  arrived_at timestamptz,
  delivered_at timestamptz,
  customer_confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);
create index delivery_assignments_driver_status_idx on public.delivery_assignments (driver_profile_id, status);

create table public.delivery_verification_codes (
  delivery_assignment_id uuid primary key references public.delivery_assignments (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  max_attempts smallint not null default 5 check (max_attempts between 1 and 10),
  attempts smallint not null default 0 check (attempts >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint delivery_codes_hash_only check (length(code_hash) >= 32),
  constraint delivery_codes_attempt_limit check (attempts <= max_attempts)
);
create table public.delivery_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_assignment_id uuid not null references public.delivery_assignments (id) on delete cascade,
  driver_profile_id uuid not null references public.profiles (id) on delete restrict,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index delivery_attempts_assignment_time_idx on public.delivery_verification_attempts (delivery_assignment_id, attempted_at desc);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_code text not null unique,
  provider_id uuid not null references public.providers (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  type public.financial_transaction_type not null,
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  status public.financial_transaction_status not null default 'pending',
  available_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index financial_transactions_provider_time_idx on public.financial_transactions (provider_id, created_at desc);

create table public.provider_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  bank_name text not null,
  account_holder_name text not null,
  iban_ciphertext text not null,
  iban_last4 text not null check (iban_last4 ~ '^[0-9]{4}$'),
  is_verified boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index provider_bank_accounts_one_primary_idx on public.provider_bank_accounts (provider_id) where is_primary;

create table public.settlement_requests (
  id uuid primary key default gen_random_uuid(),
  settlement_code text not null unique,
  provider_id uuid not null references public.providers (id) on delete restrict,
  bank_account_id uuid not null references public.provider_bank_accounts (id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  status public.settlement_request_status not null default 'pending_review',
  admin_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlements_provider_status_idx on public.settlement_requests (provider_id, status, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_unread_idx on public.notifications (profile_id, created_at desc) where read_at is null;

create table public.platform_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  title text not null,
  summary text not null,
  body jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  opened_by uuid not null references public.profiles (id) on delete restrict,
  provider_id uuid references public.providers (id) on delete cascade,
  subject text not null,
  category text not null,
  priority public.support_ticket_priority not null default 'normal',
  message text not null,
  status public.support_ticket_status not null default 'open',
  assigned_to uuid references public.profiles (id) on delete set null,
  admin_response text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_provider_status_idx on public.support_tickets (provider_id, status, created_at desc);
create table public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  provider_id uuid references public.providers (id) on delete set null,
  contractor_profile_id uuid references public.contractor_profiles (id) on delete set null,
  entity_table text not null,
  entity_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_logs_provider_time_idx on public.audit_logs (provider_id, occurred_at desc);
create index audit_logs_contractor_time_idx on public.audit_logs (contractor_profile_id, occurred_at desc);

-- Customer workspace domain.
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references public.customer_profiles (profile_id) on delete cascade,
  label text not null,
  project_name text not null,
  google_maps_url text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  city text not null,
  region text not null,
  description text,
  recipient_name text not null,
  recipient_mobile text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint customer_addresses_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint customer_addresses_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint customer_addresses_required_text check (
    btrim(label) <> '' and btrim(project_name) <> '' and btrim(city) <> '' and
    btrim(region) <> '' and btrim(recipient_name) <> '' and btrim(recipient_mobile) <> ''
  )
);
create unique index customer_addresses_one_default_idx on public.customer_addresses (customer_profile_id) where is_default;
create index customer_addresses_customer_created_idx on public.customer_addresses (customer_profile_id, created_at desc);

alter table public.quote_requests
  add column awarded_quote_id uuid references public.provider_quotes (id) on delete restrict,
  add column delivery_mode text not null default 'delivery',
  add column project_name text,
  add column recipient_name text,
  add column recipient_mobile text,
  add column customer_address_id uuid references public.customer_addresses (id) on delete set null,
  add constraint quote_requests_delivery_mode_allowed check (delivery_mode in ('delivery', 'pickup')),
  add constraint quote_requests_award_consistency check (status <> 'final_offer_ready' or awarded_quote_id is not null);
create index quote_requests_awarded_quote_idx on public.quote_requests (awarded_quote_id) where awarded_quote_id is not null;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_code text not null unique,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  total numeric(14,2) not null check (total >= 0),
  status public.invoice_status not null default 'unpaid',
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_total_math check (total = subtotal + vat_amount + delivery_fee),
  constraint invoices_paid_consistency check ((status = 'paid' and paid_at is not null) or status <> 'paid')
);
create index invoices_customer_time_idx on public.invoices (customer_profile_id, issued_at desc);
create index invoices_provider_time_idx on public.invoices (provider_id, issued_at desc);

-- Future gateway records contain references and state only, never card numbers, CVV or secrets.
create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  gateway_reference text,
  idempotency_key text unique,
  amount numeric(14,2) not null check (amount > 0),
  status public.payment_record_status not null default 'pending',
  failure_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_records_invoice_time_idx on public.payment_records (invoice_id, created_at desc);
create index payment_records_customer_time_idx on public.payment_records (customer_profile_id, created_at desc);

create table public.saved_contractors (
  customer_profile_id uuid not null references public.profiles (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  contact_requested_at timestamptz,
  saved_at timestamptz not null default now(),
  primary key (customer_profile_id, contractor_profile_id)
);
create index saved_contractors_customer_time_idx on public.saved_contractors (customer_profile_id, saved_at desc);

create table public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references public.profiles (id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_notifications_unread_idx on public.customer_notifications (customer_profile_id, created_at desc) where read_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  requested_role public.user_role := 'customer';
begin
  if new.raw_user_meta_data ->> 'role' in ('customer', 'contractor', 'merchant', 'driver') then
    requested_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  end if;

  insert into public.profiles (id, role, username, full_name, mobile, email)
  values (
    new.id,
    requested_role,
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'mobile'), ''),
    new.email
  );

  if requested_role = 'customer' then
    insert into public.customer_profiles (profile_id) values (new.id);
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_measurement_unit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.product_units u
    where u.id = new.unit_id and u.product_id = new.product_id
  ) then
    raise exception 'Measurement unit must belong to the same product';
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.is_admin() then
    raise exception 'Only an administrator can change profile role or active status';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_contractor_document_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.contractor_documents d where d.application_id = new.application_id) >= 5 then
    raise exception 'A contractor application can contain at most five documents';
  end if;
  return new;
end;
$$;

create or replace function public.validate_quote_item_references()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.measurement_id is not null and not exists (
    select 1 from public.product_measurements m
    where m.id = new.measurement_id and m.product_id = new.product_id
  ) then
    raise exception 'Quote item measurement must belong to its product';
  end if;

  if new.unit_id is not null and not exists (
    select 1 from public.product_units u
    where u.id = new.unit_id and u.product_id = new.product_id
  ) then
    raise exception 'Quote item unit must belong to its product';
  end if;

  return new;
end;
$$;

create or replace function public.validate_final_offer_selection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.merchant_quotes q
    where q.id = new.selected_merchant_quote_id
      and q.request_id = new.request_id
      and q.eligible = true
      and q.status = 'selected'
  ) then
    raise exception 'Final offer must reference the selected eligible quote for the same request';
  end if;
  return new;
end;
$$;

create or replace function public.is_provider_member(target_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.provider_members m
    where m.provider_id = target_provider_id and m.profile_id = auth.uid() and m.is_active
  ) or exists (
    select 1 from public.providers p
    where p.id = target_provider_id and p.owner_profile_id = auth.uid()
  );
$$;

create or replace function public.log_product_review_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.review_status is distinct from old.review_status then
    insert into public.product_review_history (product_id, from_status, to_status, changed_by)
    values (new.id, old.review_status, new.review_status, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.log_provider_quote_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.provider_quote_status_history (provider_quote_id, from_status, to_status, reason, changed_by)
    values (new.id, old.status, new.status, new.rejection_reason, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.log_provider_order_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, label, changed_by)
    values (new.id, old.status, new.status, 'Order status changed', auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.validate_settlement_bank_ownership()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.provider_bank_accounts b
    where b.id = new.bank_account_id and b.provider_id = new.provider_id
  ) then
    raise exception 'Settlement bank account must belong to the provider';
  end if;
  return new;
end;
$$;

create or replace function public.customer_quote_eligibility(target_request_id uuid)
returns table (
  provider_quote_id uuid,
  eligible boolean,
  total numeric,
  reasons text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    q.id,
    (
      p.status = 'approved'
      and q.status in ('pending_customer', 'modified')
      and q.valid_until >= current_date
      and not exists (
        select 1
        from public.provider_quote_items qi
        join public.quote_request_items ri on ri.id = qi.request_item_id
        join public.products product on product.id = ri.product_id
        where qi.provider_quote_id = q.id
          and (product.review_status <> 'approved' or product.availability_status = 'unavailable')
      )
    ) as eligible,
    q.total,
    array_remove(array[
      case when p.status <> 'approved' then 'provider_not_approved' end,
      case when q.status not in ('pending_customer', 'modified') then 'quote_not_open' end,
      case when q.valid_until < current_date then 'quote_expired' end,
      case when exists (
        select 1
        from public.provider_quote_items qi
        join public.quote_request_items ri on ri.id = qi.request_item_id
        join public.products product on product.id = ri.product_id
        where qi.provider_quote_id = q.id
          and (product.review_status <> 'approved' or product.availability_status = 'unavailable')
      ) then 'product_unavailable' end
    ], null)::text[] as reasons
  from public.provider_quotes q
  join public.providers p on p.id = q.provider_id
  join public.quote_requests r on r.id = q.request_id
  where q.request_id = target_request_id and r.requester_id = auth.uid();
$$;
revoke all on function public.customer_quote_eligibility(uuid) from public;
grant execute on function public.customer_quote_eligibility(uuid) to authenticated;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger profiles_protect_privileged_fields before update on public.profiles for each row execute function public.protect_profile_privileged_fields();
create trigger customer_profiles_set_updated_at before update on public.customer_profiles for each row execute function public.set_updated_at();
create trigger product_categories_set_updated_at before update on public.product_categories for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger product_warranties_set_updated_at before update on public.product_warranties for each row execute function public.set_updated_at();
create trigger provider_applications_set_updated_at before update on public.provider_applications for each row execute function public.set_updated_at();
create trigger contractor_applications_set_updated_at before update on public.contractor_applications for each row execute function public.set_updated_at();
create trigger contractor_profiles_set_updated_at before update on public.contractor_profiles for each row execute function public.set_updated_at();
create trigger quote_requests_set_updated_at before update on public.quote_requests for each row execute function public.set_updated_at();
create trigger merchant_quotes_set_updated_at before update on public.merchant_quotes for each row execute function public.set_updated_at();
create trigger final_offers_set_updated_at before update on public.final_offers for each row execute function public.set_updated_at();
create trigger deliveries_set_updated_at before update on public.deliveries for each row execute function public.set_updated_at();
create trigger subscription_plans_set_updated_at before update on public.subscription_plans for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger providers_set_updated_at before update on public.providers for each row execute function public.set_updated_at();
create trigger provider_settings_set_updated_at before update on public.provider_settings for each row execute function public.set_updated_at();
create trigger provider_profiles_set_updated_at before update on public.provider_profiles for each row execute function public.set_updated_at();
create trigger product_delivery_configs_set_updated_at before update on public.product_delivery_configs for each row execute function public.set_updated_at();
create trigger provider_quotes_set_updated_at before update on public.provider_quotes for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger delivery_assignments_set_updated_at before update on public.delivery_assignments for each row execute function public.set_updated_at();
create trigger provider_bank_accounts_set_updated_at before update on public.provider_bank_accounts for each row execute function public.set_updated_at();
create trigger settlement_requests_set_updated_at before update on public.settlement_requests for each row execute function public.set_updated_at();
create trigger platform_policies_set_updated_at before update on public.platform_policies for each row execute function public.set_updated_at();
create trigger support_tickets_set_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();
create trigger customer_addresses_set_updated_at before update on public.customer_addresses for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger products_log_review_status after update of review_status on public.products for each row execute function public.log_product_review_status();
create trigger provider_quotes_log_status after update of status on public.provider_quotes for each row execute function public.log_provider_quote_status();
create trigger orders_log_status after update of status on public.orders for each row execute function public.log_provider_order_status();
create trigger settlements_validate_bank before insert or update of bank_account_id, provider_id on public.settlement_requests for each row execute function public.validate_settlement_bank_ownership();
create trigger product_measurements_validate_unit before insert or update on public.product_measurements for each row execute function public.validate_product_measurement_unit();
create trigger quote_request_items_validate_references before insert or update on public.quote_request_items for each row execute function public.validate_quote_item_references();
create trigger final_offers_validate_selection before insert or update on public.final_offers for each row execute function public.validate_final_offer_selection();
create trigger contractor_documents_enforce_limit before insert on public.contractor_documents for each row execute function public.enforce_contractor_document_limit();
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_units enable row level security;
alter table public.product_measurements enable row level security;
alter table public.product_specifications enable row level security;
alter table public.product_warranties enable row level security;
alter table public.product_availability_regions enable row level security;
alter table public.provider_applications enable row level security;
alter table public.provider_application_categories enable row level security;
alter table public.provider_delivery_regions enable row level security;
alter table public.contractor_applications enable row level security;
alter table public.contractor_work_regions enable row level security;
alter table public.contractor_specialties enable row level security;
alter table public.contractor_documents enable row level security;
alter table public.contractor_profiles enable row level security;
alter table public.contractor_profile_specialties enable row level security;
alter table public.contractor_profile_regions enable row level security;
alter table public.contractor_portfolio_items enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quote_request_items enable row level security;
alter table public.merchant_quotes enable row level security;
alter table public.final_offers enable row level security;
alter table public.order_events enable row level security;
alter table public.deliveries enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.providers enable row level security;
alter table public.provider_members enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.provider_settings enable row level security;
alter table public.product_delivery_configs enable row level security;
alter table public.product_delivery_regions enable row level security;
alter table public.product_review_history enable row level security;
alter table public.provider_quotes enable row level security;
alter table public.provider_quote_items enable row level security;
alter table public.provider_quote_attachments enable row level security;
alter table public.provider_quote_status_history enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.delivery_assignments enable row level security;
alter table public.delivery_verification_codes enable row level security;
alter table public.delivery_verification_attempts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.provider_bank_accounts enable row level security;
alter table public.settlement_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_policies enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_attachments enable row level security;
alter table public.audit_logs enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.saved_contractors enable row level security;
alter table public.customer_notifications enable row level security;

create policy profiles_select_own_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_own_or_admin on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy customer_profiles_own_or_admin on public.customer_profiles for all to authenticated using (profile_id = auth.uid() or public.is_admin()) with check (profile_id = auth.uid() or public.is_admin());

create policy categories_public_read on public.product_categories for select to anon, authenticated using (is_active or public.is_admin());
create policy categories_admin_manage on public.product_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_public_read on public.products for select to anon, authenticated using (is_published or public.is_admin());
create policy products_admin_manage on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy product_images_public_read on public.product_images for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_images_admin_manage on public.product_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_units_public_read on public.product_units for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_units_admin_manage on public.product_units for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_measurements_public_read on public.product_measurements for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_measurements_admin_manage on public.product_measurements for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_specs_public_read on public.product_specifications for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_specs_admin_manage on public.product_specifications for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_warranties_public_read on public.product_warranties for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_warranties_admin_manage on public.product_warranties for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_regions_public_read on public.product_availability_regions for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_admin())));
create policy product_regions_admin_manage on public.product_availability_regions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_images_provider_manage on public.product_images for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));
create policy product_units_provider_manage on public.product_units for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));
create policy product_measurements_provider_manage on public.product_measurements for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));
create policy product_specs_provider_manage on public.product_specifications for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));
create policy product_warranties_provider_manage on public.product_warranties for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));
create policy product_regions_provider_manage on public.product_availability_regions for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_provider_member(p.provider_id)));

create policy provider_applications_insert_own on public.provider_applications for insert to authenticated with check (applicant_profile_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy provider_applications_select_own_or_admin on public.provider_applications for select to authenticated using (applicant_profile_id = auth.uid() or public.is_admin());
create policy provider_applications_admin_review on public.provider_applications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy provider_categories_select_own_or_admin on public.provider_application_categories for select to authenticated using (exists (select 1 from public.provider_applications a where a.id = application_id and (a.applicant_profile_id = auth.uid() or public.is_admin())));
create policy provider_categories_insert_own on public.provider_application_categories for insert to authenticated with check (exists (select 1 from public.provider_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.status in ('pending', 'needs_changes')));
create policy provider_categories_admin_manage on public.provider_application_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy provider_regions_select_own_or_admin on public.provider_delivery_regions for select to authenticated using (exists (select 1 from public.provider_applications a where a.id = application_id and (a.applicant_profile_id = auth.uid() or public.is_admin())));
create policy provider_regions_insert_own on public.provider_delivery_regions for insert to authenticated with check (exists (select 1 from public.provider_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.delivery_available and a.status in ('pending', 'needs_changes')));
create policy provider_regions_admin_manage on public.provider_delivery_regions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy contractor_applications_insert_own on public.contractor_applications for insert to authenticated with check (applicant_profile_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy contractor_applications_select_own_or_admin on public.contractor_applications for select to authenticated using (applicant_profile_id = auth.uid() or public.is_admin());
create policy contractor_applications_admin_review on public.contractor_applications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_regions_select_own_or_admin on public.contractor_work_regions for select to authenticated using (exists (select 1 from public.contractor_applications a where a.id = application_id and (a.applicant_profile_id = auth.uid() or public.is_admin())));
create policy contractor_regions_insert_own on public.contractor_work_regions for insert to authenticated with check (exists (select 1 from public.contractor_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.status in ('pending', 'needs_changes')));
create policy contractor_regions_admin_manage on public.contractor_work_regions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_specialties_select_own_or_admin on public.contractor_specialties for select to authenticated using (exists (select 1 from public.contractor_applications a where a.id = application_id and (a.applicant_profile_id = auth.uid() or public.is_admin())));
create policy contractor_specialties_insert_own on public.contractor_specialties for insert to authenticated with check (exists (select 1 from public.contractor_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.status in ('pending', 'needs_changes')));
create policy contractor_specialties_admin_manage on public.contractor_specialties for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_documents_select_own_or_admin on public.contractor_documents for select to authenticated using (exists (select 1 from public.contractor_applications a where a.id = application_id and (a.applicant_profile_id = auth.uid() or public.is_admin())));
create policy contractor_documents_insert_own on public.contractor_documents for insert to authenticated with check (exists (select 1 from public.contractor_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.status in ('pending', 'needs_changes')));
create policy contractor_documents_delete_own_or_admin on public.contractor_documents for delete to authenticated using (public.is_admin() or exists (select 1 from public.contractor_applications a where a.id = application_id and a.applicant_profile_id = auth.uid() and a.status in ('pending', 'needs_changes')));

create policy contractor_profiles_public_read on public.contractor_profiles for select to anon, authenticated using ((approval_status = 'approved' and subscription_active) or public.is_admin() or profile_id = auth.uid());
create policy contractor_profiles_admin_manage on public.contractor_profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_profile_specialties_public_read on public.contractor_profile_specialties for select to anon, authenticated using (exists (select 1 from public.contractor_profiles p where p.id = profile_id and ((p.approval_status = 'approved' and p.subscription_active) or p.profile_id = auth.uid() or public.is_admin())));
create policy contractor_profile_specialties_admin_manage on public.contractor_profile_specialties for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_profile_regions_public_read on public.contractor_profile_regions for select to anon, authenticated using (exists (select 1 from public.contractor_profiles p where p.id = profile_id and ((p.approval_status = 'approved' and p.subscription_active) or p.profile_id = auth.uid() or public.is_admin())));
create policy contractor_profile_regions_admin_manage on public.contractor_profile_regions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_portfolio_public_read on public.contractor_portfolio_items for select to anon, authenticated using (exists (select 1 from public.contractor_profiles p where p.id = profile_id and ((is_visible and is_approved and p.approval_status = 'approved' and p.subscription_active and p.directory_visible) or p.profile_id = auth.uid() or public.is_admin())));
create policy contractor_portfolio_admin_manage on public.contractor_portfolio_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy quote_requests_own_or_admin_select on public.quote_requests for select to authenticated using (requester_id = auth.uid() or public.is_admin());
create policy quote_requests_own_insert on public.quote_requests for insert to authenticated with check (requester_id = auth.uid() and status = 'draft' and payment_status = 'pending' and handshake_code_hash is null and ((requester_role = 'customer' and public.current_user_role() = 'customer') or (requester_role = 'contractor' and public.current_user_role() = 'contractor')));
create policy quote_requests_own_draft_update on public.quote_requests for update to authenticated using ((requester_id = auth.uid() and status = 'draft') or public.is_admin()) with check (public.is_admin() or (requester_id = auth.uid() and status = 'draft' and payment_status = 'pending' and handshake_code_hash is null));
create policy quote_items_own_or_admin_select on public.quote_request_items for select to authenticated using (exists (select 1 from public.quote_requests r where r.id = request_id and (r.requester_id = auth.uid() or public.is_admin())));
create policy quote_items_own_draft_insert on public.quote_request_items for insert to authenticated with check (exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'));
create policy quote_items_own_draft_update on public.quote_request_items for update to authenticated using (exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft')) with check (exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'));
create policy quote_items_own_draft_delete on public.quote_request_items for delete to authenticated using (exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid() and r.status = 'draft'));

create policy merchant_quotes_own_or_admin_select on public.merchant_quotes for select to authenticated using (merchant_profile_id = auth.uid() or public.is_admin());
create policy merchant_quotes_own_insert on public.merchant_quotes for insert to authenticated with check (merchant_profile_id = auth.uid() and public.current_user_role() = 'merchant' and status in ('draft', 'sent') and eligible = false);
create policy merchant_quotes_own_update on public.merchant_quotes for update to authenticated using ((merchant_profile_id = auth.uid() and status in ('draft', 'sent')) or public.is_admin()) with check (public.is_admin() or (merchant_profile_id = auth.uid() and status in ('draft', 'sent') and eligible = false));
create policy final_offers_requester_or_admin_select on public.final_offers for select to authenticated using (public.is_admin() or exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid()));
create policy final_offers_admin_manage on public.final_offers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_events_requester_driver_admin_select on public.order_events for select to authenticated using (public.is_admin() or exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid()) or exists (select 1 from public.deliveries d where d.request_id = request_id and d.driver_profile_id = auth.uid()));
create policy order_events_admin_manage on public.order_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy deliveries_participants_select on public.deliveries for select to authenticated using (public.is_admin() or driver_profile_id = auth.uid() or exists (select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid()));
create policy deliveries_driver_update on public.deliveries for update to authenticated using (driver_profile_id = auth.uid() or public.is_admin()) with check (driver_profile_id = auth.uid() or public.is_admin());
create policy deliveries_admin_manage on public.deliveries for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy subscription_plans_public_read on public.subscription_plans for select to anon, authenticated using (is_active or public.is_admin());
create policy subscription_plans_admin_manage on public.subscription_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy subscriptions_own_or_admin_select on public.subscriptions for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy subscriptions_admin_manage on public.subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy providers_member_select on public.providers for select to authenticated using (public.is_provider_member(id) or public.is_admin());
create policy providers_admin_manage on public.providers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy provider_members_member_select on public.provider_members for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_members_owner_manage on public.provider_members for all to authenticated
  using (exists (select 1 from public.providers p where p.id = provider_id and p.owner_profile_id = auth.uid()) or public.is_admin())
  with check (exists (select 1 from public.providers p where p.id = provider_id and p.owner_profile_id = auth.uid()) or public.is_admin());
create policy provider_profiles_member_manage on public.provider_profiles for all to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_settings_member_manage on public.provider_settings for all to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());

create policy products_provider_manage on public.products for all to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());
create policy product_delivery_configs_public_read on public.product_delivery_configs for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_provider_member(p.provider_id) or public.is_admin())));
create policy product_delivery_configs_provider_manage on public.product_delivery_configs for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (public.is_provider_member(p.provider_id) or public.is_admin())))
  with check (exists (select 1 from public.products p where p.id = product_id and (public.is_provider_member(p.provider_id) or public.is_admin())));
create policy product_delivery_regions_public_read on public.product_delivery_regions for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.is_published or public.is_provider_member(p.provider_id) or public.is_admin())));
create policy product_delivery_regions_provider_manage on public.product_delivery_regions for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (public.is_provider_member(p.provider_id) or public.is_admin())))
  with check (exists (select 1 from public.products p where p.id = product_id and (public.is_provider_member(p.provider_id) or public.is_admin())));
create policy product_review_history_provider_read on public.product_review_history for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (public.is_provider_member(p.provider_id) or public.is_admin())));
create policy product_review_history_admin_insert on public.product_review_history for insert to authenticated with check (public.is_admin());

create policy provider_quotes_provider_or_customer_select on public.provider_quotes for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin() or exists (
    select 1 from public.quote_requests r where r.id = request_id and r.requester_id = auth.uid()
  ));
create policy provider_quotes_provider_insert on public.provider_quotes for insert to authenticated
  with check (public.is_provider_member(provider_id) and status in ('draft','pending_customer'));
create policy provider_quotes_provider_update on public.provider_quotes for update to authenticated
  using ((public.is_provider_member(provider_id) and status in ('draft','pending_customer','modified')) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_quote_items_participant_read on public.provider_quote_items for select to authenticated
  using (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and (
    public.is_provider_member(q.provider_id) or public.is_admin() or exists (
      select 1 from public.quote_requests r where r.id = q.request_id and r.requester_id = auth.uid()
    )
  )));
create policy provider_quote_items_provider_manage on public.provider_quote_items for all to authenticated
  using (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and public.is_provider_member(q.provider_id)))
  with check (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and public.is_provider_member(q.provider_id)));
create policy provider_quote_attachments_participant_read on public.provider_quote_attachments for select to authenticated
  using (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and (
    public.is_provider_member(q.provider_id) or public.is_admin() or exists (
      select 1 from public.quote_requests r where r.id = q.request_id and r.requester_id = auth.uid()
    )
  )));
create policy provider_quote_attachments_provider_manage on public.provider_quote_attachments for all to authenticated
  using (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and public.is_provider_member(q.provider_id)))
  with check (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and public.is_provider_member(q.provider_id)));
create policy provider_quote_history_participant_read on public.provider_quote_status_history for select to authenticated
  using (exists (select 1 from public.provider_quotes q where q.id = provider_quote_id and (
    public.is_provider_member(q.provider_id) or public.is_admin() or exists (
      select 1 from public.quote_requests r where r.id = q.request_id and r.requester_id = auth.uid()
    )
  )));

create policy orders_participant_select on public.orders for select to authenticated
  using (customer_profile_id = auth.uid() or public.is_provider_member(provider_id) or public.is_admin());
create policy orders_provider_progress on public.orders for update to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());
create policy orders_admin_insert on public.orders for insert to authenticated with check (public.is_admin());
create policy order_items_participant_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (
    o.customer_profile_id = auth.uid() or public.is_provider_member(o.provider_id) or public.is_admin()
  )));
create policy order_items_admin_manage on public.order_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_history_participant_read on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (
    o.customer_profile_id = auth.uid() or public.is_provider_member(o.provider_id) or public.is_admin()
  )));

create policy delivery_assignments_participant_read on public.delivery_assignments for select to authenticated
  using (driver_profile_id = auth.uid() or public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and (o.customer_profile_id = auth.uid() or public.is_provider_member(o.provider_id))
  ));
create policy delivery_assignments_provider_manage on public.delivery_assignments for all to authenticated
  using (public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and public.is_provider_member(o.provider_id)))
  with check (public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and public.is_provider_member(o.provider_id)));
-- No direct SELECT policy exists on delivery_verification_codes: code hashes are reachable only through a guarded RPC.
create policy delivery_attempts_driver_read on public.delivery_verification_attempts for select to authenticated
  using (driver_profile_id = auth.uid() or public.is_admin());

create policy financial_transactions_provider_read on public.financial_transactions for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin());
create policy financial_transactions_admin_manage on public.financial_transactions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy bank_accounts_provider_manage on public.provider_bank_accounts for all to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin())
  with check (public.is_provider_member(provider_id) or public.is_admin());
create policy settlements_provider_read on public.settlement_requests for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin());
create policy settlements_provider_insert on public.settlement_requests for insert to authenticated
  with check (public.is_provider_member(provider_id) and status = 'pending_review' and reviewed_by is null);
create policy settlements_admin_review on public.settlement_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy notifications_own_read on public.notifications for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy notifications_own_mark_read on public.notifications for update to authenticated
  using (profile_id = auth.uid() or public.is_admin()) with check (profile_id = auth.uid() or public.is_admin());
create policy notifications_admin_insert on public.notifications for insert to authenticated with check (public.is_admin());
create policy platform_policies_public_read on public.platform_policies for select to anon, authenticated using (is_published or public.is_admin());
create policy platform_policies_admin_manage on public.platform_policies for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy support_tickets_own_or_admin_read on public.support_tickets for select to authenticated
  using (opened_by = auth.uid() or public.is_admin() or (provider_id is not null and public.is_provider_member(provider_id)));
create policy support_tickets_own_insert on public.support_tickets for insert to authenticated
  with check (opened_by = auth.uid() and (provider_id is null or public.is_provider_member(provider_id)) and status = 'open');
create policy support_tickets_admin_update on public.support_tickets for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy support_attachments_participant_read on public.support_ticket_attachments for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and (
    t.opened_by = auth.uid() or public.is_admin() or (t.provider_id is not null and public.is_provider_member(t.provider_id))
  )));
create policy support_attachments_owner_insert on public.support_ticket_attachments for insert to authenticated
  with check (exists (select 1 from public.support_tickets t where t.id = ticket_id and t.opened_by = auth.uid()));
create policy audit_logs_admin_read on public.audit_logs for select to authenticated using (public.is_admin());
create policy customer_addresses_own_manage on public.customer_addresses for all to authenticated
  using (customer_profile_id = auth.uid() or public.is_admin())
  with check (customer_profile_id = auth.uid() or public.is_admin());
create policy invoices_customer_provider_read on public.invoices for select to authenticated
  using (customer_profile_id = auth.uid() or public.is_provider_member(provider_id) or public.is_admin());
create policy invoices_admin_manage on public.invoices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy payment_records_customer_read on public.payment_records for select to authenticated
  using (customer_profile_id = auth.uid() or public.is_admin());
create policy payment_records_admin_manage on public.payment_records for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy saved_contractors_own_manage on public.saved_contractors for all to authenticated
  using (customer_profile_id = auth.uid() or public.is_admin())
  with check (customer_profile_id = auth.uid() or public.is_admin());
create policy customer_notifications_own_read on public.customer_notifications for select to authenticated
  using (customer_profile_id = auth.uid() or public.is_admin());
create policy customer_notifications_own_update on public.customer_notifications for update to authenticated
  using (customer_profile_id = auth.uid() or public.is_admin())
  with check (customer_profile_id = auth.uid() or public.is_admin());
create policy customer_notifications_admin_insert on public.customer_notifications for insert to authenticated
  with check (public.is_admin());

create or replace function public.verify_delivery_code(p_assignment_id uuid, p_plain_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  verification public.delivery_verification_codes%rowtype;
  assignment public.delivery_assignments%rowtype;
  is_valid boolean := false;
begin
  select * into assignment from public.delivery_assignments where id = p_assignment_id for update;
  if assignment.driver_profile_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  select * into verification from public.delivery_verification_codes where delivery_assignment_id = p_assignment_id for update;
  if verification.verified_at is not null or verification.expires_at <= now() or verification.attempts >= verification.max_attempts then
    return false;
  end if;
  is_valid := verification.code_hash = encode(extensions.digest('bunya-delivery:' || p_plain_code, 'sha256'), 'hex');
  update public.delivery_verification_codes
    set attempts = attempts + 1, verified_at = case when is_valid then now() else verified_at end
    where delivery_assignment_id = p_assignment_id;
  insert into public.delivery_verification_attempts (delivery_assignment_id, driver_profile_id, succeeded)
    values (p_assignment_id, auth.uid(), is_valid);
  if is_valid then
    update public.delivery_assignments set status = 'delivered', delivered_at = now(), customer_confirmed = true
      where id = p_assignment_id;
  end if;
  return is_valid;
end;
$$;
revoke all on function public.verify_delivery_code(uuid, text) from public;
grant execute on function public.verify_delivery_code(uuid, text) to authenticated;

-- Merchants must never read the base quote_requests table. This RPC exposes only the
-- anonymized operational fields currently shown in the merchant UI.
create or replace function public.get_anonymous_quote_requests()
returns table (
  request_id uuid,
  request_code text,
  city text,
  quote_deadline timestamptz,
  item_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() <> 'merchant' and not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select r.id, r.request_code, r.city, r.quote_deadline, count(i.id)
  from public.quote_requests r
  join public.quote_request_items i on i.request_id = r.id
  where r.status = 'collecting_quotes' and r.quote_deadline > now()
  group by r.id, r.request_code, r.city, r.quote_deadline;
end;
$$;

revoke all on function public.get_anonymous_quote_requests() from public;
grant execute on function public.get_anonymous_quote_requests() to authenticated;

insert into public.product_categories (name, slug, sort_order)
values
  ('الأسمنت', 'cement', 10),
  ('الحديد', 'steel', 20),
  ('البلك والطوب', 'blocks-bricks', 30),
  ('العزل', 'insulation', 40),
  ('السباكة', 'plumbing', 50),
  ('الكهرباء', 'electrical', 60),
  ('الأخشاب', 'wood', 70),
  ('الدهانات', 'paint', 80),
  ('الأدوات والمعدات', 'tools-equipment', 90);

insert into public.subscription_plans (id, role, name, price_monthly, description, benefits)
values
  (
    'merchant-monthly',
    'merchant',
    'اشتراك التاجر',
    99,
    'استقبال طلبات عروض السعر المجهولة وإدارة المنتجات والعروض.',
    array['استقبال RFQ مجهولة', 'إدارة المنتجات', 'إرسال العروض', 'متابعة الطلبات المدفوعة']
  ),
  (
    'contractor-visibility',
    'contractor',
    'ظهور المقاول',
    49,
    'ظهور ملف المقاول المعتمد في دليل البحث.',
    array['الظهور في البحث', 'عرض التخصصات', 'عرض مناطق العمل', 'عرض نماذج الأعمال']
  );

-- Private future bucket for contractor evidence documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contractor-documents',
  'contractor-documents',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
);

create policy contractor_documents_storage_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'contractor-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy contractor_documents_storage_select_own_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'contractor-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

create policy contractor_documents_storage_delete_own_or_admin
on storage.objects for delete to authenticated
using (
  bucket_id = 'contractor-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- Private future buckets for provider assets. Paths start with provider UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('provider-product-images', 'provider-product-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('provider-quote-attachments', 'provider-quote-attachments', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('provider-support-attachments', 'provider-support-attachments', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('customer-avatars', 'customer-avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('customer-support-attachments', 'customer-support-attachments', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

create policy provider_assets_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id in ('provider-product-images', 'provider-quote-attachments', 'provider-support-attachments')
  and public.is_provider_member(((storage.foldername(name))[1])::uuid)
);
create policy provider_assets_storage_select
on storage.objects for select to authenticated
using (
  bucket_id in ('provider-product-images', 'provider-quote-attachments', 'provider-support-attachments')
  and (public.is_provider_member(((storage.foldername(name))[1])::uuid) or public.is_admin())
);
create policy provider_assets_storage_update
on storage.objects for update to authenticated
using (
  bucket_id in ('provider-product-images', 'provider-quote-attachments', 'provider-support-attachments')
  and public.is_provider_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id in ('provider-product-images', 'provider-quote-attachments', 'provider-support-attachments')
  and public.is_provider_member(((storage.foldername(name))[1])::uuid)
);
create policy provider_assets_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id in ('provider-product-images', 'provider-quote-attachments', 'provider-support-attachments')
  and (public.is_provider_member(((storage.foldername(name))[1])::uuid) or public.is_admin())
);

create policy customer_assets_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id in ('customer-avatars', 'customer-support-attachments')
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy customer_assets_storage_select
on storage.objects for select to authenticated
using (
  bucket_id in ('customer-avatars', 'customer-support-attachments')
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
create policy customer_assets_storage_update
on storage.objects for update to authenticated
using (
  bucket_id in ('customer-avatars', 'customer-support-attachments')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id in ('customer-avatars', 'customer-support-attachments')
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy customer_assets_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id in ('customer-avatars', 'customer-support-attachments')
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- Internal sourcing and Bunya-owned customer quote domain.
-- Provider identities and selections live only in internal tables; customer quote tables
-- intentionally contain no provider_id, provider name, rating, logo, or contact columns.
create table public.provider_product_prices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  vat_inclusive boolean not null default false,
  last_updated_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  freshness_status public.price_freshness_status not null default 'valid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, product_id),
  constraint provider_product_prices_expiry_valid check (expires_at >= greatest(last_updated_at, last_confirmed_at))
);
create index provider_product_prices_product_expiry_idx on public.provider_product_prices (product_id, expires_at);
create index provider_product_prices_provider_freshness_idx on public.provider_product_prices (provider_id, freshness_status, expires_at);

create table public.provider_price_confirmations (
  id uuid primary key default gen_random_uuid(),
  provider_product_price_id uuid not null references public.provider_product_prices (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  confirmed_price numeric(14,2) not null check (confirmed_price >= 0),
  price_changed boolean not null default false,
  confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint provider_price_confirmations_expiry check (expires_at = confirmed_at + interval '72 hours')
);
create index provider_price_confirmations_provider_time_idx on public.provider_price_confirmations (provider_id, confirmed_at desc);

create table public.internal_sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique,
  customer_request_id uuid not null unique references public.quote_requests (id) on delete cascade,
  stage public.quote_processing_stage not null default 'received',
  expected_ready_at timestamptz not null,
  response_deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_sourcing_deadline_valid check (response_deadline_at > created_at),
  constraint internal_sourcing_expected_ready_valid check (expected_ready_at >= created_at)
);
create index internal_sourcing_stage_deadline_idx on public.internal_sourcing_requests (stage, response_deadline_at);

create table public.internal_sourcing_request_items (
  id uuid primary key default gen_random_uuid(),
  sourcing_request_id uuid not null references public.internal_sourcing_requests (id) on delete cascade,
  quote_request_item_id uuid not null references public.quote_request_items (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_snapshot text not null check (btrim(unit_snapshot) <> ''),
  measurement_snapshot text,
  delivery_region text not null check (btrim(delivery_region) <> ''),
  required_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (sourcing_request_id, quote_request_item_id)
);
create index internal_sourcing_items_product_region_idx on public.internal_sourcing_request_items (product_id, lower(delivery_region));

create table public.internal_sourcing_request_targets (
  sourcing_request_item_id uuid not null references public.internal_sourcing_request_items (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  targeted_at timestamptz not null default now(),
  response_deadline_at timestamptz not null,
  primary key (sourcing_request_item_id, provider_id)
);
create index internal_sourcing_targets_provider_deadline_idx on public.internal_sourcing_request_targets (provider_id, response_deadline_at);

create table public.provider_pricing_responses (
  id uuid primary key default gen_random_uuid(),
  response_code text not null unique,
  sourcing_request_item_id uuid not null references public.internal_sourcing_request_items (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  provider_product_price_id uuid references public.provider_product_prices (id) on delete restrict,
  receipt_confirmed_at timestamptz not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  vat_inclusive boolean not null default false,
  price_confirmed_at timestamptz not null,
  price_expires_at timestamptz not null,
  internal_notes text,
  status public.provider_pricing_response_status not null default 'evaluating',
  evaluated_at timestamptz,
  evaluation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sourcing_request_item_id, provider_id),
  constraint provider_pricing_response_expiry check (price_expires_at <= price_confirmed_at + interval '72 hours' and price_expires_at > price_confirmed_at)
);
create index provider_pricing_responses_item_status_idx on public.provider_pricing_responses (sourcing_request_item_id, status);
create index provider_pricing_responses_provider_created_idx on public.provider_pricing_responses (provider_id, created_at desc);

create table public.provider_availability_confirmations (
  id uuid primary key default gen_random_uuid(),
  pricing_response_id uuid not null unique references public.provider_pricing_responses (id) on delete cascade,
  available boolean not null,
  available_quantity numeric(14,3) not null default 0 check (available_quantity >= 0),
  confirmed_at timestamptz not null default now(),
  constraint availability_quantity_consistency check ((available and available_quantity > 0) or (not available and available_quantity = 0))
);

create table public.provider_delivery_confirmations (
  id uuid primary key default gen_random_uuid(),
  pricing_response_id uuid not null unique references public.provider_pricing_responses (id) on delete cascade,
  region_eligible boolean not null,
  preparation_duration_hours numeric(10,2) not null check (preparation_duration_hours >= 0),
  delivery_duration_hours numeric(10,2) not null check (delivery_duration_hours >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  confirmed_at timestamptz not null default now()
);

create table public.internal_selection_results (
  id uuid primary key default gen_random_uuid(),
  sourcing_request_id uuid not null unique references public.internal_sourcing_requests (id) on delete cascade,
  evaluated_by uuid references public.profiles (id) on delete set null,
  selection_notes text,
  created_at timestamptz not null default now()
);

create table public.selected_provider_items (
  id uuid primary key default gen_random_uuid(),
  selection_result_id uuid not null references public.internal_selection_results (id) on delete cascade,
  sourcing_request_item_id uuid not null references public.internal_sourcing_request_items (id) on delete cascade,
  pricing_response_id uuid not null unique references public.provider_pricing_responses (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  landed_cost numeric(14,2) generated always as (subtotal + vat_amount + delivery_fee) stored,
  selection_reason text not null check (btrim(selection_reason) <> ''),
  created_at timestamptz not null default now(),
  unique (selection_result_id, sourcing_request_item_id)
);
create index selected_provider_items_provider_idx on public.selected_provider_items (provider_id, created_at desc);

create table public.bunya_customer_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_code text not null unique,
  customer_request_id uuid not null unique references public.quote_requests (id) on delete cascade,
  platform_name text not null default 'بُنية' check (platform_name = 'بُنية'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  total numeric(14,2) generated always as (subtotal + vat_amount + delivery_fee) stored,
  valid_until timestamptz not null,
  expected_delivery_at timestamptz not null,
  terms text not null check (btrim(terms) <> ''),
  status public.bunya_customer_quote_status not null default 'preparing',
  processing_stage public.quote_processing_stage not null default 'received',
  expected_ready_at timestamptz not null,
  ready_at timestamptz,
  customer_decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bunya_customer_quote_validity check (valid_until > created_at),
  constraint bunya_customer_quote_ready_consistency check ((status = 'preparing' and ready_at is null) or status <> 'preparing')
);
create index bunya_customer_quotes_request_status_idx on public.bunya_customer_quotes (customer_request_id, status);

create table public.bunya_customer_quote_items (
  id uuid primary key default gen_random_uuid(),
  bunya_customer_quote_id uuid not null references public.bunya_customer_quotes (id) on delete cascade,
  quote_request_item_id uuid not null references public.quote_request_items (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  product_name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_snapshot text not null,
  measurement_snapshot text,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  line_total numeric(14,2) generated always as (subtotal + vat_amount + delivery_fee) stored,
  created_at timestamptz not null default now(),
  unique (bunya_customer_quote_id, quote_request_item_id)
);

create table public.internal_fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  fulfillment_code text not null unique,
  bunya_customer_quote_id uuid not null references public.bunya_customer_quotes (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  delivery_region text not null,
  required_at timestamptz not null,
  assigned_value numeric(14,2) not null check (assigned_value >= 0),
  status public.internal_fulfillment_status not null default 'assigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bunya_customer_quote_id, provider_id)
);
create index internal_fulfillment_provider_status_idx on public.internal_fulfillment_orders (provider_id, status, created_at desc);

create table public.internal_fulfillment_order_items (
  fulfillment_order_id uuid not null references public.internal_fulfillment_orders (id) on delete cascade,
  selected_provider_item_id uuid not null unique references public.selected_provider_items (id) on delete restrict,
  primary key (fulfillment_order_id, selected_provider_item_id)
);

create or replace function public.refresh_provider_price_validity()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'provider_price_confirmations' then
    new.expires_at := new.confirmed_at + interval '72 hours';
    update public.provider_product_prices
       set unit_price = new.confirmed_price,
           last_updated_at = case when new.price_changed then new.confirmed_at else last_updated_at end,
           last_confirmed_at = new.confirmed_at,
           expires_at = new.expires_at,
           freshness_status = 'valid',
           updated_at = now()
     where id = new.provider_product_price_id and provider_id = new.provider_id;
  else
    new.expires_at := greatest(new.last_updated_at, new.last_confirmed_at) + interval '72 hours';
    new.freshness_status := case
      when new.expires_at <= now() then 'expired'::public.price_freshness_status
      when new.expires_at <= now() + interval '24 hours' then 'expiring_soon'::public.price_freshness_status
      else 'valid'::public.price_freshness_status end;
  end if;
  return new;
end;
$$;
create trigger provider_product_prices_validity before insert or update of unit_price, last_updated_at, last_confirmed_at on public.provider_product_prices for each row execute function public.refresh_provider_price_validity();
create trigger provider_price_confirmations_validity before insert on public.provider_price_confirmations for each row execute function public.refresh_provider_price_validity();

create or replace function public.provider_price_is_current(target_price_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.provider_product_prices p where p.id = target_price_id and p.expires_at > now());
$$;

create or replace function public.validate_internal_pricing_response()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.price_expires_at > new.price_confirmed_at + interval '72 hours' then
    raise exception 'Provider pricing response cannot remain valid for more than 72 hours';
  end if;
  if not exists (select 1 from public.internal_sourcing_request_targets t where t.sourcing_request_item_id = new.sourcing_request_item_id and t.provider_id = new.provider_id) then
    raise exception 'Provider is not targeted for this internal sourcing item';
  end if;
  return new;
end;
$$;
create trigger validate_internal_pricing_response before insert or update on public.provider_pricing_responses for each row execute function public.validate_internal_pricing_response();

create trigger provider_product_prices_updated_at before update on public.provider_product_prices for each row execute function public.set_updated_at();
create trigger internal_sourcing_requests_updated_at before update on public.internal_sourcing_requests for each row execute function public.set_updated_at();
create trigger provider_pricing_responses_updated_at before update on public.provider_pricing_responses for each row execute function public.set_updated_at();
create trigger bunya_customer_quotes_updated_at before update on public.bunya_customer_quotes for each row execute function public.set_updated_at();
create trigger internal_fulfillment_orders_updated_at before update on public.internal_fulfillment_orders for each row execute function public.set_updated_at();

alter table public.provider_product_prices enable row level security;
alter table public.provider_price_confirmations enable row level security;
alter table public.internal_sourcing_requests enable row level security;
alter table public.internal_sourcing_request_items enable row level security;
alter table public.internal_sourcing_request_targets enable row level security;
alter table public.provider_pricing_responses enable row level security;
alter table public.provider_availability_confirmations enable row level security;
alter table public.provider_delivery_confirmations enable row level security;
alter table public.internal_selection_results enable row level security;
alter table public.selected_provider_items enable row level security;
alter table public.bunya_customer_quotes enable row level security;
alter table public.bunya_customer_quote_items enable row level security;
alter table public.internal_fulfillment_orders enable row level security;
alter table public.internal_fulfillment_order_items enable row level security;

create policy provider_product_prices_owner_select on public.provider_product_prices for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_product_prices_owner_insert on public.provider_product_prices for insert to authenticated with check (public.is_provider_member(provider_id));
create policy provider_product_prices_owner_update on public.provider_product_prices for update to authenticated using (public.is_provider_member(provider_id) or public.is_admin()) with check (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_price_confirmations_owner_select on public.provider_price_confirmations for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_price_confirmations_owner_insert on public.provider_price_confirmations for insert to authenticated with check (public.is_provider_member(provider_id));

create policy internal_sourcing_requests_target_or_admin_select on public.internal_sourcing_requests for select to authenticated using (public.is_admin() or exists (select 1 from public.internal_sourcing_request_items i join public.internal_sourcing_request_targets t on t.sourcing_request_item_id = i.id where i.sourcing_request_id = internal_sourcing_requests.id and public.is_provider_member(t.provider_id)));
create policy internal_sourcing_requests_admin_all on public.internal_sourcing_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy internal_sourcing_items_target_or_admin_select on public.internal_sourcing_request_items for select to authenticated using (public.is_admin() or exists (select 1 from public.internal_sourcing_request_targets t where t.sourcing_request_item_id = internal_sourcing_request_items.id and public.is_provider_member(t.provider_id)));
create policy internal_sourcing_items_admin_all on public.internal_sourcing_request_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy internal_sourcing_targets_owner_select on public.internal_sourcing_request_targets for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy internal_sourcing_targets_admin_all on public.internal_sourcing_request_targets for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy provider_pricing_responses_owner_select on public.provider_pricing_responses for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy provider_pricing_responses_owner_insert on public.provider_pricing_responses for insert to authenticated with check (public.is_provider_member(provider_id));
create policy provider_pricing_responses_owner_update on public.provider_pricing_responses for update to authenticated using (public.is_provider_member(provider_id)) with check (public.is_provider_member(provider_id) and status in ('evaluating','needs_update','rejected'));
create policy provider_availability_owner_select on public.provider_availability_confirmations for select to authenticated using (public.is_admin() or exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id)));
create policy provider_availability_owner_all on public.provider_availability_confirmations for all to authenticated using (exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id))) with check (exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id)));
create policy provider_delivery_owner_select on public.provider_delivery_confirmations for select to authenticated using (public.is_admin() or exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id)));
create policy provider_delivery_owner_all on public.provider_delivery_confirmations for all to authenticated using (exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id))) with check (exists (select 1 from public.provider_pricing_responses r where r.id = pricing_response_id and public.is_provider_member(r.provider_id)));

create policy internal_selection_results_admin_all on public.internal_selection_results for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy selected_provider_items_provider_or_admin_select on public.selected_provider_items for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy selected_provider_items_admin_write on public.selected_provider_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy bunya_customer_quotes_owner_select on public.bunya_customer_quotes for select to authenticated using (public.is_admin() or exists (select 1 from public.quote_requests r where r.id = customer_request_id and r.requester_id = auth.uid()));
create policy bunya_customer_quotes_owner_decision on public.bunya_customer_quotes for update to authenticated using (exists (select 1 from public.quote_requests r where r.id = customer_request_id and r.requester_id = auth.uid()) and status in ('ready','customer_review')) with check (status in ('accepted','rejected'));
create policy bunya_customer_quotes_admin_all on public.bunya_customer_quotes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy bunya_customer_quote_items_owner_select on public.bunya_customer_quote_items for select to authenticated using (public.is_admin() or exists (select 1 from public.bunya_customer_quotes q join public.quote_requests r on r.id = q.customer_request_id where q.id = bunya_customer_quote_id and r.requester_id = auth.uid()));
create policy bunya_customer_quote_items_admin_all on public.bunya_customer_quote_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy internal_fulfillment_provider_select on public.internal_fulfillment_orders for select to authenticated using (public.is_provider_member(provider_id) or public.is_admin());
create policy internal_fulfillment_provider_update on public.internal_fulfillment_orders for update to authenticated using (public.is_provider_member(provider_id)) with check (public.is_provider_member(provider_id));
create policy internal_fulfillment_admin_all on public.internal_fulfillment_orders for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy internal_fulfillment_items_provider_select on public.internal_fulfillment_order_items for select to authenticated using (public.is_admin() or exists (select 1 from public.internal_fulfillment_orders f where f.id = fulfillment_order_id and public.is_provider_member(f.provider_id)));
create policy internal_fulfillment_items_admin_all on public.internal_fulfillment_order_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Contractor workspace ownership, workflows, RLS and future private storage.
create or replace function public.is_contractor_owner(target_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.contractor_profiles c where c.id = target_contractor_id and c.profile_id = auth.uid());
$$;

create or replace function public.validate_contractor_milestone_transition()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('in_progress','awaiting_customer_approval','approved') and exists (
    select 1 from public.contractor_project_milestones previous
    where previous.project_id = new.project_id and previous.sort_order < new.sort_order and previous.status <> 'approved'
  ) then raise exception 'Previous project milestones must be approved first'; end if;
  if new.status = 'awaiting_customer_approval' and new.progress <> 100 then
    raise exception 'Milestone progress must be 100 before customer approval';
  end if;
  if new.status = 'approved' and new.approved_at is null then new.approved_at := now(); end if;
  return new;
end;
$$;

create or replace function public.prevent_early_contractor_project_completion()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and exists (select 1 from public.contractor_project_milestones m where m.project_id = new.id and m.status <> 'approved') then
    raise exception 'All project milestones must be approved before completion';
  end if;
  return new;
end;
$$;

create trigger contractor_services_updated_at before update on public.contractor_services for each row execute function public.set_updated_at();
create trigger project_requests_updated_at before update on public.project_requests for each row execute function public.set_updated_at();
create trigger contractor_opportunities_updated_at before update on public.contractor_opportunities for each row execute function public.set_updated_at();
create trigger contractor_proposals_updated_at before update on public.contractor_proposals for each row execute function public.set_updated_at();
create trigger contractor_projects_updated_at before update on public.contractor_projects for each row execute function public.set_updated_at();
create trigger contractor_milestones_updated_at before update on public.contractor_project_milestones for each row execute function public.set_updated_at();
create trigger contractor_milestones_validate before insert or update on public.contractor_project_milestones for each row execute function public.validate_contractor_milestone_transition();
create trigger contractor_projects_validate_completion before update of status on public.contractor_projects for each row execute function public.prevent_early_contractor_project_completion();
create trigger contractor_review_replies_updated_at before update on public.contractor_review_replies for each row execute function public.set_updated_at();
create trigger contractor_bank_accounts_updated_at before update on public.contractor_bank_accounts for each row execute function public.set_updated_at();
create trigger contractor_settlements_updated_at before update on public.contractor_settlement_requests for each row execute function public.set_updated_at();
create trigger contractor_support_tickets_updated_at before update on public.contractor_support_tickets for each row execute function public.set_updated_at();

alter table public.contractor_services enable row level security;
alter table public.contractor_service_regions enable row level security;
alter table public.contractor_availability enable row level security;
alter table public.project_requests enable row level security;
alter table public.project_request_specialties enable row level security;
alter table public.contractor_opportunities enable row level security;
alter table public.contractor_opportunity_matches enable row level security;
alter table public.contractor_proposals enable row level security;
alter table public.contractor_proposal_stages enable row level security;
alter table public.contractor_proposal_documents enable row level security;
alter table public.contractor_projects enable row level security;
alter table public.contractor_project_milestones enable row level security;
alter table public.contractor_project_updates enable row level security;
alter table public.contractor_project_documents enable row level security;
alter table public.contractor_portfolio_media enable row level security;
alter table public.contractor_reviews enable row level security;
alter table public.contractor_review_replies enable row level security;
alter table public.contractor_bank_accounts enable row level security;
alter table public.contractor_financial_transactions enable row level security;
alter table public.contractor_settlement_requests enable row level security;
alter table public.contractor_notifications enable row level security;
alter table public.contractor_support_tickets enable row level security;
alter table public.contractor_support_attachments enable row level security;

create policy contractor_profiles_owner_update on public.contractor_profiles for update to authenticated using (profile_id = auth.uid() or public.is_admin()) with check (profile_id = auth.uid() or public.is_admin());
create policy contractor_services_public_select on public.contractor_services for select to anon, authenticated using (status = 'active' and exists (select 1 from public.contractor_profiles c where c.id = contractor_profile_id and c.approval_status = 'approved' and c.subscription_active and c.directory_visible) or public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_services_owner_all on public.contractor_services for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_service_regions_public_select on public.contractor_service_regions for select to anon, authenticated using (exists (select 1 from public.contractor_services s where s.id = service_id and (s.status = 'active' or public.is_contractor_owner(s.contractor_profile_id) or public.is_admin())));
create policy contractor_service_regions_owner_all on public.contractor_service_regions for all to authenticated using (exists (select 1 from public.contractor_services s where s.id = service_id and (public.is_contractor_owner(s.contractor_profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_services s where s.id = service_id and (public.is_contractor_owner(s.contractor_profile_id) or public.is_admin())));
create policy contractor_availability_public_select on public.contractor_availability for select to anon, authenticated using (exists (select 1 from public.contractor_profiles c where c.id = contractor_profile_id and (c.approval_status = 'approved' or public.is_contractor_owner(c.id) or public.is_admin())));
create policy contractor_availability_owner_all on public.contractor_availability for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());

create policy project_requests_customer_all on public.project_requests for all to authenticated using (customer_profile_id = auth.uid() or public.is_admin()) with check (customer_profile_id = auth.uid() or public.is_admin());
create policy project_requests_matched_contractor_select on public.project_requests for select to authenticated using (exists (select 1 from public.contractor_opportunities o where o.project_request_id = project_requests.id and public.is_contractor_owner(o.contractor_profile_id)));
create policy project_request_specialties_participant_select on public.project_request_specialties for select to authenticated using (exists (select 1 from public.project_requests r where r.id = project_request_id and (r.customer_profile_id = auth.uid() or public.is_admin() or exists (select 1 from public.contractor_opportunities o where o.project_request_id = r.id and public.is_contractor_owner(o.contractor_profile_id)))));
create policy project_request_specialties_customer_all on public.project_request_specialties for all to authenticated using (exists (select 1 from public.project_requests r where r.id = project_request_id and (r.customer_profile_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.project_requests r where r.id = project_request_id and (r.customer_profile_id = auth.uid() or public.is_admin())));

create policy contractor_opportunities_owner_select on public.contractor_opportunities for select to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_opportunities_owner_update on public.contractor_opportunities for update to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_opportunities_admin_insert on public.contractor_opportunities for insert to authenticated with check (public.is_admin());
create policy contractor_matches_owner_select on public.contractor_opportunity_matches for select to authenticated using (public.is_admin() or exists (select 1 from public.contractor_opportunities o where o.id = opportunity_id and public.is_contractor_owner(o.contractor_profile_id)));
create policy contractor_matches_admin_all on public.contractor_opportunity_matches for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy contractor_proposals_contractor_all on public.contractor_proposals for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_proposals_customer_select on public.contractor_proposals for select to authenticated using (exists (select 1 from public.contractor_opportunities o join public.project_requests r on r.id = o.project_request_id where o.id = opportunity_id and r.customer_profile_id = auth.uid()));
create policy contractor_proposals_customer_decision on public.contractor_proposals for update to authenticated using (status in ('under_review','needs_changes') and exists (select 1 from public.contractor_opportunities o join public.project_requests r on r.id = o.project_request_id where o.id = opportunity_id and r.customer_profile_id = auth.uid())) with check (status in ('accepted','rejected','needs_changes'));
create policy contractor_proposal_stages_participant_select on public.contractor_proposal_stages for select to authenticated using (exists (select 1 from public.contractor_proposals p join public.contractor_opportunities o on o.id = p.opportunity_id join public.project_requests r on r.id = o.project_request_id where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or r.customer_profile_id = auth.uid() or public.is_admin())));
create policy contractor_proposal_stages_owner_all on public.contractor_proposal_stages for all to authenticated using (exists (select 1 from public.contractor_proposals p where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_proposals p where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin())));
create policy contractor_proposal_documents_participant_select on public.contractor_proposal_documents for select to authenticated using (exists (select 1 from public.contractor_proposals p join public.contractor_opportunities o on o.id = p.opportunity_id join public.project_requests r on r.id = o.project_request_id where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or r.customer_profile_id = auth.uid() or public.is_admin())));
create policy contractor_proposal_documents_owner_all on public.contractor_proposal_documents for all to authenticated using (exists (select 1 from public.contractor_proposals p where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_proposals p where p.id = proposal_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin())));

create policy contractor_projects_participant_select on public.contractor_projects for select to authenticated using (public.is_contractor_owner(contractor_profile_id) or customer_profile_id = auth.uid() or public.is_admin());
create policy contractor_projects_contractor_update on public.contractor_projects for update to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_projects_admin_insert on public.contractor_projects for insert to authenticated with check (public.is_admin());
create policy contractor_milestones_participant_select on public.contractor_project_milestones for select to authenticated using (exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or p.customer_profile_id = auth.uid() or public.is_admin())));
create policy contractor_milestones_contractor_all on public.contractor_project_milestones for all to authenticated using (exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or public.is_admin())));
create policy contractor_milestones_customer_approve on public.contractor_project_milestones for update to authenticated using (status = 'awaiting_customer_approval' and exists (select 1 from public.contractor_projects p where p.id = project_id and p.customer_profile_id = auth.uid())) with check (status in ('approved','awaiting_customer_approval'));
create policy contractor_project_updates_participant_select on public.contractor_project_updates for select to authenticated using (exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or p.customer_profile_id = auth.uid() or public.is_admin())));
create policy contractor_project_updates_owner_insert on public.contractor_project_updates for insert to authenticated with check ((public.is_contractor_owner(contractor_project_updates.contractor_profile_id) and exists (select 1 from public.contractor_projects p where p.id = project_id and p.contractor_profile_id = contractor_project_updates.contractor_profile_id)) or public.is_admin());
create policy contractor_project_documents_participant_select on public.contractor_project_documents for select to authenticated using (exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or p.customer_profile_id = auth.uid() or public.is_admin())));
create policy contractor_project_documents_participant_insert on public.contractor_project_documents for insert to authenticated with check ((uploaded_by = auth.uid() and exists (select 1 from public.contractor_projects p where p.id = project_id and (public.is_contractor_owner(p.contractor_profile_id) or p.customer_profile_id = auth.uid()))) or public.is_admin());

create policy contractor_portfolio_media_public_select on public.contractor_portfolio_media for select to anon, authenticated using (exists (select 1 from public.contractor_portfolio_items i join public.contractor_profiles c on c.id = i.profile_id where i.id = portfolio_item_id and ((i.is_visible and i.is_approved and c.approval_status = 'approved' and c.directory_visible) or public.is_contractor_owner(c.id) or public.is_admin())));
create policy contractor_portfolio_media_owner_all on public.contractor_portfolio_media for all to authenticated using (exists (select 1 from public.contractor_portfolio_items i where i.id = portfolio_item_id and (public.is_contractor_owner(i.profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_portfolio_items i where i.id = portfolio_item_id and (public.is_contractor_owner(i.profile_id) or public.is_admin())));
create policy contractor_portfolio_owner_all on public.contractor_portfolio_items for all to authenticated using (public.is_contractor_owner(profile_id) or public.is_admin()) with check (public.is_contractor_owner(profile_id) or public.is_admin());

create policy contractor_reviews_public_select on public.contractor_reviews for select to anon, authenticated using (exists (select 1 from public.contractor_profiles c where c.id = contractor_profile_id and c.approval_status = 'approved') or public.is_contractor_owner(contractor_profile_id) or customer_profile_id = auth.uid() or public.is_admin());
create policy contractor_reviews_customer_insert on public.contractor_reviews for insert to authenticated with check (customer_profile_id = auth.uid() and exists (select 1 from public.contractor_projects p where p.id = project_id and p.customer_profile_id = auth.uid() and p.status = 'completed'));
create policy contractor_reviews_customer_update on public.contractor_reviews for update to authenticated using (customer_profile_id = auth.uid() or public.is_admin()) with check (customer_profile_id = auth.uid() or public.is_admin());
create policy contractor_review_replies_public_select on public.contractor_review_replies for select to anon, authenticated using (true);
create policy contractor_review_replies_owner_all on public.contractor_review_replies for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());

create policy contractor_documents_profile_select on public.contractor_documents for select to authenticated using (contractor_profile_id is not null and (public.is_contractor_owner(contractor_profile_id) or public.is_admin()));
create policy contractor_documents_profile_all on public.contractor_documents for all to authenticated using (contractor_profile_id is not null and (public.is_contractor_owner(contractor_profile_id) or public.is_admin())) with check (contractor_profile_id is not null and (public.is_contractor_owner(contractor_profile_id) or public.is_admin()));
create policy contractor_bank_accounts_owner_all on public.contractor_bank_accounts for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_financial_owner_select on public.contractor_financial_transactions for select to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_financial_admin_all on public.contractor_financial_transactions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_settlements_owner_select on public.contractor_settlement_requests for select to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_settlements_owner_insert on public.contractor_settlement_requests for insert to authenticated with check (public.is_contractor_owner(contractor_profile_id));
create policy contractor_settlements_admin_update on public.contractor_settlement_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_notifications_owner_all on public.contractor_notifications for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_support_tickets_owner_all on public.contractor_support_tickets for all to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin()) with check (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_support_attachments_owner_all on public.contractor_support_attachments for all to authenticated using (exists (select 1 from public.contractor_support_tickets t where t.id = ticket_id and (public.is_contractor_owner(t.contractor_profile_id) or public.is_admin()))) with check (exists (select 1 from public.contractor_support_tickets t where t.id = ticket_id and (public.is_contractor_owner(t.contractor_profile_id) or public.is_admin())));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
  ('contractor-portfolio','contractor-portfolio',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']),
  ('contractor-project-documents','contractor-project-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']),
  ('contractor-support-attachments','contractor-support-attachments',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy contractor_workspace_storage_insert on storage.objects for insert to authenticated with check (bucket_id in ('contractor-portfolio','contractor-project-documents','contractor-support-attachments') and public.is_contractor_owner(((storage.foldername(name))[1])::uuid));
create policy contractor_workspace_storage_select on storage.objects for select to authenticated using (bucket_id in ('contractor-portfolio','contractor-project-documents','contractor-support-attachments') and (public.is_contractor_owner(((storage.foldername(name))[1])::uuid) or public.is_admin()));
create policy contractor_workspace_storage_update on storage.objects for update to authenticated using (bucket_id in ('contractor-portfolio','contractor-project-documents','contractor-support-attachments') and public.is_contractor_owner(((storage.foldername(name))[1])::uuid)) with check (bucket_id in ('contractor-portfolio','contractor-project-documents','contractor-support-attachments') and public.is_contractor_owner(((storage.foldername(name))[1])::uuid));
create policy contractor_workspace_storage_delete on storage.objects for delete to authenticated using (bucket_id in ('contractor-portfolio','contractor-project-documents','contractor-support-attachments') and (public.is_contractor_owner(((storage.foldername(name))[1])::uuid) or public.is_admin()));

-- Project contracting request cycle (file 017). project_requests remains the canonical table;
-- customer_project_requests and project_proposals are compatibility views, not duplicate stores.
create type public.project_request_lifecycle_status as enum ('draft','pending_admin_review','needs_customer_changes','published','receiving_proposals','under_customer_review','awarded','in_progress','completed','rejected','cancelled','expired');
create type public.project_comment_type as enum ('budget_change','duration_change','clarification','missing_drawings','technical_note','scope_suggestion','other');
create type public.project_comment_status as enum ('pending_admin_review','approved_for_customer','rejected_by_admin','needs_contractor_revision','accepted_by_customer','rejected_by_customer','customer_requested_clarification');
create type public.customer_change_decision_status as enum ('pending_customer_decision','accepted_by_customer','rejected_by_customer','customer_requested_clarification');

alter table public.project_requests
  alter column estimated_budget_min drop not null,
  add column lifecycle_status public.project_request_lifecycle_status not null default 'draft',
  add column other_project_type text,
  add column budget_negotiable boolean not null default false,
  add column duration_value numeric(10,2) check (duration_value is null or duration_value > 0),
  add column duration_unit text check (duration_unit is null or duration_unit in ('day','week','month','year','other')),
  add column custom_duration_unit text,
  add column location_name text,
  add column access_description text,
  add column technical_details jsonb not null default '{}'::jsonb,
  add column policy_acceptance_id uuid,
  add column admin_note text,
  add column submitted_at timestamptz,
  add column published_at timestamptz,
  add column cancelled_at timestamptz,
  add constraint project_requests_other_type_required check (project_type <> 'أخرى' or btrim(coalesce(other_project_type,'')) <> ''),
  add constraint project_requests_custom_duration_required check (duration_unit <> 'other' or btrim(coalesce(custom_duration_unit,'')) <> '');
create index project_requests_lifecycle_deadline_idx on public.project_requests (lifecycle_status, proposal_deadline_at);

create table public.customer_project_request_attachments (
  id uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 52428800),
  category text not null check (category in ('architectural','structural','electrical','plumbing','site_photos','bill_of_quantities','license','other')),
  is_contractor_visible boolean not null default true,
  uploaded_at timestamptz not null default now()
);
create index customer_project_attachments_request_idx on public.customer_project_request_attachments (project_request_id, category);

create table public.customer_project_request_versions (
  id bigint generated always as identity primary key,
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null,
  changed_by uuid references public.profiles (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (project_request_id, version_number)
);

create table public.contractor_project_comments (
  id uuid primary key default gen_random_uuid(),
  comment_code text not null unique,
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  contractor_profile_id uuid not null references public.contractor_profiles (id) on delete cascade,
  type public.project_comment_type not null,
  body text not null check (char_length(btrim(body)) >= 10),
  current_budget numeric(14,2),
  proposed_budget numeric(14,2) check (proposed_budget is null or proposed_budget > 0),
  current_duration text,
  proposed_duration text,
  reason text,
  requested_documents text[] not null default '{}',
  policy_acceptance_id uuid,
  status public.project_comment_status not null default 'pending_admin_review',
  admin_reason text,
  admin_note text,
  customer_decision_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_comment_budget_fields check (type <> 'budget_change' or (proposed_budget is not null and btrim(coalesce(reason,'')) <> '')),
  constraint project_comment_duration_fields check (type <> 'duration_change' or (btrim(coalesce(proposed_duration,'')) <> '' and btrim(coalesce(reason,'')) <> '')),
  constraint project_comment_documents_fields check (type <> 'missing_drawings' or cardinality(requested_documents) > 0)
);
create index contractor_project_comments_request_status_idx on public.contractor_project_comments (project_request_id, status, created_at desc);
create index contractor_project_comments_owner_idx on public.contractor_project_comments (contractor_profile_id, created_at desc);

create table public.contractor_project_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.contractor_project_comments (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create table public.admin_project_comment_reviews (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.contractor_project_comments (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  action text not null check (action in ('approved','rejected','revision_requested')),
  reason text,
  reviewed_at timestamptz not null default now(),
  constraint admin_comment_review_reason_required check (action = 'approved' or btrim(coalesce(reason,'')) <> '')
);
create index admin_project_comment_reviews_comment_idx on public.admin_project_comment_reviews (comment_id, reviewed_at desc);

create table public.customer_project_change_requests (
  id uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  comment_id uuid not null unique references public.contractor_project_comments (id) on delete cascade,
  type public.project_comment_type not null,
  current_value text not null,
  proposed_value text not null,
  reason text not null,
  admin_note text,
  old_snapshot jsonb not null default '{}'::jsonb,
  new_snapshot jsonb not null default '{}'::jsonb,
  status public.customer_change_decision_status not null default 'pending_customer_decision',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index customer_project_changes_request_status_idx on public.customer_project_change_requests (project_request_id, status, created_at desc);

create table public.customer_project_change_decisions (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null unique references public.customer_project_change_requests (id) on delete cascade,
  customer_profile_id uuid not null references public.profiles (id) on delete restrict,
  decision public.customer_change_decision_status not null check (decision <> 'pending_customer_decision'),
  note text,
  decided_at timestamptz not null default now()
);

alter table public.platform_policies
  add column active boolean not null default true,
  add column requires_acceptance boolean not null default false;

create table public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.platform_policies (id) on delete restrict,
  policy_version integer not null check (policy_version > 0),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  user_role public.user_role not null,
  context_type text not null check (context_type in ('project_request','project_comment','proposal','admin_review')),
  context_id uuid not null,
  accepted_at timestamptz not null default now(),
  unique (policy_id, policy_version, profile_id, context_type, context_id)
);
alter table public.project_requests add constraint project_requests_policy_acceptance_fk foreign key (policy_acceptance_id) references public.policy_acceptances (id) on delete set null;
alter table public.contractor_project_comments add constraint contractor_comments_policy_acceptance_fk foreign key (policy_acceptance_id) references public.policy_acceptances (id) on delete set null;

create table public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  recipient_role public.user_role not null,
  recipient_profile_id uuid references public.profiles (id) on delete cascade,
  contractor_profile_id uuid references public.contractor_profiles (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_notification_recipient check ((recipient_role = 'contractor' and contractor_profile_id is not null) or (recipient_role <> 'contractor' and recipient_profile_id is not null))
);
create index project_notifications_recipient_idx on public.project_notifications (recipient_profile_id, contractor_profile_id, created_at desc);

create table public.project_audit_logs (
  id bigint generated always as identity primary key,
  project_request_id uuid not null references public.project_requests (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_role public.user_role not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index project_audit_logs_request_created_idx on public.project_audit_logs (project_request_id, created_at desc);

create or replace view public.customer_project_requests with (security_invoker = true) as select * from public.project_requests;
create or replace view public.customer_project_request_specialties with (security_invoker = true) as select project_request_id, specialty_name from public.project_request_specialties;
create or replace view public.project_proposals with (security_invoker = true) as select * from public.contractor_proposals;
create or replace view public.project_proposal_stages with (security_invoker = true) as select * from public.contractor_proposal_stages;
create or replace view public.contractor_published_project_opportunities as
select r.id as project_request_id,r.request_code,r.title,r.project_type,r.description,r.scope,r.city,r.region,r.quantity_label,r.estimated_budget_min,r.estimated_budget_max,r.budget_negotiable,r.expected_start_at,r.estimated_duration,r.duration_value,r.duration_unit,r.proposal_deadline_at,r.google_maps_url,r.latitude,r.longitude,r.terms,r.technical_details,r.published_at
from public.project_requests r
where r.lifecycle_status in ('published','receiving_proposals') and r.is_open and r.proposal_deadline_at > now();
revoke all on public.contractor_published_project_opportunities from anon;
grant select on public.contractor_published_project_opportunities to authenticated;

create or replace function public.snapshot_project_request_version()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare next_version integer;
begin
  if old is distinct from new then
    select coalesce(max(version_number),0)+1 into next_version from public.customer_project_request_versions where project_request_id = old.id;
    insert into public.customer_project_request_versions(project_request_id,version_number,snapshot,changed_by,change_reason)
    values(old.id,next_version,to_jsonb(old),auth.uid(),'Project request update');
  end if;
  return new;
end;
$$;
create trigger project_requests_snapshot_before_update before update on public.project_requests for each row execute function public.snapshot_project_request_version();

create or replace function public.validate_project_comment_customer_visibility()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'approved_for_customer' and (new.reviewed_by is null or new.reviewed_at is null) then raise exception 'Admin review is required before customer visibility'; end if;
  return new;
end;
$$;
create trigger contractor_project_comments_validate before insert or update on public.contractor_project_comments for each row execute function public.validate_project_comment_customer_visibility();
create trigger contractor_project_comments_updated_at before update on public.contractor_project_comments for each row execute function public.set_updated_at();

alter table public.customer_project_request_attachments enable row level security;
alter table public.customer_project_request_versions enable row level security;
alter table public.contractor_project_comments enable row level security;
alter table public.contractor_project_comment_attachments enable row level security;
alter table public.admin_project_comment_reviews enable row level security;
alter table public.customer_project_change_requests enable row level security;
alter table public.customer_project_change_decisions enable row level security;
alter table public.policy_acceptances enable row level security;
alter table public.project_notifications enable row level security;
alter table public.project_audit_logs enable row level security;

drop policy if exists project_requests_matched_contractor_select on public.project_requests;
create policy customer_project_attachments_owner_select on public.customer_project_request_attachments for select to authenticated using (public.is_admin() or exists (select 1 from public.project_requests r where r.id = project_request_id and r.customer_profile_id = auth.uid()));
create policy customer_project_attachments_owner_all on public.customer_project_request_attachments for all to authenticated using (exists (select 1 from public.project_requests r where r.id = project_request_id and r.customer_profile_id = auth.uid() and r.lifecycle_status in ('draft','needs_customer_changes')) or public.is_admin()) with check (exists (select 1 from public.project_requests r where r.id = project_request_id and r.customer_profile_id = auth.uid() and r.lifecycle_status in ('draft','needs_customer_changes')) or public.is_admin());
create policy customer_project_versions_owner_select on public.customer_project_request_versions for select to authenticated using (public.is_admin() or exists (select 1 from public.project_requests r where r.id = project_request_id and r.customer_profile_id = auth.uid()));

create policy contractor_project_comments_owner_select on public.contractor_project_comments for select to authenticated using (public.is_contractor_owner(contractor_profile_id) or public.is_admin());
create policy contractor_project_comments_owner_insert on public.contractor_project_comments for insert to authenticated with check (public.is_contractor_owner(contractor_profile_id) and status = 'pending_admin_review' and exists (select 1 from public.project_requests r where r.id = project_request_id and r.lifecycle_status in ('published','receiving_proposals') and r.proposal_deadline_at > now()));
create policy contractor_project_comments_owner_revision on public.contractor_project_comments for update to authenticated using (public.is_contractor_owner(contractor_profile_id) and status = 'needs_contractor_revision') with check (public.is_contractor_owner(contractor_profile_id) and status = 'pending_admin_review');
create policy contractor_project_comments_admin_all on public.contractor_project_comments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contractor_comment_attachments_owner_all on public.contractor_project_comment_attachments for all to authenticated using (public.is_admin() or exists (select 1 from public.contractor_project_comments c where c.id = comment_id and public.is_contractor_owner(c.contractor_profile_id))) with check (public.is_admin() or exists (select 1 from public.contractor_project_comments c where c.id = comment_id and public.is_contractor_owner(c.contractor_profile_id)));
create policy admin_comment_reviews_admin_all on public.admin_project_comment_reviews for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customer_changes_customer_select on public.customer_project_change_requests for select to authenticated using (public.is_admin() or exists (select 1 from public.project_requests r where r.id = project_request_id and r.customer_profile_id = auth.uid()));
create policy customer_changes_contractor_decision_select on public.customer_project_change_requests for select to authenticated using (exists (select 1 from public.contractor_project_comments c where c.id = comment_id and public.is_contractor_owner(c.contractor_profile_id)));
create policy customer_changes_admin_all on public.customer_project_change_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy customer_change_decisions_owner_insert on public.customer_project_change_decisions for insert to authenticated with check (customer_profile_id = auth.uid() and exists (select 1 from public.customer_project_change_requests cr join public.project_requests r on r.id = cr.project_request_id where cr.id = change_request_id and r.customer_profile_id = auth.uid()));
create policy customer_change_decisions_participant_select on public.customer_project_change_decisions for select to authenticated using (customer_profile_id = auth.uid() or public.is_admin() or exists (select 1 from public.customer_project_change_requests cr join public.contractor_project_comments c on c.id = cr.comment_id where cr.id = change_request_id and public.is_contractor_owner(c.contractor_profile_id)));

create policy policy_acceptances_owner_select on public.policy_acceptances for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy policy_acceptances_owner_insert on public.policy_acceptances for insert to authenticated with check (profile_id = auth.uid());
create policy project_notifications_owner_all on public.project_notifications for all to authenticated using (public.is_admin() or recipient_profile_id = auth.uid() or (contractor_profile_id is not null and public.is_contractor_owner(contractor_profile_id))) with check (public.is_admin() or recipient_profile_id = auth.uid() or (contractor_profile_id is not null and public.is_contractor_owner(contractor_profile_id)));
create policy project_audit_logs_admin_select on public.project_audit_logs for select to authenticated using (public.is_admin());
create policy project_audit_logs_admin_insert on public.project_audit_logs for insert to authenticated with check (public.is_admin());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
('project-request-attachments','project-request-attachments',false,52428800,array['application/pdf','application/zip','application/x-zip-compressed','application/acad','application/dwg','image/vnd.dwg','image/vnd.dxf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy project_request_storage_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'project-request-attachments' and auth.uid()::text = (storage.foldername(name))[1]);
create policy project_request_storage_owner_select on storage.objects for select to authenticated using (bucket_id = 'project-request-attachments' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));
create policy project_request_storage_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'project-request-attachments' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

comment on view public.contractor_published_project_opportunities is 'Privacy-safe contractor projection; deliberately excludes customer profile, label, mobile, email, username and contact data.';
comment on table public.project_requests is 'Canonical contracting project request. Do not expose customer_profile_id or customer_label to contractors; use contractor_published_project_opportunities.';

-- TODO(contractor-project-service): create opportunities, accepted-project records and initial
-- financial transactions in idempotent privileged transactions after the backend is connected.
-- Provider-owned driver accounts and delivery confirmation domain.
create type public.provider_driver_status as enum ('active','suspended','must_change_password');
create type public.provider_delivery_status as enum ('assigned','picked_up','in_transit','arrived','delivered','failed_delivery');
create type public.delivery_confirmation_method as enum ('driver','provider');

create table public.provider_drivers (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  full_name text not null,
  mobile text not null,
  email text not null check (email = lower(email)),
  username text not null check (username = lower(username)),
  status public.provider_driver_status not null default 'must_change_password',
  must_change_password boolean not null default true,
  internal_notes text,
  failed_code_attempts integer not null default 0 check (failed_code_attempts >= 0),
  violations integer not null default 0 check (violations >= 0),
  last_active_at timestamptz,
  created_by_provider_id uuid not null references public.providers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id,email), unique(provider_id,mobile), unique(provider_id,username),
  constraint provider_driver_creator_owns check (provider_id = created_by_provider_id)
);
create table public.provider_driver_accounts (
  driver_id uuid primary key references public.provider_drivers(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  force_password_change_at timestamptz,
  sessions_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Future session metadata only. Supabase Auth remains authoritative; no password or token is stored.
create table public.provider_driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.provider_drivers(id) on delete cascade,
  auth_session_id text,
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.provider_delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  assigned_driver_id uuid references public.provider_drivers(id) on delete restrict,
  status public.provider_delivery_status not null default 'assigned',
  pickup_at timestamptz,
  expected_at timestamptz not null,
  delivered_at timestamptz,
  delivery_note text,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_assignment_delivery_time check (delivered_at is null or delivered_at >= created_at)
);
create table public.provider_delivery_updates (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.provider_delivery_assignments(id) on delete cascade,
  from_status public.provider_delivery_status,
  to_status public.provider_delivery_status not null,
  actor_role text not null check (actor_role in ('driver','provider','admin')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create table public.delivery_confirmation_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.provider_delivery_assignments(id) on delete cascade,
  method public.delivery_confirmation_method not null,
  confirmed_by_user_id uuid references public.profiles(id) on delete set null,
  confirmed_by_role text not null check (confirmed_by_role in ('driver','provider')),
  assigned_driver_id uuid references public.provider_drivers(id) on delete set null,
  delegate_name text,
  delivery_reference text,
  note text,
  confirmed_at timestamptz not null default now(),
  constraint confirmation_actor_shape check ((method='driver' and assigned_driver_id is not null and confirmed_by_role='driver') or (method='provider' and confirmed_by_role='provider'))
);
create table public.delivery_confirmation_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.provider_delivery_assignments(id) on delete cascade,
  attempted_by_role text not null check (attempted_by_role in ('driver','provider')),
  attempted_by_user_id uuid references public.profiles(id) on delete set null,
  succeeded boolean not null,
  locked_until timestamptz,
  attempted_at timestamptz not null default now()
);
create table public.admin_driver_actions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.provider_drivers(id) on delete restrict,
  admin_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
alter table public.delivery_assignments alter column driver_profile_id drop not null;
alter table public.delivery_assignments add column provider_driver_id uuid references public.provider_drivers(id) on delete restrict;

create index provider_drivers_provider_status_idx on public.provider_drivers(provider_id,status,created_at desc);
create index provider_driver_sessions_driver_active_idx on public.provider_driver_sessions(driver_id,revoked_at,last_active_at desc);
create index provider_delivery_assignments_driver_status_idx on public.provider_delivery_assignments(assigned_driver_id,status,expected_at);
create index provider_delivery_assignments_provider_status_idx on public.provider_delivery_assignments(provider_id,status,expected_at);
create index provider_delivery_updates_assignment_time_idx on public.provider_delivery_updates(assignment_id,created_at desc);
create index delivery_confirmation_attempts_assignment_idx on public.delivery_confirmation_attempts(assignment_id,attempted_at desc);
create index admin_driver_actions_driver_time_idx on public.admin_driver_actions(driver_id,created_at desc);

create or replace function public.current_provider_driver_id()
returns uuid language sql stable security definer set search_path=public as $$
  select pda.driver_id from public.provider_driver_accounts pda where pda.auth_user_id=auth.uid()
$$;
create or replace function public.validate_provider_delivery_assignment()
returns trigger language plpgsql as $$
begin
  if not exists(select 1 from public.orders o where o.id=new.order_id and o.provider_id=new.provider_id) then raise exception 'Delivery provider must own the order'; end if;
  if new.assigned_driver_id is not null and not exists(select 1 from public.provider_drivers d where d.id=new.assigned_driver_id and d.provider_id=new.provider_id and d.status<>'suspended') then raise exception 'Driver must be active and owned by provider'; end if;
  if tg_op='UPDATE' and old.status<>'assigned' and new.assigned_driver_id is distinct from old.assigned_driver_id then raise exception 'Assignment cannot change after delivery starts'; end if;
  return new;
end $$;
create or replace function public.validate_provider_delivery_transition()
returns trigger language plpgsql as $$
begin
  if old.status<>new.status and not ((old.status='assigned' and new.status in ('picked_up','failed_delivery')) or (old.status='picked_up' and new.status in ('in_transit','failed_delivery')) or (old.status='in_transit' and new.status in ('arrived','failed_delivery')) or (old.status='arrived' and new.status in ('delivered','failed_delivery'))) then raise exception 'Invalid provider delivery transition'; end if;
  if new.status='delivered' and new.delivered_at is null then new.delivered_at=now(); end if;
  return new;
end $$;
create trigger provider_delivery_assignment_owner before insert or update on public.provider_delivery_assignments for each row execute function public.validate_provider_delivery_assignment();
create trigger provider_delivery_assignment_transition before update on public.provider_delivery_assignments for each row execute function public.validate_provider_delivery_transition();
create trigger provider_drivers_updated_at before update on public.provider_drivers for each row execute function public.set_updated_at();
create trigger provider_driver_accounts_updated_at before update on public.provider_driver_accounts for each row execute function public.set_updated_at();
create trigger provider_delivery_assignments_updated_at before update on public.provider_delivery_assignments for each row execute function public.set_updated_at();

alter table public.provider_drivers enable row level security;
alter table public.provider_driver_accounts enable row level security;
alter table public.provider_driver_sessions enable row level security;
alter table public.provider_delivery_assignments enable row level security;
alter table public.provider_delivery_updates enable row level security;
alter table public.delivery_confirmation_records enable row level security;
alter table public.delivery_confirmation_attempts enable row level security;
alter table public.admin_driver_actions enable row level security;
create policy provider_drivers_provider_manage on public.provider_drivers for all to authenticated using (public.is_provider_member(provider_id)) with check (public.is_provider_member(provider_id) and created_by_provider_id=provider_id);
create policy provider_drivers_self_read on public.provider_drivers for select to authenticated using (id=public.current_provider_driver_id());
create policy provider_drivers_admin_read on public.provider_drivers for select to authenticated using (public.is_admin());
create policy provider_drivers_admin_update on public.provider_drivers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy provider_driver_accounts_provider_read on public.provider_driver_accounts for select to authenticated using (exists(select 1 from public.provider_drivers d where d.id=driver_id and public.is_provider_member(d.provider_id)) or driver_id=public.current_provider_driver_id() or public.is_admin());
create policy provider_driver_accounts_provider_manage on public.provider_driver_accounts for all to authenticated using (exists(select 1 from public.provider_drivers d where d.id=driver_id and public.is_provider_member(d.provider_id))) with check (exists(select 1 from public.provider_drivers d where d.id=driver_id and public.is_provider_member(d.provider_id)));
create policy provider_driver_sessions_participant_read on public.provider_driver_sessions for select to authenticated using (driver_id=public.current_provider_driver_id() or exists(select 1 from public.provider_drivers d where d.id=driver_id and public.is_provider_member(d.provider_id)) or public.is_admin());
create policy provider_assignments_provider_manage on public.provider_delivery_assignments for all to authenticated using (public.is_provider_member(provider_id)) with check (public.is_provider_member(provider_id));
create policy provider_assignments_driver_read on public.provider_delivery_assignments for select to authenticated using (assigned_driver_id=public.current_provider_driver_id());
create policy provider_assignments_driver_update on public.provider_delivery_assignments for update to authenticated using (assigned_driver_id=public.current_provider_driver_id()) with check (assigned_driver_id=public.current_provider_driver_id());
create policy provider_assignments_customer_read on public.provider_delivery_assignments for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and o.customer_profile_id=auth.uid()));
create policy provider_assignments_admin_read on public.provider_delivery_assignments for select to authenticated using (public.is_admin());
create policy provider_delivery_updates_participant_read on public.provider_delivery_updates for select to authenticated using (exists(select 1 from public.provider_delivery_assignments a join public.orders o on o.id=a.order_id where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id() or o.customer_profile_id=auth.uid() or public.is_admin())));
create policy provider_delivery_updates_actor_insert on public.provider_delivery_updates for insert to authenticated with check (exists(select 1 from public.provider_delivery_assignments a where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id() or public.is_admin())));
create policy delivery_confirmations_participant_read on public.delivery_confirmation_records for select to authenticated using (exists(select 1 from public.provider_delivery_assignments a join public.orders o on o.id=a.order_id where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id() or o.customer_profile_id=auth.uid() or public.is_admin())));
create policy delivery_confirmations_actor_insert on public.delivery_confirmation_records for insert to authenticated with check (exists(select 1 from public.provider_delivery_assignments a where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id())));
create policy delivery_attempts_internal_read on public.delivery_confirmation_attempts for select to authenticated using (exists(select 1 from public.provider_delivery_assignments a where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id() or public.is_admin())));
create policy delivery_attempts_actor_insert on public.delivery_confirmation_attempts for insert to authenticated with check (exists(select 1 from public.provider_delivery_assignments a where a.id=assignment_id and (public.is_provider_member(a.provider_id) or a.assigned_driver_id=public.current_provider_driver_id())));
create policy admin_driver_actions_admin_all on public.admin_driver_actions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_driver_actions_provider_read on public.admin_driver_actions for select to authenticated using (exists(select 1 from public.provider_drivers d where d.id=driver_id and public.is_provider_member(d.provider_id)));

-- TODO(driver-auth): create Auth users and provider_driver_accounts in a privileged provider-scoped backend; never store passwords in public tables.
-- TODO(delivery-code-rpc): verify code hashes, lock attempts and finalize orders in one rate-limited server transaction.
-- Central administration domain. The UI remains local-only until Supabase is connected.
create type public.admin_role_key as enum ('super_admin','operations_admin','finance_admin','support_admin','review_admin','read_only_auditor');
create type public.admin_alert_priority as enum ('low','medium','high','critical');
create type public.admin_work_status as enum ('open','in_progress','resolved','reopened','blocked','completed','failed');
create type public.admin_decision_outcome as enum ('approved','rejected','needs_changes','suspended','archived','overridden');

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  role_key public.admin_role_key not null unique,
  name_ar text not null,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique check (permission_key ~ '^[a-z0-9_.:-]+$'),
  name_ar text not null,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive','critical')),
  created_at timestamptz not null default now()
);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  role_id uuid not null references public.admin_roles(id) on delete restrict,
  is_active boolean not null default true,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  title text not null,
  description text not null,
  priority public.admin_alert_priority not null default 'medium',
  status public.admin_work_status not null default 'open',
  source_entity text not null,
  source_id text not null,
  assigned_admin_id uuid references public.admin_users(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_alert_resolution check (status <> 'resolved' or (btrim(coalesce(resolution_note,'')) <> '' and resolved_at is not null))
);
create table public.admin_operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null,
  operation_id text not null,
  event_type text not null,
  actor_role text not null,
  status public.admin_work_status not null default 'open',
  occurred_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  details jsonb not null default '{}'::jsonb,
  retry_of uuid references public.admin_operation_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  outcome public.admin_decision_outcome not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.admin_overrides (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  entity_type text not null,
  entity_id text not null,
  override_type text not null,
  reason text not null check (btrim(reason) <> ''),
  previous_value jsonb,
  override_value jsonb not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_override_expiry check (expires_at is null or expires_at > created_at)
);

create table public.join_request_reviews (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  request_kind text not null check (request_kind in ('provider','contractor')),
  request_id uuid not null,
  outcome public.application_status not null,
  reason text not null check (btrim(reason) <> ''),
  duplicate_check jsonb not null default '{}'::jsonb,
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.product_review_decisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  outcome public.product_review_status not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.sourcing_reviews (
  id uuid primary key default gen_random_uuid(),
  sourcing_request_id uuid not null references public.internal_sourcing_requests(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  action text not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.bunya_quote_reviews (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.bunya_customer_quotes(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  action text not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.order_admin_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  action text not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  delivery_assignment_id uuid references public.delivery_assignments(id) on delete set null,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  incident_type text not null,
  severity public.admin_alert_priority not null,
  status public.admin_work_status not null default 'open',
  reason text not null check (btrim(reason) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_request_reviews (
  id uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references public.project_requests(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  outcome public.admin_decision_outcome not null,
  reason text not null check (btrim(reason) <> ''),
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.project_comment_reviews (
  id uuid primary key default gen_random_uuid(),
  project_comment_id uuid not null references public.contractor_project_comments(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  outcome public.admin_decision_outcome not null,
  reason text not null check (btrim(reason) <> ''),
  policy_version text,
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.settlement_reviews (
  id uuid primary key default gen_random_uuid(),
  settlement_kind text not null check (settlement_kind in ('provider','contractor')),
  settlement_id uuid not null,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  action text not null,
  reason text not null check (btrim(reason) <> ''),
  transfer_reference text,
  proof_metadata jsonb,
  before_data jsonb,
  after_data jsonb,
  reviewed_at timestamptz not null default now()
);
create table public.support_assignments (
  id uuid primary key default gen_random_uuid(),
  ticket_kind text not null check (ticket_kind in ('customer','provider','contractor','driver')),
  ticket_id uuid not null,
  assigned_admin_id uuid not null references public.admin_users(id) on delete restrict,
  assigned_by uuid not null references public.admin_users(id) on delete restrict,
  reason text not null check (btrim(reason) <> ''),
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);
create table public.platform_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.platform_policies(id) on delete set null,
  policy_key text not null,
  title text not null,
  version integer not null check (version > 0),
  content text not null,
  status text not null default 'draft' check (status in ('draft','published','inactive')),
  target_roles public.user_role[] not null default '{}',
  requires_acceptance boolean not null default false,
  effective_at timestamptz,
  created_by uuid not null references public.admin_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (policy_key, version),
  constraint published_policy_immutable_shape check (status <> 'published' or (published_at is not null and effective_at is not null))
);
create table public.platform_settings (
  setting_key text primary key check (setting_key ~ '^[a-z0-9_.:-]+$'),
  section text not null,
  value jsonb not null,
  value_type text not null check (value_type in ('number','string','boolean','json')),
  validation_rules jsonb not null default '{}'::jsonb,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive','critical')),
  updated_by uuid references public.admin_users(id) on delete set null,
  change_reason text not null check (btrim(change_reason) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.audit_logs
  add column admin_user_id uuid references public.admin_users(id) on delete set null,
  add column reason text,
  add column sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive','critical')),
  add column result text not null default 'success' check (result in ('success','failed','denied')),
  add column ip_address inet,
  add column user_agent text;

create index admin_users_role_active_idx on public.admin_users(role_id,is_active);
create index admin_alerts_queue_idx on public.admin_alerts(status,priority,created_at desc);
create index admin_operations_lookup_idx on public.admin_operation_events(operation_type,operation_id,occurred_at desc);
create index admin_decisions_entity_idx on public.admin_decisions(entity_type,entity_id,created_at desc);
create index admin_overrides_entity_idx on public.admin_overrides(entity_type,entity_id,created_at desc);
create index join_reviews_request_idx on public.join_request_reviews(request_kind,request_id,reviewed_at desc);
create index product_decisions_product_idx on public.product_review_decisions(product_id,reviewed_at desc);
create index project_request_reviews_idx on public.project_request_reviews(project_request_id,reviewed_at desc);
create index project_comment_reviews_idx on public.project_comment_reviews(project_comment_id,reviewed_at desc);
create index settlement_reviews_lookup_idx on public.settlement_reviews(settlement_kind,settlement_id,reviewed_at desc);
create index platform_policy_versions_lookup_idx on public.platform_policy_versions(policy_key,version desc);
create index audit_logs_admin_time_idx on public.audit_logs(admin_user_id,occurred_at desc);

create or replace function public.admin_has_permission(requested_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (
    select 1 from public.admin_users au
    join public.admin_roles ar on ar.id = au.role_id
    where au.profile_id = auth.uid() and au.is_active
      and (ar.role_key = 'super_admin' or exists (
        select 1 from public.admin_role_permissions arp
        join public.admin_permissions ap on ap.id = arp.permission_id
        where arp.role_id = ar.id and ap.permission_key = requested_permission
      ))
  )
$$;
create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql as $$ begin raise exception 'Audit records are immutable'; end $$;
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.prevent_audit_mutation();
create trigger project_audit_logs_immutable before update or delete on public.project_audit_logs for each row execute function public.prevent_audit_mutation();
create or replace function public.protect_last_super_admin()
returns trigger language plpgsql as $$
declare old_key public.admin_role_key; new_key public.admin_role_key;
begin
  select role_key into old_key from public.admin_roles where id = old.role_id;
  select role_key into new_key from public.admin_roles where id = new.role_id;
  if old_key = 'super_admin' and (new_key <> 'super_admin' or not new.is_active) and
     (select count(*) from public.admin_users u join public.admin_roles r on r.id=u.role_id where r.role_key='super_admin' and u.is_active) <= 1
  then raise exception 'The last active Super Admin cannot be demoted or disabled'; end if;
  return new;
end $$;
create trigger admin_users_protect_super before update on public.admin_users for each row execute function public.protect_last_super_admin();
create trigger admin_roles_updated_at before update on public.admin_roles for each row execute function public.set_updated_at();
create trigger admin_users_updated_at before update on public.admin_users for each row execute function public.set_updated_at();
create trigger admin_alerts_updated_at before update on public.admin_alerts for each row execute function public.set_updated_at();
create trigger delivery_incidents_updated_at before update on public.delivery_incidents for each row execute function public.set_updated_at();
create trigger platform_settings_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();

alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_alerts enable row level security;
alter table public.admin_operation_events enable row level security;
alter table public.admin_decisions enable row level security;
alter table public.admin_overrides enable row level security;
alter table public.join_request_reviews enable row level security;
alter table public.product_review_decisions enable row level security;
alter table public.sourcing_reviews enable row level security;
alter table public.bunya_quote_reviews enable row level security;
alter table public.order_admin_actions enable row level security;
alter table public.delivery_incidents enable row level security;
alter table public.project_request_reviews enable row level security;
alter table public.project_comment_reviews enable row level security;
alter table public.settlement_reviews enable row level security;
alter table public.support_assignments enable row level security;
alter table public.platform_policy_versions enable row level security;
alter table public.platform_settings enable row level security;

create policy admin_roles_read on public.admin_roles for select to authenticated using (public.is_admin());
create policy admin_roles_super_manage on public.admin_roles for all to authenticated using (public.admin_has_permission('roles.manage')) with check (public.admin_has_permission('roles.manage'));
create policy admin_permissions_read on public.admin_permissions for select to authenticated using (public.is_admin());
create policy admin_permissions_super_manage on public.admin_permissions for all to authenticated using (public.admin_has_permission('roles.manage')) with check (public.admin_has_permission('roles.manage'));
create policy admin_role_permissions_read on public.admin_role_permissions for select to authenticated using (public.is_admin());
create policy admin_role_permissions_super_manage on public.admin_role_permissions for all to authenticated using (public.admin_has_permission('roles.manage')) with check (public.admin_has_permission('roles.manage'));
create policy admin_users_read on public.admin_users for select to authenticated using (public.is_admin());
create policy admin_users_super_manage on public.admin_users for all to authenticated using (public.admin_has_permission('admins.manage')) with check (public.admin_has_permission('admins.manage'));
create policy admin_alerts_manage on public.admin_alerts for all to authenticated using (public.admin_has_permission('operations.manage')) with check (public.admin_has_permission('operations.manage'));
create policy admin_operations_read on public.admin_operation_events for select to authenticated using (public.is_admin());
create policy admin_operations_manage on public.admin_operation_events for all to authenticated using (public.admin_has_permission('operations.manage')) with check (public.admin_has_permission('operations.manage'));
create policy admin_decisions_read on public.admin_decisions for select to authenticated using (public.is_admin());
create policy admin_decisions_insert on public.admin_decisions for insert to authenticated with check (public.admin_has_permission('decisions.create') and admin_user_id in (select id from public.admin_users where profile_id=auth.uid()));
create policy admin_overrides_read on public.admin_overrides for select to authenticated using (public.is_admin());
create policy admin_overrides_insert on public.admin_overrides for insert to authenticated with check (public.admin_has_permission('overrides.create') and admin_user_id in (select id from public.admin_users where profile_id=auth.uid()));
create policy join_reviews_manage on public.join_request_reviews for all to authenticated using (public.admin_has_permission('reviews.manage')) with check (public.admin_has_permission('reviews.manage'));
create policy product_reviews_manage on public.product_review_decisions for all to authenticated using (public.admin_has_permission('reviews.manage')) with check (public.admin_has_permission('reviews.manage'));
create policy sourcing_reviews_manage on public.sourcing_reviews for all to authenticated using (public.admin_has_permission('sourcing.manage')) with check (public.admin_has_permission('sourcing.manage'));
create policy bunya_quote_reviews_manage on public.bunya_quote_reviews for all to authenticated using (public.admin_has_permission('sourcing.manage')) with check (public.admin_has_permission('sourcing.manage'));
create policy order_admin_actions_manage on public.order_admin_actions for all to authenticated using (public.admin_has_permission('orders.manage')) with check (public.admin_has_permission('orders.manage'));
create policy delivery_incidents_manage on public.delivery_incidents for all to authenticated using (public.admin_has_permission('deliveries.manage')) with check (public.admin_has_permission('deliveries.manage'));
create policy project_request_reviews_manage on public.project_request_reviews for all to authenticated using (public.admin_has_permission('projects.manage')) with check (public.admin_has_permission('projects.manage'));
create policy project_comment_reviews_manage on public.project_comment_reviews for all to authenticated using (public.admin_has_permission('reviews.manage')) with check (public.admin_has_permission('reviews.manage'));
create policy settlement_reviews_manage on public.settlement_reviews for all to authenticated using (public.admin_has_permission('finance.manage')) with check (public.admin_has_permission('finance.manage'));
create policy support_assignments_manage on public.support_assignments for all to authenticated using (public.admin_has_permission('support.manage')) with check (public.admin_has_permission('support.manage'));
create policy policy_versions_read on public.platform_policy_versions for select to authenticated using (public.is_admin());
create policy policy_versions_manage on public.platform_policy_versions for all to authenticated using (public.admin_has_permission('policies.manage')) with check (public.admin_has_permission('policies.manage'));
create policy platform_settings_read on public.platform_settings for select to authenticated using (public.is_admin());
create policy platform_settings_manage on public.platform_settings for all to authenticated using (public.admin_has_permission('settings.manage')) with check (public.admin_has_permission('settings.manage'));

-- TODO(admin-backend): seed the first Super Admin and permission matrix in a privileged deployment step.
-- TODO(admin-network-audit): populate trusted IP/User-Agent values server-side; client values are not authoritative.
-- TODO(admin-jobs): move SLA alerts, retries, schedules and notification dispatch to idempotent workers.
-- TODO(contractor-payments): connect a compliant payment provider; never store card data here.
-- TODO(contractor-files): scan uploads and issue short-lived signed URLs before production use.

-- TODO(sourcing-service): run eligibility/selection and quote assembly in one privileged,
-- idempotent transaction after inventory reservations and service calendars are authoritative.
-- TODO(price-freshness-job): schedule a trusted job to materialize expiring_soon/expired labels;
-- all selection queries must still compare expires_at with now() and never trust the label alone.
-- TODO(customer-quote-margin): the commercial markup/commission policy for the Bunya-owned quote
-- is intentionally undecided; current schema stores the final customer-facing amounts only.

-- TODO(backend): add an anti-abuse protected RPC/Edge Function for unauthenticated
-- provider and contractor applications. Direct anonymous inserts intentionally remain denied.
-- TODO(maps): resolve maps.app.goo.gl and goo.gl/maps redirects on the server before storing
-- coordinates; never infer latitude/longitude from a shortened link.
-- TODO(auth): configure Supabase Auth email/SMS recovery and redirect URLs. Do not create
-- password or reset-token columns in public tables.
-- TODO(contact): expose contractor phone/email through an explicit consent/contact flow rather
-- than granting anonymous clients unrestricted column access when the application is connected.
-- TODO(payments): payment provider identifiers and webhook idempotency fields remain undecided.
-- TODO(storage): if AV scanning is introduced, add scan status fields and quarantine policies.
-- TODO(provider-auth): map approved provider applications to providers/provider_members in a
-- privileged onboarding transaction after Supabase Auth is connected.
-- TODO(provider-storage): issue short-lived signed URLs for customer access to approved product
-- images and quote attachments; direct bucket access intentionally remains private.
-- TODO(finance): settlement transfers, commission rules, tax invoices and payment webhooks require
-- an idempotent privileged backend before any financial state is treated as authoritative.
-- TODO(audit): add privileged audit triggers once the final admin workflow and retention policy are approved.
-- TODO(customer-payments): connect a PCI-compliant payment gateway through idempotent server
-- webhooks; payment_records must never contain PAN, CVV, card tokens intended for clients, or secrets.
-- TODO(customer-delivery-code): generate delivery codes server-side and expose the plaintext to the
-- owning customer through a short-lived protected channel; persist only the hash and attempts.
-- TODO(customer-quote-eligibility): extend eligibility with authoritative stock reservations,
-- geospatial delivery coverage and service calendars when inventory and logistics services exist.

commit;
