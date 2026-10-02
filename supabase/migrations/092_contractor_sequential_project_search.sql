begin;

-- Current verified identity is checked at purchase/project command boundaries.
-- A historical customer role alone cannot retain a revoked professional exception.
create or replace function public.has_verified_customer_identity(p_profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles profile where profile.id=p_profile_id and profile.is_active and (
    exists(select 1 from auth.users account where account.id=profile.id and account.phone_confirmed_at is not null
      and ('+'||regexp_replace(coalesce(account.phone,''),'[^0-9]','','g')) ~ '^\+9665[0-9]{8}$')
    or exists(select 1 from public.user_roles role join public.provider_members member on member.profile_id=role.profile_id and member.is_active
      join public.providers provider on provider.id=member.provider_id and provider.status='approved'
      where role.profile_id=profile.id and role.role='provider' and role.revoked_at is null)
    or exists(select 1 from public.user_roles role join public.contractor_profiles contractor on contractor.profile_id=role.profile_id and contractor.approval_status='approved'
      where role.profile_id=profile.id and role.role='contractor' and role.revoked_at is null)
  ));
$$;
revoke all on function public.has_verified_customer_identity(uuid) from public,anon,authenticated,service_role;

-- Subscription is legacy account metadata, never eligibility or publication.
alter table public.contractor_profiles drop constraint contractor_profiles_directory_ready;
alter table public.contractor_profiles add constraint contractor_profiles_directory_ready check (
  not directory_visible or (approval_status='approved' and btrim(coalesce(city,''))<>''
    and btrim(coalesce(badge,''))<>'' and years_experience is not null and btrim(coalesce(summary,''))<>'')
);
-- Public eligibility exposes only a boolean, never account/contact fields.
create or replace function public.contractor_publicly_eligible(p_contractor_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.contractor_profiles contractor
    join public.profiles account on account.id=contractor.profile_id and account.is_active
    join public.user_roles role on role.profile_id=account.id and role.role='contractor' and role.revoked_at is null
    where contractor.id=p_contractor_id and contractor.approval_status='approved');
$$;
revoke all on function public.contractor_publicly_eligible(uuid) from public;
grant execute on function public.contractor_publicly_eligible(uuid) to anon,authenticated;
drop policy contractor_profiles_public_read on public.contractor_profiles;
create policy contractor_profiles_public_read on public.contractor_profiles for select to anon,authenticated
using (public.contractor_publicly_eligible(id) or public.is_admin() or profile_id=auth.uid());
drop policy contractor_profile_specialties_public_read on public.contractor_profile_specialties;
create policy contractor_profile_specialties_public_read on public.contractor_profile_specialties for select to anon,authenticated
using (exists(select 1 from public.contractor_profiles p where p.id=contractor_profile_specialties.profile_id and (public.contractor_publicly_eligible(p.id) or p.profile_id=auth.uid() or public.is_admin())));
drop policy contractor_profile_regions_public_read on public.contractor_profile_regions;
create policy contractor_profile_regions_public_read on public.contractor_profile_regions for select to anon,authenticated
using (exists(select 1 from public.contractor_profiles p where p.id=contractor_profile_regions.profile_id and (public.contractor_publicly_eligible(p.id) or p.profile_id=auth.uid() or public.is_admin())));
drop policy contractor_services_public_select on public.contractor_services;
create policy contractor_services_public_select on public.contractor_services for select to anon,authenticated
using (deleted_at is null and ((review_status='approved' and is_active and status='active' and exists(
  select 1 from public.contractor_profiles c where c.id=contractor_profile_id and public.contractor_publicly_eligible(c.id)
)) or public.is_contractor_owner(contractor_profile_id) or public.is_admin()));
drop policy contractor_portfolio_public_read on public.contractor_portfolio_items;
create policy contractor_portfolio_public_read on public.contractor_portfolio_items for select to anon,authenticated
using (deleted_at is null and ((is_visible and review_status='approved' and is_approved and exists(
  select 1 from public.contractor_profiles p where p.id=contractor_portfolio_items.profile_id and public.contractor_publicly_eligible(p.id)
)) or public.is_contractor_owner(contractor_portfolio_items.profile_id) or public.is_admin()));
drop policy contractor_portfolio_media_public_select on public.contractor_portfolio_media;
create policy contractor_portfolio_media_public_select on public.contractor_portfolio_media for select to anon,authenticated
using (exists(select 1 from public.contractor_portfolio_items item where item.id=portfolio_item_id and (
  (item.deleted_at is null and item.is_visible and item.is_approved and item.review_status='approved' and public.contractor_publicly_eligible(item.profile_id))
  or public.is_contractor_owner(item.profile_id) or public.is_admin())));

alter table public.project_requests
  add column search_status text not null default 'stopped'
    check(search_status in ('searching','awaiting_contractor','awaiting_customer','stopped','exhausted','awarded')),
  add column active_opportunity_id uuid references public.contractor_opportunities(id) on delete set null,
  add column search_next_check_at timestamptz,
  add column search_stopped_at timestamptz;
alter table public.contractor_opportunities
  add column is_current boolean not null default false,
  add column invitation_round integer not null default 0 check(invitation_round>=0);
