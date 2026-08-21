begin;

-- Consolidated forward-only reconciliation for the connected E2E failures.
-- This migration is intentionally data-preserving and does not execute cleanup.

do $$
declare
  v_missing text;
begin
  select string_agg(required.object_name, ', ' order by required.object_name)
  into v_missing
  from (
    values
      ('public.audit_logs'),
      ('public.contractor_financial_transactions'),
      ('public.contractor_opportunities'),
      ('public.contractor_portfolio_items'),
      ('public.contractor_profiles'),
      ('public.contractor_proposals'),
      ('public.contractor_services'),
      ('public.contractor_settlement_requests'),
      ('public.contractor_workflow_idempotency'),
      ('public.customer_profiles'),
      ('public.internal_sourcing_requests'),
      ('public.notifications'),
      ('public.outbox_events'),
      ('public.project_audit_logs'),
      ('public.project_requests'),
      ('public.quote_requests'),
      ('auth.users')
  ) as required(object_name)
  where to_regclass(required.object_name) is null;

  if v_missing is not null then
    raise exception '018 missing required relations: %', v_missing;
  end if;

  select string_agg(required.table_name || '.' || required.column_name, ', ' order by required.table_name, required.column_name)
  into v_missing
  from (
    values
      ('audit_logs', 'actor_profile_id'),
      ('audit_logs', 'contractor_profile_id'),
      ('audit_logs', 'new_data'),
      ('audit_logs', 'old_data'),
      ('contractor_financial_transactions', 'contractor_profile_id'),
      ('contractor_financial_transactions', 'metadata'),
      ('contractor_financial_transactions', 'reference'),
      ('contractor_portfolio_items', 'deleted_at'),
      ('contractor_portfolio_items', 'is_approved'),
      ('contractor_portfolio_items', 'is_visible'),
      ('contractor_portfolio_items', 'profile_id'),
      ('contractor_portfolio_items', 'review_status'),
      ('contractor_profiles', 'approval_status'),
      ('contractor_profiles', 'directory_visible'),
      ('contractor_profiles', 'profile_id'),
      ('contractor_profiles', 'subscription_active'),
      ('contractor_settlement_requests', 'contractor_profile_id'),
      ('contractor_settlement_requests', 'idempotency_key'),
      ('contractor_settlement_requests', 'notes'),
      ('notifications', 'event_key'),
      ('project_audit_logs', 'actor_profile_id'),
      ('project_audit_logs', 'new_value'),
      ('project_audit_logs', 'old_value'),
      ('project_audit_logs', 'project_request_id'),
      ('project_requests', 'lifecycle_status'),
      ('quote_requests', 'status')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception '018 missing required columns: %', v_missing;
  end if;

  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'auth.users'::regclass
      and a.attname in ('email', 'raw_user_meta_data')
      and not a.attisdropped
    group by a.attrelid
    having count(*) = 2
  ) then
    raise exception '018 requires auth.users email and raw_user_meta_data';
  end if;

  if to_regtype('public.quote_request_status') is null
    or to_regtype('public.quote_processing_stage') is null
    or to_regtype('public.contractor_opportunity_status') is null
    or to_regtype('public.contractor_proposal_status') is null
    or to_regtype('public.project_request_lifecycle_status') is null
  then
    raise exception '018 requires the commerce and contractor workflow enum types';
  end if;

  if exists (
    select 1
    from (
      values
        ('quote_request_status', 'sourcing'),
        ('quote_request_status', 'verifying'),
        ('quote_processing_stage', 'comparing_prices'),
        ('quote_processing_stage', 'verifying_availability'),
        ('contractor_opportunity_status', 'new'),
        ('contractor_opportunity_status', 'proposed'),
        ('contractor_proposal_status', 'draft'),
        ('contractor_proposal_status', 'under_review'),
        ('contractor_proposal_status', 'needs_changes'),
        ('project_request_lifecycle_status', 'receiving_proposals')
    ) as required(type_name, enum_label)
    where not exists (
      select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
        and t.typname = required.type_name
        and e.enumlabel = required.enum_label
    )
  ) then
    raise exception '018 enum labels do not match the current business workflow';
  end if;

  if to_regprocedure('public.submit_customer_rfq(jsonb,jsonb,text)') is null
    or to_regprocedure('public.submit_customer_project_request(jsonb,text[],text)') is null
    or to_regprocedure('public.save_contractor_service(uuid,jsonb,text[],boolean)') is null
    or to_regprocedure('public.save_contractor_portfolio_item(uuid,jsonb,boolean)') is null
    or to_regprocedure('public.review_contractor_catalog_item(text,uuid,text,text)') is null
    or to_regprocedure('public.save_contractor_proposal(uuid,jsonb,jsonb,boolean,text)') is null
    or to_regprocedure('public.is_contractor_owner(uuid)') is null
    or to_regprocedure('public.is_admin()') is null
  then
    raise exception '018 required function signatures do not match migrations 005-008';
  end if;
end
$$;

-- PostgREST upsert can infer a full unique index, but not the previous partial
-- event_key index. Nullable unique indexes already permit multiple NULL values.
do $$
begin
  if exists (
    select event_key
    from public.notifications
    where event_key is not null
    group by event_key
    having count(*) > 1
  ) then
    raise exception '018 cannot reconcile notifications.event_key because duplicates exist';
  end if;
