-- Only identity/permission services and unrelated catalog/profile columns are fixtures.
-- The runner loads financial tables and lifecycle functions directly from migrations.
create schema auth;
create schema extensions;
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function public.admin_has_permission(text) returns boolean language sql stable as $$
  select coalesce(current_setting('fixture.admin',true)='true',false)
$$;
create function public.is_admin() returns boolean language sql stable as $$ select public.admin_has_permission('any') $$;
create function public.is_provider_member(uuid) returns boolean language sql stable as $$
  select $1::text=current_setting('fixture.provider',true)
$$;
create function extensions.digest(text,text) returns bytea language sql immutable as $$
  select case when $2='sha256' then sha256(convert_to($1,'UTF8')) else null end
$$;
create table public.profiles(id uuid primary key default gen_random_uuid());
create table public.providers(
  id uuid primary key default gen_random_uuid(), company_name text not null,
  status text not null default 'approved',platform_commission_rate numeric(5,2) not null default 0
    check(platform_commission_rate between 0 and 100),updated_at timestamptz default now()
);
create table public.products(id uuid primary key default gen_random_uuid(),name text not null);
create table public.provider_product_prices(id uuid primary key default gen_random_uuid());
create table public.quote_requests(
  id uuid primary key default gen_random_uuid(),requester_id uuid references public.profiles(id),
  city text default 'Riyadh',desired_receipt_at timestamptz default now()+interval '2 days',
  google_maps_url text,latitude numeric(9,6),longitude numeric(9,6),notes text,
  status public.quote_request_status default 'sourcing',updated_at timestamptz default now()
);
create table public.quote_request_items(
  id uuid primary key default gen_random_uuid(),request_id uuid references public.quote_requests(id),
  product_id uuid references public.products(id),product_name_snapshot text not null,
  quantity numeric(14,3) not null,unit_name_snapshot text default 'piece',measurement_label_snapshot text
);
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(),actor_profile_id uuid,provider_id uuid,
  entity_table text,entity_id text,action text,old_data jsonb,new_data jsonb
);
create table public.settlement_requests(
  id uuid primary key default gen_random_uuid(),provider_id uuid references public.providers(id),
  amount numeric(14,2),status text
);