create unique index contractor_opportunities_one_current_idx on public.contractor_opportunities(project_request_id) where is_current;
create policy contractor_opportunities_customer_select on public.contractor_opportunities for select to authenticated
using (exists(select 1 from public.project_requests request where request.id=project_request_id and request.customer_profile_id=auth.uid()));
create index project_requests_search_due_idx on public.project_requests(search_next_check_at,id)
  where is_open and search_status in ('searching','awaiting_contractor','awaiting_customer','exhausted');
create index contractor_profile_regions_match_idx on public.contractor_profile_regions(lower(btrim(region_name)),profile_id);
create index contractor_profile_specialties_match_idx on public.contractor_profile_specialties(lower(btrim(specialty_name)),profile_id);

-- NULL snapshots identify historical projects and never create retroactive fees.
alter table public.contractor_projects
  add column platform_commission_rate numeric(5,2),
  add column platform_commission_amount numeric(14,2),
  add constraint contractor_project_commission_shape check (
    (platform_commission_rate is null and platform_commission_amount is null) or
    (platform_commission_rate is not null and platform_commission_amount is not null and platform_commission_rate=5
      and project_value::text not in ('NaN','Infinity','-Infinity') and platform_commission_amount=round(project_value*platform_commission_rate/100,2))
  );
alter table public.contractor_financial_transactions
  add column commission_source_transaction_id uuid references public.contractor_financial_transactions(id) on delete restrict;
create unique index contractor_commission_source_unique_idx on public.contractor_financial_transactions(commission_source_transaction_id)
  where commission_source_transaction_id is not null;

-- Preserve every historical quote. The first worker pass adopts one existing
-- valid quote/invitation; no invitations or notification events are sent here.
update public.project_requests set
  search_status=case when lifecycle_status in ('awarded','in_progress','completed') then 'awarded'
    when is_open and lifecycle_status in ('published','receiving_proposals','under_customer_review') then 'searching' else 'stopped' end,
  search_next_check_at=case when is_open and lifecycle_status in ('published','receiving_proposals','under_customer_review') then now() end;
update public.project_requests request set active_opportunity_id=proposal.opportunity_id
from public.contractor_proposals proposal join public.contractor_opportunities opportunity on opportunity.id=proposal.opportunity_id
join public.contractor_projects project on project.accepted_proposal_id=proposal.id
where opportunity.project_request_id=request.id and request.search_status='awarded';

-- Same Riyadh wall-clock time after two working dates; Friday/Saturday excluded.
create or replace function public.contractor_response_deadline(p_started_at timestamptz)
returns timestamptz language plpgsql immutable strict set search_path=public,pg_temp as $$
declare v_local timestamp:=p_started_at at time zone 'Asia/Riyadh';v_days integer:=0;
begin
  while v_days<2 loop
    v_local:=v_local+interval '1 day';
    if extract(isodow from v_local) not in (5,6) then v_days:=v_days+1;end if;
  end loop;
  return v_local at time zone 'Asia/Riyadh';
end;
$$;