end
$$;

drop index if exists public.notifications_event_key_idx;
create unique index notifications_event_key_idx
  on public.notifications (event_key);

-- RFQ: CASE expressions resolve as text, so cast the complete expressions to
-- the enum columns that exist in the current schema.
create or replace function public.submit_customer_rfq(
  p_request jsonb,
  p_items jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_source uuid;
  v_source_item uuid;
  v_deadline timestamptz;
  v_required timestamptz;
  v_city text;
  v_count integer := 0;
  v_added integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from public.customer_profiles where profile_id = auth.uid()) then
    raise exception 'Verified customer required';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'Invalid idempotency key';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Invalid items';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':rfq:' || p_idempotency_key, 0));
  select aggregate_id
  into v_id
  from public.outbox_events
  where aggregate_type = 'quote_request'
    and idempotency_key = 'rfq:' || auth.uid() || ':' || p_idempotency_key
  limit 1;
  if found then
    return v_id;
  end if;

  v_city := btrim(p_request ->> 'city');
  v_required := (p_request ->> 'desired_receipt_at')::timestamptz;
  v_deadline := least(v_required - interval '1 hour', now() + interval '24 hours');
  if length(v_city) < 2 or v_required <= now() + interval '2 hours' then
    raise exception 'Invalid request schedule';
  end if;

  insert into public.quote_requests(
    request_code, requester_id, requester_role, city, location_hint,
    desired_receipt_at, quote_window_label, quote_deadline, notes, status,
    delivery_mode, project_name, recipient_name, recipient_mobile
  )
  values (
    'RFQ-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    auth.uid(), 'customer', v_city, btrim(coalesce(p_request ->> 'location_hint', v_city)),
    v_required, '24 hours', v_deadline, nullif(btrim(p_request ->> 'notes'), ''), 'submitted',
    case when p_request ->> 'delivery_mode' = 'pickup' then 'pickup' else 'delivery' end,
    nullif(btrim(p_request ->> 'project_name'), ''),
    nullif(btrim(p_request ->> 'recipient_name'), ''),
    nullif(btrim(p_request ->> 'recipient_mobile'), '')
  )
  returning id into v_id;

  insert into public.internal_sourcing_requests(
    internal_code, customer_request_id, stage, expected_ready_at, response_deadline_at
  )
  values (
    'SRC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_id, 'received', least(v_required, now() + interval '48 hours'), v_deadline
  )
  returning id into v_source;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'Invalid item quantity';
    end if;

    insert into public.quote_request_items(
      request_id, product_id, measurement_id, unit_id, product_name_snapshot,
      measurement_label_snapshot, unit_name_snapshot, quantity, notes
    )
    select
      v_id, p.id, nullif(v_item ->> 'measurement_id', '')::uuid,
      nullif(v_item ->> 'unit_id', '')::uuid, p.name,
      nullif(btrim(v_item ->> 'measurement'), ''),
      coalesce(nullif(btrim(v_item ->> 'unit'), ''), p.base_unit),
      (v_item ->> 'quantity')::numeric, nullif(btrim(v_item ->> 'notes'), '')
    from public.products p
    where p.id = (v_item ->> 'product_id')::uuid
      and p.is_published
      and p.review_status = 'approved'
    returning id into v_item_id;

    if v_item_id is null then
      raise exception 'Product is not available';
    end if;

    insert into public.internal_sourcing_request_items(
      sourcing_request_id, quote_request_item_id, product_id, quantity,
      unit_snapshot, measurement_snapshot, delivery_region, required_at
    )
    select
      v_source, v_item_id, i.product_id, i.quantity, i.unit_name_snapshot,
      i.measurement_label_snapshot, v_city, v_required
    from public.quote_request_items i
    where i.id = v_item_id
    returning id into v_source_item;

    insert into public.internal_sourcing_request_targets(
      sourcing_request_item_id, provider_id, response_deadline_at
    )
    select v_source_item, p.id, v_deadline
    from public.providers p
    join public.provider_product_prices pp
      on pp.provider_id = p.id
      and pp.product_id = (v_item ->> 'product_id')::uuid
    join public.subscriptions s
      on s.profile_id = p.owner_profile_id
      and s.status = 'active'
      and (s.ends_at is null or s.ends_at > now())
    where p.status = 'approved'
      and pp.expires_at > now()
      and pp.freshness_status in ('valid', 'expiring_soon')
      and (
        p.application_id is null
        or exists (
          select 1
          from public.provider_delivery_regions r
          where r.application_id = p.application_id
            and lower(r.region_name) = lower(v_city)
        )
        or p_request ->> 'delivery_mode' = 'pickup'
      )
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;

  update public.quote_requests
  set status = (
    case when v_count > 0 then 'sourcing' else 'verifying' end
  )::public.quote_request_status
  where id = v_id;

  update public.internal_sourcing_requests
  set stage = (
    case when v_count > 0 then 'comparing_prices' else 'verifying_availability' end
  )::public.quote_processing_stage
  where id = v_source;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  values (
    'quote_request', v_id,
    case when v_count > 0 then 'rfq.submitted' else 'admin.rfq_no_providers' end,
    jsonb_build_object('sourcing_request_id', v_source),
    'rfq:' || auth.uid() || ':' || p_idempotency_key
  );

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  select
    'sourcing_target', t.sourcing_request_item_id, 'provider.rfq_new',
    jsonb_build_object('provider_id', t.provider_id, 'sourcing_item_id', t.sourcing_request_item_id),
    'rfq-target:' || t.sourcing_request_item_id || ':' || t.provider_id
  from public.internal_sourcing_request_targets t
  join public.internal_sourcing_request_items i on i.id = t.sourcing_request_item_id
  where i.sourcing_request_id = v_source
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return v_id;
end
$$;