create or replace function public.contractor_matches_project(p_contractor_id uuid,p_request_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
  select exists(select 1 from public.contractor_profiles c
    join public.profiles account on account.id=c.profile_id and account.is_active
    join public.project_requests r on r.id=p_request_id
    left join public.contractor_availability availability on availability.contractor_profile_id=c.id
    where c.id=p_contractor_id and public.contractor_publicly_eligible(c.id) and c.profile_id<>r.customer_profile_id
      and coalesce(availability.status,c.availability)='available'
      and c.average_rating>=coalesce(r.minimum_rating,0)
      and exists(select 1 from public.contractor_profile_regions area where area.profile_id=c.id
        and lower(btrim(area.region_name)) in (lower(btrim(r.city)),lower(btrim(r.region))))
      and exists(select 1 from public.contractor_profile_specialties specialty
        join public.project_request_specialties requested on requested.project_request_id=r.id
          and lower(btrim(requested.specialty_name))=lower(btrim(specialty.specialty_name))
        where specialty.profile_id=c.id));
$$;

-- Internal only. Every mutating command locks request -> opportunity -> proposal.
create or replace function public.advance_contractor_project_search(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_request public.project_requests%rowtype;v_op public.contractor_opportunities%rowtype;
  v_proposal public.contractor_proposals%rowtype;v_candidate uuid;v_deadline timestamptz;v_previous uuid;
begin
  select * into v_request from public.project_requests where id=p_project_id for update;
  if not found then raise exception 'Project request not found';end if;
  if not v_request.is_open or v_request.search_status in ('stopped','awarded') then
    return jsonb_build_object('status',v_request.search_status,'active_opportunity_id',v_request.active_opportunity_id);
  end if;
  v_previous:=v_request.active_opportunity_id;
  if v_previous is not null then
    select * into v_op from public.contractor_opportunities where id=v_previous and project_request_id=p_project_id for update;
    select * into v_proposal from public.contractor_proposals where opportunity_id=v_previous for update;
    if v_op.id is not null and exists(select 1 from public.contractor_profiles c join public.profiles account on account.id=c.profile_id
       where c.id=v_op.contractor_profile_id and public.contractor_publicly_eligible(c.id) and account.is_active and c.profile_id<>v_request.customer_profile_id) then
      if v_proposal.status='under_review' and isfinite(v_proposal.valid_until) and v_proposal.valid_until>now() then
        update public.contractor_opportunities set is_current=true where id=v_op.id;
        update public.project_requests set search_status='awaiting_customer',lifecycle_status='under_customer_review',
          search_next_check_at=v_proposal.valid_until,updated_at=now() where id=p_project_id;
        return jsonb_build_object('status','awaiting_customer','active_opportunity_id',v_op.id);
      elsif v_op.status in ('new','viewed') and isfinite(v_op.expires_at) and v_op.expires_at>now()
        and (v_proposal.id is null or v_proposal.status in ('draft','needs_changes')) then
        update public.contractor_opportunities set is_current=true where id=v_op.id;
        update public.project_requests set search_status='awaiting_contractor',lifecycle_status='receiving_proposals',
          search_next_check_at=v_op.expires_at,updated_at=now() where id=p_project_id;
        return jsonb_build_object('status','awaiting_contractor','active_opportunity_id',v_op.id);
      end if;
    end if;
    update public.contractor_opportunities set is_current=false,status='expired',updated_at=now() where id=v_previous;
    update public.contractor_proposals set status='expired',updated_at=now()
      where opportunity_id=v_previous and status in ('under_review','needs_changes');
    insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)
    values(auth.uid(),v_op.contractor_profile_id,'project_requests',p_project_id::text,'contractor_search_advanced',jsonb_build_object('previous_opportunity_id',v_previous));
  end if;

  -- Valid historical submitted quotes are reviewed sequentially without erasing them.
  select o.* into v_op from public.contractor_opportunities o join public.contractor_proposals p on p.opportunity_id=o.id
  where o.project_request_id=p_project_id and o.id is distinct from v_previous
    and p.status='under_review' and isfinite(p.valid_until) and p.valid_until>now() and public.contractor_matches_project(o.contractor_profile_id,p_project_id)
  order by p.submitted_at nulls last,o.created_at,o.id limit 1 for update of o;
  if found then
    select * into v_proposal from public.contractor_proposals where opportunity_id=v_op.id for update;
    update public.contractor_opportunities set is_current=true,status='proposed',invitation_round=greatest(invitation_round,1),updated_at=now() where id=v_op.id;
    update public.project_requests set active_opportunity_id=v_op.id,search_status='awaiting_customer',lifecycle_status='under_customer_review',
      search_next_check_at=v_proposal.valid_until,updated_at=now() where id=p_project_id;
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values('contractor_proposal',v_proposal.id,'contractor.proposal_submitted',jsonb_build_object('adopted_legacy_quote',true),'proposal-current:'||v_proposal.id)
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('status','awaiting_customer','active_opportunity_id',v_op.id);
  end if;

  select c.id into v_candidate from public.contractor_profiles c
  where public.contractor_matches_project(c.id,p_project_id)
    and not exists(select 1 from public.contractor_opportunities o where o.project_request_id=p_project_id and o.contractor_profile_id=c.id
      and (o.invitation_round>0 or o.status not in ('new','viewed')))
  order by (select max(o.created_at) from public.contractor_opportunities o where o.contractor_profile_id=c.id) asc nulls first,
    c.average_rating desc,c.created_at,c.id limit 1;
  if v_candidate is null then
    update public.project_requests set active_opportunity_id=null,search_status='exhausted',lifecycle_status='receiving_proposals',
      search_next_check_at=now()+interval '5 minutes',updated_at=now() where id=p_project_id;
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values('project_request',p_project_id,'admin.project_no_contractors','{}','project-no-contractors:'||p_project_id)
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('status','exhausted','active_opportunity_id',null);
  end if;
  v_deadline:=public.contractor_response_deadline(now());
  insert into public.contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at,is_current,invitation_round)
  values(p_project_id,v_candidate,'new',v_deadline,true,1)
  on conflict(project_request_id,contractor_profile_id) do update set status='new',expires_at=excluded.expires_at,
    is_current=true,invitation_round=1,updated_at=now() returning * into v_op;
  update public.project_requests set active_opportunity_id=v_op.id,search_status='awaiting_contractor',lifecycle_status='receiving_proposals',
    proposal_deadline_at=v_deadline,search_next_check_at=v_deadline,updated_at=now() where id=p_project_id;
  insert into public.contractor_opportunity_matches(opportunity_id,specialty_matched,region_matched,account_approved,availability_matched,rating_matched,eligible,reasons)
  values(v_op.id,true,true,true,true,true,true,'{}') on conflict(opportunity_id) do nothing;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('contractor_opportunity',v_op.id,'contractor.opportunity_new',
    jsonb_build_object('contractor_profile_id',v_candidate,'project_request_id',p_project_id,'response_deadline_at',v_deadline),
    'contractor-opportunity:'||v_op.id||':1') on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),v_candidate,'project_requests',p_project_id::text,'contractor_search_invited',jsonb_build_object('opportunity_id',v_op.id,'response_deadline_at',v_deadline));
  return jsonb_build_object('status','awaiting_contractor','active_opportunity_id',v_op.id);
end;
$$;

create or replace function public.get_customer_project_search(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_request public.project_requests%rowtype;v_result jsonb;
begin
  select * into v_request from public.project_requests where id=p_project_id;
  if auth.uid() is null or not found or (not exists(select 1 from public.profiles account where account.id=auth.uid() and account.is_active) or ((v_request.customer_profile_id<>auth.uid() or not exists(select 1 from public.user_roles role where role.profile_id=auth.uid() and role.role='customer' and role.revoked_at is null)) and not public.admin_has_permission('projects.manage'))) then
    raise exception 'Project owner required';end if;
  select jsonb_build_object('status',v_request.search_status,'active_opportunity_id',v_request.active_opportunity_id,
    'active_proposal_id',p.id,'response_deadline_at',case when v_request.search_status='awaiting_contractor' then o.expires_at end,
    'proposal_valid_until',p.valid_until,'contractor_name',c.display_name,
    'invited_count',(select count(*) from public.contractor_opportunities where project_request_id=p_project_id),
    'commission_rate',case when v_request.search_status='awarded' then project.platform_commission_rate else 5 end,
    'commission_amount',project.platform_commission_amount)
    into v_result
    from (select 1) seed left join public.contractor_opportunities o on o.id=v_request.active_opportunity_id
    left join public.contractor_profiles c on c.id=o.contractor_profile_id
    left join public.contractor_proposals p on p.opportunity_id=o.id
    left join public.contractor_projects project on project.accepted_proposal_id=p.id;
  return v_result;
end;
$$;

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
begin
  if auth.uid() is null
    or not public.has_verified_customer_identity(auth.uid())
    or not exists (select 1 from public.customer_profiles customer join public.profiles account on account.id=customer.profile_id where customer.profile_id=auth.uid() and account.is_active and exists(select 1 from public.user_roles role where role.profile_id=auth.uid() and role.role='customer' and role.revoked_at is null))
  then
    raise exception 'Verified customer required';
  end if;
  if length(coalesce(p_idempotency_key,'')) not between 8 and 120
    or coalesce(cardinality(p_specialties),0) not between 1 and 20
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

  v_deadline := public.contractor_response_deadline(now());

  insert into public.project_requests(
    request_code, customer_profile_id, title, project_type, description, scope,
    city, region, quantity_label, estimated_budget_min, estimated_budget_max,
    expected_start_at, estimated_duration, proposal_deadline_at, minimum_rating,
    customer_label, terms, is_open, lifecycle_status, submitted_at, published_at,
    budget_negotiable, duration_value, duration_unit, location_name,
    access_description, technical_details, search_status, search_next_check_at
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
    coalesce(p_request -> 'technical_details', '{}'), 'searching', now()
  )
  returning id into v_id;

  insert into public.project_request_specialties(project_request_id, specialty_name)
  select v_id, btrim(x)
  from unnest(p_specialties) x
  where btrim(x) <> ''
  on conflict do nothing;

  if not exists(select 1 from public.project_request_specialties where project_request_id=v_id) then raise exception 'Project specialties required';end if;
  perform public.advance_contractor_project_search(v_id);

  insert into public.contractor_workflow_idempotency(
    profile_id, scope, key, entity_id, created_at
  )
  values (auth.uid(), 'project_request', p_idempotency_key, v_id, now());
  return v_id;
end
$$;

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
  v_request public.project_requests%rowtype;
  v_request_id uuid;
  v_status public.contractor_proposal_status;
begin
  if auth.uid() is null or length(coalesce(p_idempotency_key,'')) not between 8 and 120 then
    raise exception 'Invalid proposal idempotency key';
  end if;
  select id into v_contractor
  from public.contractor_profiles
  where profile_id = auth.uid()
    and public.contractor_publicly_eligible(contractor_profiles.id)
    and exists(select 1 from public.profiles account where account.id=auth.uid() and account.is_active)
  limit 1;
  if v_contractor is null then
    raise exception 'Active contractor required';
  end if;

  select project_request_id into v_request_id from public.contractor_opportunities
  where id=p_opportunity_id and contractor_profile_id=v_contractor;
  if not found then raise exception 'Opportunity unavailable';end if;
  select * into v_request from public.project_requests where id=v_request_id for update;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':proposal:' || p_idempotency_key, 0));
  select entity_id into v_id
  from public.contractor_workflow_idempotency
  where profile_id = auth.uid()
    and scope = 'contractor_proposal'
    and key = p_idempotency_key;
  if found then
    if not exists(select 1 from public.contractor_proposals where id=v_id and opportunity_id=p_opportunity_id) then
      raise exception 'Idempotency key belongs to another opportunity';end if;
    return v_id;
  end if;
  if v_request.customer_profile_id=auth.uid() or not v_request.is_open or v_request.search_status<>'awaiting_contractor'
     or v_request.active_opportunity_id is distinct from p_opportunity_id then raise exception 'Project search is not awaiting this contractor';end if;

  select * into v_opportunity
  from public.contractor_opportunities
  where id = p_opportunity_id
    and contractor_profile_id = v_contractor
  for update;
  if not found or v_opportunity.expires_at<=now() or not v_opportunity.is_current or v_opportunity.status not in ('new','viewed') then
    raise exception 'Opportunity unavailable';
  end if;
  if p_submit is null or jsonb_typeof(p_proposal) is distinct from 'object' then raise exception 'Invalid proposal';end if;
  if coalesce(p_proposal ->> 'amount','0')::numeric::text in ('NaN','Infinity','-Infinity')
    or (p_submit and coalesce((p_proposal ->> 'amount')::numeric,0)<=0) then raise exception 'A finite positive proposal amount is required';end if;
  if p_submit and (nullif(p_proposal ->> 'valid_until','') is null
    or not isfinite((p_proposal ->> 'valid_until')::timestamptz)
    or (p_proposal ->> 'valid_until')::timestamptz<=now()) then raise exception 'A future proposal validity deadline is required';end if;
  if p_submit and (p_stages is null or jsonb_typeof(p_stages)<>'array' or jsonb_array_length(p_stages)=0) then
    raise exception 'Proposal stages required';
  end if;
  if p_submit and (select coalesce(sum((stage ->> 'value_percentage')::numeric),0) from jsonb_array_elements(p_stages) stage)<>100 then
    raise exception 'Proposal stages must total 100 percent';end if;
  if p_submit and exists(select 1 from jsonb_array_elements(p_stages) stage
    where (stage ->> 'expected_at')::date<coalesce(nullif(p_proposal ->> 'proposed_start_at','')::date,current_date)) then
    raise exception 'Proposal stage cannot finish before project start';end if;
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
    update public.project_requests set search_status='awaiting_customer',lifecycle_status='under_customer_review',
      search_next_check_at=(p_proposal ->> 'valid_until')::timestamptz,updated_at=now() where id=v_request.id;
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, payload, idempotency_key
    )
    values (
      'contractor_proposal', v_id, 'contractor.proposal_submitted', '{}',
      'proposal-submitted:' || v_id || ':' || p_idempotency_key
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),v_contractor,'contractor_proposals',v_id::text,
    case when p_submit then 'contractor_proposal_submitted' else 'contractor_proposal_draft_saved' end,
    jsonb_build_object('project_request_id',v_request.id,'opportunity_id',p_opportunity_id,'amount',p_proposal -> 'amount'));
  insert into public.contractor_workflow_idempotency(
    profile_id, scope, key, entity_id, created_at
  )
  values (auth.uid(), 'contractor_proposal', p_idempotency_key, v_id, now());
  return v_id;