-- Catalog submissions use a deterministic review revision. Different entities
-- cannot collide, and an exact retry cannot create another event for a revision.
create or replace function public.save_contractor_service(
  p_id uuid,
  p_service jsonb,
  p_regions text[],
  p_submit boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contractor uuid;
  v_id uuid;
  v_pricing public.contractor_pricing_method;
  v_review text;
  v_revision bigint;
begin
  select id into v_contractor
  from public.contractor_profiles
  where profile_id = auth.uid()
  limit 1;
  if v_contractor is null then
    raise exception 'Contractor profile required';
  end if;
  if length(btrim(p_service ->> 'title')) not between 3 and 160
    or length(btrim(p_service ->> 'description')) < 10
    or length(btrim(p_service ->> 'specialty')) < 2
    or length(btrim(p_service ->> 'estimated_duration')) < 2
    or cardinality(p_regions) not between 1 and 30
  then
    raise exception 'Invalid service';
  end if;

  v_pricing := (p_service ->> 'pricing_method')::public.contractor_pricing_method;
  v_review := case when p_submit then 'pending_review' else 'draft' end;

  if p_id is null then
    insert into public.contractor_services(
      contractor_profile_id, name, title, primary_specialty, description,
      pricing_method, minimum_price, maximum_price, estimated_duration,
      status, is_active, review_status
    )
    values (
      v_contractor, btrim(p_service ->> 'title'), btrim(p_service ->> 'title'),
      btrim(p_service ->> 'specialty'), btrim(p_service ->> 'description'),
      v_pricing, nullif(p_service ->> 'minimum_price', '')::numeric,
      nullif(p_service ->> 'maximum_price', '')::numeric,
      btrim(p_service ->> 'estimated_duration'), 'pending_review',
      coalesce((p_service ->> 'is_active')::boolean, true), v_review
    )
    returning id into v_id;
  else
    update public.contractor_services
    set name = btrim(p_service ->> 'title'),
        title = btrim(p_service ->> 'title'),
        primary_specialty = btrim(p_service ->> 'specialty'),
        description = btrim(p_service ->> 'description'),
        pricing_method = v_pricing,
        minimum_price = nullif(p_service ->> 'minimum_price', '')::numeric,
        maximum_price = nullif(p_service ->> 'maximum_price', '')::numeric,
        estimated_duration = btrim(p_service ->> 'estimated_duration'),
        is_active = coalesce((p_service ->> 'is_active')::boolean, true),
        review_status = v_review,
        review_notes = null,
        status = 'pending_review',
        updated_at = now()
    where id = p_id
      and contractor_profile_id = v_contractor
      and deleted_at is null
      and review_status in ('draft', 'rejected', 'needs_changes', 'approved')
    returning id into v_id;
    if v_id is null then
      raise exception 'Service cannot be edited';
    end if;
  end if;

  delete from public.contractor_service_regions where service_id = v_id;
  insert into public.contractor_service_regions(service_id, region_name)
  select v_id, btrim(x)
  from unnest(p_regions) x
  where btrim(x) <> ''
  on conflict do nothing;

  if p_submit then
    select count(*) into v_revision
    from public.audit_logs
    where entity_table = 'contractor_services'
      and entity_id = v_id::text
      and action like 'service_review_%';

    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, payload, idempotency_key
    )
    values (
      'contractor_service', v_id, 'admin.contractor_service_submitted',
      jsonb_build_object('contractor_id', v_contractor),
      'service-submit:' || v_id || ':revision:' || v_revision
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;
  return v_id;
end
$$;

create or replace function public.save_contractor_portfolio_item(
  p_id uuid,
  p_item jsonb,
  p_submit boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contractor uuid;
  v_id uuid;
  v_review text;
  v_revision bigint;
begin
  select id into v_contractor
  from public.contractor_profiles
  where profile_id = auth.uid()
  limit 1;
  if v_contractor is null then
    raise exception 'Contractor profile required';
  end if;
  if length(btrim(p_item ->> 'title')) not between 3 and 160
    or length(btrim(p_item ->> 'description')) < 10
    or length(btrim(p_item ->> 'project_type')) < 2
  then
    raise exception 'Invalid portfolio item';
  end if;

  v_review := case when p_submit then 'pending_review' else 'draft' end;
  if p_id is null then
    insert into public.contractor_portfolio_items(
      profile_id, title, description, project_type, completion_date, city,
      region, is_visible, is_approved, review_status, sort_order
    )
    values (
      v_contractor, btrim(p_item ->> 'title'), btrim(p_item ->> 'description'),
      btrim(p_item ->> 'project_type'), nullif(p_item ->> 'completion_date', '')::date,
      nullif(btrim(p_item ->> 'city'), ''), nullif(btrim(p_item ->> 'region'), ''),
      coalesce((p_item ->> 'visibility')::boolean, false), false, v_review,
      greatest(0, coalesce((p_item ->> 'sort_order')::integer, 0))
    )
    returning id into v_id;
  else
    update public.contractor_portfolio_items
    set title = btrim(p_item ->> 'title'),
        description = btrim(p_item ->> 'description'),
        project_type = btrim(p_item ->> 'project_type'),
        completion_date = nullif(p_item ->> 'completion_date', '')::date,
        city = nullif(btrim(p_item ->> 'city'), ''),
        region = nullif(btrim(p_item ->> 'region'), ''),
        is_visible = coalesce((p_item ->> 'visibility')::boolean, false),
        is_approved = false,
        review_status = v_review,
        review_notes = null,
        sort_order = greatest(0, coalesce((p_item ->> 'sort_order')::integer, 0)),
        updated_at = now()
    where id = p_id
      and profile_id = v_contractor
      and deleted_at is null
      and review_status in ('draft', 'rejected', 'needs_changes', 'approved')
    returning id into v_id;
    if v_id is null then
      raise exception 'Portfolio item cannot be edited';
    end if;
  end if;

  if p_submit then
    select count(*) into v_revision
    from public.audit_logs
    where entity_table = 'contractor_portfolio_items'
      and entity_id = v_id::text
      and action like 'portfolio_review_%';

    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, payload, idempotency_key
    )
    values (
      'contractor_portfolio', v_id, 'admin.contractor_portfolio_submitted',
      jsonb_build_object('contractor_id', v_contractor),
      'portfolio-submit:' || v_id || ':revision:' || v_revision
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;
  return v_id;
end
$$;

create or replace function public.review_contractor_catalog_item(
  p_kind text,
  p_id uuid,
  p_decision text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contractor uuid;
  v_old text;
  v_audit_id bigint;
begin
  if not public.admin_has_permission('reviews.manage')
    or p_kind not in ('service', 'portfolio')
    or p_decision not in ('approved', 'rejected', 'needs_changes')
    or length(btrim(p_notes)) < 5
  then
    raise exception 'Invalid or unauthorized review';
  end if;

  if p_kind = 'service' then
    select contractor_profile_id, review_status
    into v_contractor, v_old
    from public.contractor_services
    where id = p_id and deleted_at is null
    for update;
    if not found then
      raise exception 'Service not found';
    end if;
    update public.contractor_services
    set review_status = p_decision,
        review_notes = btrim(p_notes),
        status = case
          when p_decision = 'approved' and is_active then 'active'::public.contractor_service_status
          else 'hidden'::public.contractor_service_status
        end,
        updated_at = now()
    where id = p_id;
  else
    select profile_id, review_status
    into v_contractor, v_old
    from public.contractor_portfolio_items
    where id = p_id and deleted_at is null
    for update;
    if not found then
      raise exception 'Portfolio item not found';
    end if;
    update public.contractor_portfolio_items
    set review_status = p_decision,
        review_notes = btrim(p_notes),
        is_approved = (p_decision = 'approved'),
        updated_at = now()
    where id = p_id;
  end if;

  insert into public.audit_logs(
    actor_profile_id, contractor_profile_id, entity_table, entity_id,
    action, old_data, new_data
  )
  values (
    auth.uid(), v_contractor,
    case when p_kind = 'service' then 'contractor_services' else 'contractor_portfolio_items' end,
    p_id::text, p_kind || '_review_' || p_decision,
    jsonb_build_object('review_status', v_old),
    jsonb_build_object('review_status', p_decision, 'notes', btrim(p_notes))
  )
  returning id into v_audit_id;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  values (
    'contractor_' || p_kind, p_id, 'contractor.' || p_kind || '_' || p_decision,
    jsonb_build_object('contractor_id', v_contractor, 'notes', btrim(p_notes)),
    p_kind || '-review:' || p_id || ':' || p_decision || ':audit:' || v_audit_id
  );
end
$$;

-- Remove the temporary random-key workaround if migrations 013/016 were ever
-- applied. Source workflows now produce stable, entity-scoped keys.
drop trigger if exists outbox_contractor_catalog_unique_key on public.outbox_events;

-- Portfolio: qualify the outer profile_id so the correlated subquery does not
-- resolve both sides to contractor_profiles columns.
drop policy if exists contractor_portfolio_public_read on public.contractor_portfolio_items;
create policy contractor_portfolio_public_read
on public.contractor_portfolio_items
for select
to anon, authenticated
using (
  deleted_at is null
  and (
    (
      is_visible
      and review_status = 'approved'
      and is_approved
      and exists (
        select 1
        from public.contractor_profiles profile
        where profile.id = contractor_portfolio_items.profile_id
          and profile.approval_status = 'approved'
          and profile.subscription_active
          and profile.directory_visible
      )
    )
    or public.is_contractor_owner(contractor_portfolio_items.profile_id)
    or public.is_admin()
  )
);

-- Project request: SELECT literals must be explicitly typed for the enum target.
create or replace function public.submit_customer_project_request(
  p_request jsonb,
  p_specialties text[],
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_deadline timestamptz;
  v_count integer := 0;
begin
  if auth.uid() is null
    or not exists (select 1 from public.customer_profiles where profile_id = auth.uid())
  then
    raise exception 'Verified customer required';
  end if;
  if length(p_idempotency_key) not between 8 and 120
    or cardinality(p_specialties) not between 1 and 20
  then
    raise exception 'Invalid request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':project:' || p_idempotency_key, 0));
  select entity_id into v_id
  from public.contractor_workflow_idempotency
  where profile_id = auth.uid()
    and scope = 'project_request'
    and key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  v_deadline := (p_request ->> 'proposal_deadline_at')::timestamptz;
  if v_deadline <= now() + interval '1 hour' then
    raise exception 'Invalid deadline';
  end if;

  insert into public.project_requests(
    request_code, customer_profile_id, title, project_type, description, scope,
    city, region, quantity_label, estimated_budget_min, estimated_budget_max,
    expected_start_at, estimated_duration, proposal_deadline_at, minimum_rating,
    customer_label, terms, is_open, lifecycle_status, submitted_at, published_at,
    budget_negotiable, duration_value, duration_unit, location_name,
    access_description, technical_details
  )
  values (
    'PRJ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    auth.uid(), btrim(p_request ->> 'title'), btrim(p_request ->> 'project_type'),
    btrim(p_request ->> 'description'), btrim(p_request ->> 'scope'),
    btrim(p_request ->> 'city'), btrim(p_request ->> 'region'),
    nullif(btrim(p_request ->> 'quantity_label'), ''),
    nullif(p_request ->> 'budget_min', '')::numeric,
    (p_request ->> 'budget_max')::numeric,
    (p_request ->> 'expected_start_at')::date,
    btrim(p_request ->> 'estimated_duration'), v_deadline,
    nullif(p_request ->> 'minimum_rating', '')::numeric,
    'عميل بُنية',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_request -> 'terms', '[]'))), '{}'),
    true, 'receiving_proposals'::public.project_request_lifecycle_status,
    now(), now(), coalesce((p_request ->> 'budget_negotiable')::boolean, false),
    nullif(p_request ->> 'duration_value', '')::numeric,
    nullif(p_request ->> 'duration_unit', ''),
    nullif(btrim(p_request ->> 'location_name'), ''),
    nullif(btrim(p_request ->> 'access_description'), ''),
    coalesce(p_request -> 'technical_details', '{}')
  )
  returning id into v_id;

  insert into public.project_request_specialties(project_request_id, specialty_name)
  select v_id, btrim(x)
  from unnest(p_specialties) x
  where btrim(x) <> ''
  on conflict do nothing;

  insert into public.contractor_opportunities(
    project_request_id, contractor_profile_id, status, expires_at
  )
  select distinct
    v_id, c.id, 'new'::public.contractor_opportunity_status, v_deadline
  from public.contractor_profiles c
  join public.contractor_profile_regions r on r.profile_id = c.id
  join public.contractor_profile_specialties s on s.profile_id = c.id
  join public.contractor_availability a
    on a.contractor_profile_id = c.id and a.status = 'available'
  where c.approval_status = 'approved'
    and c.subscription_active
    and lower(r.region_name) = lower(p_request ->> 'region')
    and lower(s.specialty_name) = any (select lower(x) from unnest(p_specialties) x)
    and c.average_rating >= coalesce(nullif(p_request ->> 'minimum_rating', '')::numeric, 0)
  on conflict do nothing;
  get diagnostics v_count = row_count;

  insert into public.contractor_opportunity_matches(
    opportunity_id, specialty_matched, region_matched, account_approved,
    availability_matched, rating_matched, eligible, reasons
  )
  select id, true, true, true, true, true, true, '{}'
  from public.contractor_opportunities
  where project_request_id = v_id
  on conflict (opportunity_id) do nothing;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  select
    'contractor_opportunity', o.id, 'contractor.opportunity_new',
    jsonb_build_object('contractor_profile_id', o.contractor_profile_id),
    'contractor-opportunity:' || o.id
  from public.contractor_opportunities o
  where o.project_request_id = v_id
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  if v_count = 0 then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, payload, idempotency_key
    )
    values (
      'project_request', v_id, 'admin.project_no_contractors', '{}',
      'project-no-contractors:' || v_id
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  insert into public.contractor_workflow_idempotency(
    profile_id, scope, key, entity_id, created_at
  )
  values (auth.uid(), 'project_request', p_idempotency_key, v_id, now());
  return v_id;
end
$$;

-- Proposal submission now consumes its supplied idempotency key. Resubmission
-- after needs_changes receives a distinct key while an exact retry returns the
-- original proposal without a second outbox event.
create or replace function public.save_contractor_proposal(
  p_opportunity_id uuid,
  p_proposal jsonb,
  p_stages jsonb,
  p_submit boolean,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_contractor uuid;
  v_opportunity public.contractor_opportunities%rowtype;
  v_id uuid;
  v_stage jsonb;
  v_status public.contractor_proposal_status;
begin
  if auth.uid() is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'Invalid proposal idempotency key';
  end if;
  select id into v_contractor
  from public.contractor_profiles
  where profile_id = auth.uid()
    and approval_status = 'approved'
    and subscription_active
  limit 1;
  if v_contractor is null then
    raise exception 'Active contractor required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':proposal:' || p_idempotency_key, 0));
  select entity_id into v_id
  from public.contractor_workflow_idempotency
  where profile_id = auth.uid()
    and scope = 'contractor_proposal'
    and key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  select * into v_opportunity
  from public.contractor_opportunities
  where id = p_opportunity_id
    and contractor_profile_id = v_contractor
  for update;
  if not found or v_opportunity.expires_at <= now() then
    raise exception 'Opportunity unavailable';
  end if;
  if p_submit and (jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) = 0) then
    raise exception 'Proposal stages required';
  end if;
  v_status := (
    case when p_submit then 'under_review' else 'draft' end
  )::public.contractor_proposal_status;

  insert into public.contractor_proposals(
    proposal_code, opportunity_id, contractor_profile_id, amount, vat_inclusive,
    execution_duration, proposed_start_at, scope_details, includes, excludes,
    valid_until, warranty, team, notes, policy_accepted, status, submitted_at
  )
  values (
    'CP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    p_opportunity_id, v_contractor, coalesce((p_proposal ->> 'amount')::numeric, 0),
    coalesce((p_proposal ->> 'vat_inclusive')::boolean, false),
    nullif(btrim(p_proposal ->> 'execution_duration'), ''),
    nullif(p_proposal ->> 'proposed_start_at', '')::date,
    nullif(btrim(p_proposal ->> 'scope_details'), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_proposal -> 'includes', '[]'))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_proposal -> 'excludes', '[]'))), '{}'),
    nullif(p_proposal ->> 'valid_until', '')::timestamptz,
    nullif(btrim(p_proposal ->> 'warranty'), ''),
    nullif(btrim(p_proposal ->> 'team'), ''),
    nullif(btrim(p_proposal ->> 'notes'), ''),
    coalesce((p_proposal ->> 'policy_accepted')::boolean, false),
    v_status, case when p_submit then now() end
  )
  on conflict (opportunity_id, contractor_profile_id) do update
  set amount = excluded.amount,
      vat_inclusive = excluded.vat_inclusive,
      execution_duration = excluded.execution_duration,
      proposed_start_at = excluded.proposed_start_at,
      scope_details = excluded.scope_details,
      includes = excluded.includes,
      excludes = excluded.excludes,
      valid_until = excluded.valid_until,
      warranty = excluded.warranty,
      team = excluded.team,
      notes = excluded.notes,
      policy_accepted = excluded.policy_accepted,
      status = excluded.status,
      submitted_at = excluded.submitted_at,
      updated_at = now()
  where contractor_proposals.status in ('draft', 'needs_changes')
  returning id into v_id;

  if v_id is null then
    raise exception 'Proposal cannot be edited';
  end if;

  delete from public.contractor_proposal_stages where proposal_id = v_id;
  for v_stage in select value from jsonb_array_elements(p_stages)
  loop
    insert into public.contractor_proposal_stages(
      proposal_id, name, description, duration, value_percentage,
      expected_at, sort_order
    )
    values (
      v_id, btrim(v_stage ->> 'name'), btrim(v_stage ->> 'description'),
      btrim(v_stage ->> 'duration'), (v_stage ->> 'value_percentage')::numeric,
      (v_stage ->> 'expected_at')::date,
      coalesce((v_stage ->> 'sort_order')::integer, 0)
    );
  end loop;

  update public.contractor_opportunities
  set status = case
        when p_submit then 'proposed'::public.contractor_opportunity_status
        else status
      end,
      updated_at = now()
  where id = p_opportunity_id;

  if p_submit then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, payload, idempotency_key
    )
    values (
      'contractor_proposal', v_id, 'contractor.proposal_submitted', '{}',
      'proposal-submitted:' || v_id || ':' || p_idempotency_key
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  insert into public.contractor_workflow_idempotency(
    profile_id, scope, key, entity_id, created_at
  )
  values (auth.uid(), 'contractor_proposal', p_idempotency_key, v_id, now());
  return v_id;
end
$$;

-- Audit parents are anonymized through FK actions; direct audit mutations remain
-- forbidden. This preserves production history while allowing parent cleanup.
alter table public.project_audit_logs
  alter column project_request_id drop not null;

do $$
declare
  v_constraint record;
  v_attnum smallint;
begin
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'public.project_audit_logs'::regclass
    and attname = 'project_request_id'
    and not attisdropped;

  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.project_audit_logs'::regclass
      and c.confrelid = 'public.project_requests'::regclass
      and c.contype = 'f'
      and v_attnum = any (c.conkey)
  loop
    execute format(
      'alter table public.project_audit_logs drop constraint %I',
      v_constraint.conname
    );
  end loop;
end
$$;

alter table public.project_audit_logs
  add constraint project_audit_logs_project_request_id_fkey
  foreign key (project_request_id)
  references public.project_requests (id)
  on delete set null;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_run_id text := current_setting('bunya.e2e_cleanup_run_id', true);
begin
  if tg_op = 'DELETE'
    and coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and v_run_id ~ '^bunya-e2e-[A-Za-z0-9][A-Za-z0-9-]{5,120}$'
  then
    if tg_table_name = 'audit_logs'
      and (
        public.is_e2e_test_profile(nullif(v_old ->> 'actor_profile_id', '')::uuid, v_run_id)
        or exists (
          select 1
          from public.contractor_profiles cp
          where cp.id = nullif(v_old ->> 'contractor_profile_id', '')::uuid
            and public.is_e2e_test_profile(cp.profile_id, v_run_id)
        )
        or coalesce(v_old -> 'old_data', 'null'::jsonb)::text like '%' || v_run_id || '%'
        or coalesce(v_old -> 'new_data', 'null'::jsonb)::text like '%' || v_run_id || '%'
      )
    then
      return old;
    end if;

    if tg_table_name = 'project_audit_logs'
      and (
        public.is_e2e_test_profile(nullif(v_old ->> 'actor_profile_id', '')::uuid, v_run_id)
        or exists (
          select 1
          from public.project_requests pr
          where pr.id = nullif(v_old ->> 'project_request_id', '')::uuid
            and public.is_e2e_test_profile(pr.customer_profile_id, v_run_id)
        )
        or coalesce(v_old -> 'old_value', 'null'::jsonb)::text like '%' || v_run_id || '%'
        or coalesce(v_old -> 'new_value', 'null'::jsonb)::text like '%' || v_run_id || '%'
      )
    then
      return old;
    end if;
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if tg_table_name = 'audit_logs'
      and (v_old - array['actor_profile_id', 'provider_id', 'contractor_profile_id'])
        = (v_new - array['actor_profile_id', 'provider_id', 'contractor_profile_id'])
      and (v_new -> 'actor_profile_id' = v_old -> 'actor_profile_id' or v_new -> 'actor_profile_id' = 'null'::jsonb)
      and (v_new -> 'provider_id' = v_old -> 'provider_id' or v_new -> 'provider_id' = 'null'::jsonb)
      and (v_new -> 'contractor_profile_id' = v_old -> 'contractor_profile_id' or v_new -> 'contractor_profile_id' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;

    if tg_table_name = 'project_audit_logs'
      and (v_old - array['project_request_id', 'actor_profile_id'])
        = (v_new - array['project_request_id', 'actor_profile_id'])
      and (v_new -> 'project_request_id' = v_old -> 'project_request_id' or v_new -> 'project_request_id' = 'null'::jsonb)
      and (v_new -> 'actor_profile_id' = v_old -> 'actor_profile_id' or v_new -> 'actor_profile_id' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;
  end if;

  raise exception 'Audit records are immutable';
end
$$;

-- E2E cleanup guard. A row is considered an E2E profile only when both the
-- immutable run metadata and the reserved invalid.example address agree.
create or replace function public.is_e2e_test_profile(
  p_profile_id uuid,
  p_run_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_profile_id
      and u.email like 'e2e.%@invalid.example'
      and coalesce(u.raw_user_meta_data ->> 'e2e_run_id', '') ~ '^bunya-e2e-[A-Za-z0-9][A-Za-z0-9-]{5,120}$'
      and (
        p_run_id is null
        or u.raw_user_meta_data ->> 'e2e_run_id' = p_run_id
      )
  )
$$;

do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid)
  into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.oid = to_regprocedure('public.is_e2e_test_profile(uuid,text)');

  if to_regprocedure('public.is_e2e_test_profile(uuid,text)') is null
    or v_args is null
  then
    raise exception '018 cannot resolve is_e2e_test_profile identity arguments: %', v_args;
  end if;
end
$$;

revoke execute on function public.is_e2e_test_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.is_e2e_test_profile(uuid, text) to service_role;

-- Replace only the immutable triggers on E2E-touched financial tables. Real
-- rows remain immutable; service-role deletion is allowed only for verified
-- E2E profiles and run-tagged contractor finance rows.
create or replace function public.protect_contractor_financial_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  select profile_id into v_profile_id
  from public.contractor_profiles
  where id = old.contractor_profile_id;

  if tg_op = 'DELETE'
    and coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and public.is_e2e_test_profile(v_profile_id, null)
    and (
      coalesce(old.metadata ->> 'e2e_run_id', '') ~ '^bunya-e2e-'
      or coalesce(old.reference, '') ~ '^bunya-e2e-'
    )
  then
    return old;
  end if;

  raise exception 'Financial history is immutable';
end
$$;

drop trigger if exists contractor_financial_transactions_no_delete
  on public.contractor_financial_transactions;
drop trigger if exists contractor_financial_immutable
  on public.contractor_financial_transactions;
create trigger contractor_financial_immutable
before update or delete on public.contractor_financial_transactions
for each row
execute function public.protect_contractor_financial_history();

create or replace function public.protect_contractor_settlement_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  select profile_id into v_profile_id
  from public.contractor_profiles
  where id = old.contractor_profile_id;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and public.is_e2e_test_profile(v_profile_id, null)
    and (
      coalesce(old.idempotency_key, '') ~ '^bunya-e2e-'
      or coalesce(old.notes, '') ~ '^bunya-e2e-'
    )
  then
    return old;
  end if;

  raise exception 'Settlement history is immutable';
end
$$;

drop trigger if exists contractor_settlement_requests_no_delete
  on public.contractor_settlement_requests;
create trigger contractor_settlement_requests_no_delete
before delete on public.contractor_settlement_requests
for each row
execute function public.protect_contractor_settlement_history();

create or replace function public.protect_e2e_payment_record_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and public.is_e2e_test_profile(old.customer_profile_id, null)
    and (
      coalesce(old.gateway_reference, '') ~ '^bunya-e2e-'
      or coalesce(old.idempotency_key, '') ~ '^bunya-e2e-'
    )
  then
    return old;
  end if;
  raise exception 'Financial records are append-only and cannot be deleted';
end
$$;

drop trigger if exists payment_records_no_delete on public.payment_records;
create trigger payment_records_no_delete
before delete on public.payment_records
for each row
execute function public.protect_e2e_payment_record_delete();

create or replace function public.protect_e2e_invoice_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and public.is_e2e_test_profile(old.customer_profile_id, null)
  then
    return old;
  end if;
  raise exception 'Financial records are append-only and cannot be deleted';
end
$$;

drop trigger if exists invoices_no_delete on public.invoices;
create trigger invoices_no_delete
before delete on public.invoices
for each row
execute function public.protect_e2e_invoice_delete();

create or replace function public.protect_e2e_invoice_item_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  select customer_profile_id into v_profile_id
  from public.invoices
  where id = old.invoice_id;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    and public.is_e2e_test_profile(v_profile_id, null)
  then
    return old;
  end if;
  raise exception 'Financial records are append-only and cannot be deleted';
end
$$;

drop trigger if exists invoice_items_no_delete on public.invoice_items;
create trigger invoice_items_no_delete
before delete on public.invoice_items
for each row
execute function public.protect_e2e_invoice_item_delete();

do $$
declare
  v_bad_signature text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
  into v_bad_signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'protect_contractor_settlement_history',
      'protect_e2e_payment_record_delete',
      'protect_e2e_invoice_delete',
      'protect_e2e_invoice_item_delete'
    )
    and pg_get_function_identity_arguments(p.oid) <> '';

  if v_bad_signature is not null then
    raise exception '018 unexpected trigger function signatures: %', v_bad_signature;
  end if;
end
$$;

revoke execute on function public.protect_contractor_settlement_history() from public, anon, authenticated;
revoke execute on function public.protect_e2e_payment_record_delete() from public, anon, authenticated;
revoke execute on function public.protect_e2e_invoice_delete() from public, anon, authenticated;
revoke execute on function public.protect_e2e_invoice_item_delete() from public, anon, authenticated;

-- Optional trusted cleanup primitive for immutable E2E audit/finance rows. The
-- migration does not call it. It accepts one exact run id and service role only.
create or replace function public.cleanup_e2e_immutable_records(p_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_count integer;
  v_result jsonb := '{}'::jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    or p_run_id !~ '^bunya-e2e-[A-Za-z0-9][A-Za-z0-9-]{5,120}$'
  then
    raise exception 'Service role and a valid E2E run id are required';
  end if;

  perform set_config('bunya.e2e_cleanup_run_id', p_run_id, true);

  delete from public.project_audit_logs pal
  where exists (
      select 1
      from public.project_requests pr
      where pr.id = pal.project_request_id
        and public.is_e2e_test_profile(pr.customer_profile_id, p_run_id)
    )
    or public.is_e2e_test_profile(pal.actor_profile_id, p_run_id)
    or coalesce(pal.old_value::text, '') like '%' || p_run_id || '%'
    or coalesce(pal.new_value::text, '') like '%' || p_run_id || '%';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('project_audit_logs', v_count);

  delete from public.audit_logs al
  where public.is_e2e_test_profile(al.actor_profile_id, p_run_id)
    or exists (
      select 1
      from public.contractor_profiles cp
      where cp.id = al.contractor_profile_id
        and public.is_e2e_test_profile(cp.profile_id, p_run_id)
    )
    or coalesce(al.old_data::text, '') like '%' || p_run_id || '%'
    or coalesce(al.new_data::text, '') like '%' || p_run_id || '%';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('audit_logs', v_count);

  return v_result;
end
$$;

do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid)
  into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.oid = to_regprocedure('public.cleanup_e2e_immutable_records(text)');

  if to_regprocedure('public.cleanup_e2e_immutable_records(text)') is null
    or v_args is null
  then
    raise exception '018 cannot resolve cleanup_e2e_immutable_records identity arguments: %', v_args;
  end if;
end
$$;

revoke execute on function public.cleanup_e2e_immutable_records(text) from public, anon, authenticated;
grant execute on function public.cleanup_e2e_immutable_records(text) to service_role;

commit;