end
$$;

create or replace function public.get_contractor_opportunities()
returns table (
  opportunity_id uuid,
  project_request_id uuid,
  request_code text,
  title text,
  project_type text,
  description text,
  scope text,
  city text,
  region text,
  quantity_label text,
  estimated_budget_min numeric,
  estimated_budget_max numeric,
  budget_negotiable boolean,
  expected_start_at date,
  estimated_duration text,
  duration_value numeric,
  duration_unit text,
  proposal_deadline_at timestamptz,
  terms text[],
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, r.id, r.request_code, r.title, r.project_type, r.description, r.scope,
         r.city, r.region, r.quantity_label, r.estimated_budget_min, r.estimated_budget_max,
         r.budget_negotiable, r.expected_start_at, r.estimated_duration, r.duration_value,
         r.duration_unit, o.expires_at, r.terms, r.published_at
  from public.contractor_opportunities o
  join public.contractor_profiles c on c.id = o.contractor_profile_id
  join public.project_requests r on r.id = o.project_request_id
  where c.profile_id = auth.uid()
    and public.contractor_publicly_eligible(c.id)
    and exists(select 1 from public.profiles account where account.id=c.profile_id and account.is_active)
    and c.profile_id<>r.customer_profile_id
    and o.is_current and r.active_opportunity_id=o.id and r.search_status='awaiting_contractor'
    and o.status in ('new','viewed')
    and o.expires_at > now()
    and r.lifecycle_status in ('published','receiving_proposals')
    and r.is_open
;
$$;

create or replace function public.decide_contractor_proposal(p_proposal_id uuid,p_decision text,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_p public.contractor_proposals%rowtype;v_request public.project_requests%rowtype;
  v_op public.contractor_opportunities%rowtype;v_project uuid;v_request_id uuid;v_replay uuid;v_deadline timestamptz;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('accepted','rejected','needs_changes')
    or length(btrim(coalesce(p_reason,'')))<5 or length(coalesce(p_idempotency_key,'')) not between 8 and 120 then raise exception 'Invalid decision';end if;
  select o.project_request_id into v_request_id from public.contractor_proposals p join public.contractor_opportunities o on o.id=p.opportunity_id
  where p.id=p_proposal_id;
  if not found then raise exception 'Proposal not found';end if;
  select * into v_request from public.project_requests where id=v_request_id for update;
  if (not exists(select 1 from public.profiles account where account.id=auth.uid() and account.is_active) or ((v_request.customer_profile_id<>auth.uid() or not exists(select 1 from public.user_roles role where role.profile_id=auth.uid() and role.role='customer' and role.revoked_at is null)) and not public.admin_has_permission('projects.manage'))) then raise exception 'Not authorized';end if;
  select entity_id into v_replay from public.contractor_workflow_idempotency
    where profile_id=auth.uid() and scope='proposal_decision:'||p_proposal_id and key=p_idempotency_key;
  if found then return v_replay;end if;
  select * into v_op from public.contractor_opportunities where id=v_request.active_opportunity_id for update;
  select * into v_p from public.contractor_proposals where id=p_proposal_id for update;
  if not v_request.is_open or v_request.search_status<>'awaiting_customer' or v_p.opportunity_id is distinct from v_request.active_opportunity_id
    or not coalesce(v_op.is_current,false) or v_p.status<>'under_review' or v_p.valid_until is null or not isfinite(v_p.valid_until) or v_p.valid_until<=now() then
    raise exception 'Proposal is not currently reviewable';end if;
  if not exists(select 1 from public.contractor_profiles c join public.profiles account on account.id=c.profile_id
    where c.id=v_p.contractor_profile_id and c.profile_id<>v_request.customer_profile_id and public.contractor_publicly_eligible(c.id) and account.is_active) then
    raise exception 'Approved independent contractor required';end if;
  update public.contractor_proposals set status=p_decision::public.contractor_proposal_status,reviewed_at=now(),
    rejection_reason=case when p_decision='rejected' then p_reason end,
    change_request=case when p_decision='needs_changes' then p_reason end,updated_at=now() where id=v_p.id;
  if p_decision = 'accepted' then
    insert into public.contractor_projects(
      project_code, accepted_proposal_id, contractor_profile_id,
      customer_profile_id, name, customer_label, project_value, start_at,
      expected_end_at, scope, status, platform_commission_rate, platform_commission_amount
    )
    values (
      'CTR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_p.id, v_p.contractor_profile_id, v_request.customer_profile_id,
      v_request.title, v_request.customer_label, v_p.amount,
      coalesce(v_p.proposed_start_at, current_date),
      greatest(coalesce(v_p.proposed_start_at,current_date),(select max(expected_at) from public.contractor_proposal_stages where proposal_id=v_p.id)),
      coalesce(v_p.scope_details, v_request.scope), 'awaiting_start', 5, round(v_p.amount*0.05,2)
    )
    on conflict (accepted_proposal_id) do update
      set accepted_proposal_id = excluded.accepted_proposal_id
    returning id into v_project;

    insert into public.contractor_project_milestones(
      project_id, name, description, start_at, expected_end_at,
      value_percentage, status, sort_order
    )
    select
      v_project, stage.name, stage.description,
      coalesce(v_p.proposed_start_at, current_date), stage.expected_at,
      stage.value_percentage, 'not_started', stage.sort_order
    from public.contractor_proposal_stages stage
    where stage.proposal_id = v_p.id
    on conflict do nothing;

    insert into public.contractor_financial_transactions(
      transaction_code, contractor_profile_id, project_id, transaction_type,
      financial_kind, amount, status, balance_after, reference, metadata
    )
    values (
      'CTX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_p.contractor_profile_id, v_project, 'advance', 'advance', 0,
      'pending', 0, 'proposal:' || v_p.id::text,
      jsonb_build_object('proposal_id', v_p.id)
    );

    update public.project_requests
    set lifecycle_status='awarded',is_open=false,search_status='awarded',search_next_check_at=null,updated_at=now()
    where id = v_request.id;

    update public.contractor_proposals
    set status = 'rejected', reviewed_at = now(),
        rejection_reason = 'تم اختيار عرض آخر'
    where id <> v_p.id
      and opportunity_id in (
        select id from public.contractor_opportunities
        where project_request_id = v_request.id
      )
      and status = 'under_review';
    update public.contractor_opportunities set is_current=false,updated_at=now() where project_request_id=v_request.id;
  end if;

  if p_decision='rejected' then
    update public.contractor_opportunities set is_current=false,status='expired',updated_at=now() where id=v_op.id;
    update public.project_requests set search_status='searching',search_next_check_at=now(),updated_at=now() where id=v_request.id;
    perform public.advance_contractor_project_search(v_request.id);
  elsif p_decision='needs_changes' then
    v_deadline:=public.contractor_response_deadline(now());
    update public.contractor_opportunities set status='new',expires_at=v_deadline,invitation_round=invitation_round+1,updated_at=now() where id=v_op.id;
    update public.project_requests set search_status='awaiting_contractor',lifecycle_status='receiving_proposals',
      proposal_deadline_at=v_deadline,search_next_check_at=v_deadline,updated_at=now() where id=v_request.id;
  end if;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('contractor_proposal',v_p.id,'contractor.proposal_'||p_decision,
    jsonb_build_object('project_id',v_project,'response_deadline_at',v_deadline,'commission_rate',5,
      'commission_amount',case when p_decision='accepted' then round(v_p.amount*0.05,2) end),
    'proposal-decision:'||v_p.id||':'||p_idempotency_key)
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),v_p.contractor_profile_id,'contractor_proposals',v_p.id::text,'proposal_'||p_decision,
    jsonb_build_object('reason',p_reason,'project_id',v_project,'platform_commission_rate',case when p_decision='accepted' then 5 end,
      'platform_commission_amount',case when p_decision='accepted' then round(v_p.amount*0.05,2) end));
  insert into public.contractor_workflow_idempotency(profile_id,scope,key,entity_id)
  values(auth.uid(),'proposal_decision:'||p_proposal_id,p_idempotency_key,v_project);
  return v_project;
end;
$$;

create or replace function public.stop_project_contractor_search(p_project_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.project_requests%rowtype;
begin
  if auth.uid() is null or length(coalesce(p_idempotency_key,'')) not between 8 and 120 then raise exception 'Invalid search command';end if;
  select * into v_request from public.project_requests where id=p_project_id for update;
  if not found or (not exists(select 1 from public.profiles account where account.id=auth.uid() and account.is_active) or ((v_request.customer_profile_id<>auth.uid() or not exists(select 1 from public.user_roles role where role.profile_id=auth.uid() and role.role='customer' and role.revoked_at is null)) and not public.admin_has_permission('projects.manage'))) then raise exception 'Project owner required';end if;
  if exists(select 1 from public.contractor_workflow_idempotency where profile_id=auth.uid() and scope='project_search_stop:'||p_project_id and key=p_idempotency_key) then
    return public.get_customer_project_search(p_project_id);end if;
  if v_request.search_status='awarded' then raise exception 'Awarded project search cannot be stopped';end if;
  if v_request.search_status<>'stopped' then
    update public.contractor_opportunities set is_current=false,updated_at=now() where project_request_id=p_project_id and is_current;
    update public.project_requests set search_status='stopped',is_open=false,search_next_check_at=null,search_stopped_at=now(),updated_at=now() where id=p_project_id;
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,old_data,new_data)
    values(auth.uid(),'project_requests',p_project_id::text,'contractor_search_stopped',jsonb_build_object('status',v_request.search_status),jsonb_build_object('status','stopped'));
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values('project_request',p_project_id,'customer.project_search_stopped',jsonb_build_object('customer_profile_id',v_request.customer_profile_id),'project-search-stop:'||p_project_id||':'||p_idempotency_key)
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
  end if;
  insert into public.contractor_workflow_idempotency(profile_id,scope,key,entity_id) values(auth.uid(),'project_search_stop:'||p_project_id,p_idempotency_key,p_project_id);
  return public.get_customer_project_search(p_project_id);
end;
$$;

create or replace function public.resume_project_contractor_search(p_project_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.project_requests%rowtype;
begin
  if auth.uid() is null or length(coalesce(p_idempotency_key,'')) not between 8 and 120 then raise exception 'Invalid search command';end if;
  select * into v_request from public.project_requests where id=p_project_id for update;
  if not found or (not exists(select 1 from public.profiles account where account.id=auth.uid() and account.is_active) or ((v_request.customer_profile_id<>auth.uid() or not exists(select 1 from public.user_roles role where role.profile_id=auth.uid() and role.role='customer' and role.revoked_at is null)) and not public.admin_has_permission('projects.manage'))) then raise exception 'Project owner required';end if;
  if exists(select 1 from public.contractor_workflow_idempotency where profile_id=auth.uid() and scope='project_search_resume:'||p_project_id and key=p_idempotency_key) then
    return public.get_customer_project_search(p_project_id);end if;
  if v_request.search_status not in ('stopped','exhausted') or v_request.lifecycle_status in ('awarded','in_progress','completed','rejected','cancelled') then
    raise exception 'Project search cannot be resumed';end if;
  update public.project_requests set search_status='searching',is_open=true,search_stopped_at=null,search_next_check_at=now(),updated_at=now() where id=p_project_id;
  perform public.advance_contractor_project_search(p_project_id);
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),'project_requests',p_project_id::text,'contractor_search_resumed',public.get_customer_project_search(p_project_id));
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('project_request',p_project_id,'customer.project_search_resumed',jsonb_build_object('customer_profile_id',v_request.customer_profile_id),'project-search-resume:'||p_project_id||':'||p_idempotency_key)
  on conflict(idempotency_key) where idempotency_key is not null do nothing;
  insert into public.contractor_workflow_idempotency(profile_id,scope,key,entity_id) values(auth.uid(),'project_search_resume:'||p_project_id,p_idempotency_key,p_project_id);
  return public.get_customer_project_search(p_project_id);
end;
$$;

create or replace function public.process_contractor_searches(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request record;v_count integer:=0;v_failed integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid search batch size';end if;
  for v_request in select id from public.project_requests where is_open
    and search_status in ('searching','awaiting_contractor','awaiting_customer','exhausted')
    and search_next_check_at<=now() order by search_next_check_at,id limit p_limit for update skip locked
  loop
    begin
      perform public.advance_contractor_project_search(v_request.id);v_count:=v_count+1;
    exception when others then
      v_failed:=v_failed+1;
      update public.project_requests set search_next_check_at=now()+interval '5 minutes' where id=v_request.id;
      insert into public.audit_logs(entity_table,entity_id,action,new_data)
      values('project_requests',v_request.id::text,'contractor_search_progress_failed',jsonb_build_object('sqlstate',sqlstate));
    end;
  end loop;
  return jsonb_build_object('processed',v_count,'failed',v_failed);
end;
$$;

-- Existing broad participant RLS must not bypass command locking/deadlines.
-- Effective DB role is not a client-settable application marker.
create or replace function public.guard_contractor_search_client_mutation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_table_name='project_requests' and tg_op='UPDATE' then
      if old.lifecycle_status='draft' and old.search_status='stopped'
      and (to_jsonb(new)-array['title','description','scope','technical_details','updated_at'])
        is not distinct from (to_jsonb(old)-array['title','description','scope','technical_details','updated_at']) then return new;end if;
    end if;
    raise exception 'Contractor search and proposals require an authorized command';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end;
$$;
create trigger project_requests_search_command_guard before insert or update or delete on public.project_requests
for each row execute function public.guard_contractor_search_client_mutation();
create trigger contractor_opportunities_search_command_guard before insert or update or delete on public.contractor_opportunities
for each row execute function public.guard_contractor_search_client_mutation();
create trigger contractor_proposals_search_command_guard before insert or update or delete on public.contractor_proposals
for each row execute function public.guard_contractor_search_client_mutation();
create trigger contractor_proposal_stages_search_command_guard before insert or update or delete on public.contractor_proposal_stages
for each row execute function public.guard_contractor_search_client_mutation();

create or replace function public.protect_contractor_project_commission_snapshot()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' and current_user in ('authenticated','anon') then raise exception 'Project award requires an authorized command';end if;
  if tg_op='UPDATE' and (new.platform_commission_rate is distinct from old.platform_commission_rate
    or new.platform_commission_amount is distinct from old.platform_commission_amount) then raise exception 'Project commission snapshot is immutable';end if;
  return new;
end;
$$;
create trigger contractor_project_commission_snapshot_guard before insert or update on public.contractor_projects
for each row execute function public.protect_contractor_project_commission_snapshot();

create or replace function public.guard_contractor_commission_ledger()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.commission_source_transaction_id is not null and current_user in ('authenticated','anon','service_role') then
    raise exception 'Commission deductions are recorded by the earnings trigger';end if;
  if new.commission_source_transaction_id is not null and (new.financial_kind<>'commission' or new.transaction_type<>'commission' or new.status<>'available' or new.amount<=0) then
    raise exception 'Invalid earned commission entry';end if;
  return new;
end;
$$;
create trigger contractor_commission_ledger_guard before insert on public.contractor_financial_transactions
for each row execute function public.guard_contractor_commission_ledger();
create policy contractor_financial_finance_insert on public.contractor_financial_transactions
as restrictive for insert to authenticated with check (public.admin_has_permission('finance.manage'));

-- Finance is append-only: a real available/completed earning INSERT produces its
-- commission debit atomically. Pending entries create no spendable cash or fee.
create or replace function public.record_earned_contractor_commission()
returns trigger language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_project public.contractor_projects%rowtype;v_earned numeric;v_charged numeric;v_fee numeric;v_balance numeric;
begin
  if new.financial_kind not in ('advance','milestone_payment','final_payment') or new.status not in ('available','completed') or new.amount<=0 then return new;end if;
  if new.amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Earning amount must be finite';end if;
  if new.project_id is null then return new;end if;
  select * into v_project from public.contractor_projects where id=new.project_id for no key update;
  if not found or v_project.contractor_profile_id<>new.contractor_profile_id then raise exception 'Earning project and contractor must match';end if;
  if v_project.platform_commission_rate is null then return new;end if;
  select coalesce(sum(amount),0) into v_earned from public.contractor_financial_transactions
    where project_id=new.project_id and financial_kind in ('advance','milestone_payment','final_payment') and status in ('available','completed') and amount>0;
  select coalesce(sum(amount),0) into v_charged from public.contractor_financial_transactions
    where project_id=new.project_id and commission_source_transaction_id is not null;
  v_fee:=greatest(0,least(v_project.platform_commission_amount,round(v_earned*v_project.platform_commission_rate/100,2))-v_charged);
  if v_fee=0 then return new;end if;
  select coalesce(sum(case when financial_kind in ('commission','tax','discount') then -abs(amount) else amount end),0)-v_fee
    into v_balance from public.contractor_financial_transactions where contractor_profile_id=new.contractor_profile_id and status in ('available','completed');
  insert into public.contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,milestone_id,
    transaction_type,financial_kind,amount,status,balance_after,reference,metadata,commission_source_transaction_id)
  values('CTX-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),new.contractor_profile_id,new.project_id,new.milestone_id,
    'commission','commission',v_fee,'available',v_balance,'project-commission:'||new.id,
    jsonb_build_object('source_transaction_id',new.id,'commission_rate_snapshot',v_project.platform_commission_rate,
      'project_commission_total',v_project.platform_commission_amount,'cumulative_earned',v_earned),new.id)
  on conflict(commission_source_transaction_id) where commission_source_transaction_id is not null do nothing;
  insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)
  values(auth.uid(),new.contractor_profile_id,'contractor_projects',new.project_id::text,'project_commission_accrued',
    jsonb_build_object('source_transaction_id',new.id,'amount',v_fee,'commission_rate',v_project.platform_commission_rate));
  return new;
end;
$$;
create trigger contractor_financial_earned_commission after insert on public.contractor_financial_transactions
for each row execute function public.record_earned_contractor_commission();

revoke all on function public.contractor_response_deadline(timestamptz),public.contractor_matches_project(uuid,uuid),
 public.advance_contractor_project_search(uuid),public.guard_contractor_search_client_mutation(),
 public.protect_contractor_project_commission_snapshot(),public.guard_contractor_commission_ledger(),public.record_earned_contractor_commission()
 from public,anon,authenticated,service_role;
revoke all on function public.process_contractor_searches(integer) from public,anon,authenticated;
grant execute on function public.process_contractor_searches(integer) to service_role;
revoke execute on function public.get_customer_project_search(uuid),public.stop_project_contractor_search(uuid,text),
 public.resume_project_contractor_search(uuid,text),public.submit_customer_project_request(jsonb,text[],text),
 public.save_contractor_proposal(uuid,jsonb,jsonb,boolean,text),public.decide_contractor_proposal(uuid,text,text,text),
 public.get_contractor_opportunities() from public,anon;
grant execute on function public.get_customer_project_search(uuid),public.stop_project_contractor_search(uuid,text),
 public.resume_project_contractor_search(uuid,text),public.submit_customer_project_request(jsonb,text[],text),
 public.save_contractor_proposal(uuid,jsonb,jsonb,boolean,text),public.decide_contractor_proposal(uuid,text,text,text),
 public.get_contractor_opportunities() to authenticated;

commit;
