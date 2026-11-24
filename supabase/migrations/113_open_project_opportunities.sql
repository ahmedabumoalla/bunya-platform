-- Opt-in exposure of an exhausted request to approved contractors.
-- Existing sequential invitations remain the default. No project is opened by migration.
-- Existing RPC result shapes are retained, including the customer review queue.
begin;
alter table public.project_requests add column open_bidding boolean not null default false;

-- Internal helper, called only while the project row is locked by advance/publish.
create or replace function public.sync_open_project_opportunities(p_project_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at,is_current,invitation_round)
  select r.id,c.id,'new',r.proposal_deadline_at,false,1
  from public.project_requests r cross join public.contractor_profiles c
  where r.id=p_project_id and r.open_bidding and r.is_open
    and r.search_status not in ('stopped','awarded')
    and r.lifecycle_status in ('published','receiving_proposals','under_customer_review')
    and r.proposal_deadline_at>now() and isfinite(r.proposal_deadline_at)
    and c.profile_id<>r.customer_profile_id and public.contractor_publicly_eligible(c.id)
  on conflict(project_request_id,contractor_profile_id) do nothing;
$$;

-- Accept offers concurrently; retain the established one-at-a-time customer review.
create or replace function public.advance_open_project_search(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.project_requests%rowtype;
  o public.contractor_opportunities%rowtype;
  p public.contractor_proposals%rowtype;
begin
  select * into r from public.project_requests where id=p_project_id for update;
  if not found or not r.open_bidding then raise exception 'Open project required';end if;
  if not r.is_open or r.search_status in ('stopped','awarded') then
    return jsonb_build_object('status',r.search_status,'active_opportunity_id',r.active_opportunity_id);
  end if;
  perform public.sync_open_project_opportunities(r.id);
  if r.active_opportunity_id is not null then
    select * into o from public.contractor_opportunities where id=r.active_opportunity_id and project_request_id=r.id for update;
    select * into p from public.contractor_proposals where opportunity_id=o.id for update;
    if public.contractor_publicly_eligible(o.contractor_profile_id) then
      if p.status='under_review' and isfinite(p.valid_until) and p.valid_until>now() then
        update public.contractor_opportunities set is_current=true where id=o.id;
        update public.project_requests set search_status='awaiting_customer',lifecycle_status='under_customer_review',
          search_next_check_at=least(p.valid_until,now()+interval '5 minutes'),updated_at=now() where id=r.id;
        return jsonb_build_object('status','awaiting_customer','active_opportunity_id',o.id);
      elsif p.status='needs_changes' and o.status in ('new','viewed') and isfinite(o.expires_at) and o.expires_at>now() then
        update public.contractor_opportunities set is_current=true where id=o.id;
        update public.project_requests set search_status='awaiting_contractor',lifecycle_status='receiving_proposals',
          search_next_check_at=least(o.expires_at,now()+interval '5 minutes'),updated_at=now() where id=r.id;
        return jsonb_build_object('status','awaiting_contractor','active_opportunity_id',o.id);
      end if;
    end if;
    update public.contractor_opportunities set is_current=false,status='expired',updated_at=now() where id=r.active_opportunity_id;
    update public.contractor_proposals set status='expired',updated_at=now()
      where opportunity_id=r.active_opportunity_id and status in ('under_review','needs_changes');
  end if;
  select offer.* into o from public.contractor_opportunities offer
    join public.contractor_proposals proposal on proposal.opportunity_id=offer.id
    join public.contractor_profiles contractor on contractor.id=offer.contractor_profile_id
  where offer.project_request_id=r.id and proposal.status='under_review'
    and isfinite(proposal.valid_until) and proposal.valid_until>now()
    and contractor.profile_id<>r.customer_profile_id and public.contractor_publicly_eligible(contractor.id)
  order by proposal.submitted_at,proposal.id limit 1 for update of offer;
  if found then
    select * into p from public.contractor_proposals where opportunity_id=o.id for update;
    update public.contractor_opportunities set is_current=false where project_request_id=r.id and is_current and id<>o.id;
    update public.contractor_opportunities set is_current=true,status='proposed',updated_at=now() where id=o.id;
    update public.project_requests set active_opportunity_id=o.id,search_status='awaiting_customer',lifecycle_status='under_customer_review',
      search_next_check_at=least(p.valid_until,now()+interval '5 minutes'),updated_at=now() where id=r.id;
    insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values('contractor_proposal',p.id,'contractor.proposal_submitted',jsonb_build_object('open_bidding',true),
      'open-proposal-current:'||p.id||':'||p.submitted_at::text)
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('status','awaiting_customer','active_opportunity_id',o.id);
  end if;
  update public.project_requests set active_opportunity_id=null,
    search_status=case when proposal_deadline_at>now() then 'searching' else 'exhausted' end,
    lifecycle_status='receiving_proposals',
    search_next_check_at=case when proposal_deadline_at>now() then least(proposal_deadline_at,now()+interval '5 minutes') end,
    updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('status',r.search_status,'active_opportunity_id',null);
end;
$$;

create or replace function public.publish_open_project_opportunities(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.project_requests%rowtype;v_count integer;
begin
  if auth.uid() is null or not public.admin_has_permission('projects.manage')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'Project administrator required';end if;
  select * into r from public.project_requests where id=p_project_id for update;
  if not found or not r.is_open or r.search_status in ('stopped','awarded')
    or r.lifecycle_status not in ('published','receiving_proposals','under_customer_review')
    or not isfinite(r.proposal_deadline_at) or r.proposal_deadline_at<=now() then
    raise exception 'Open request with a future deadline required';end if;
  if not r.open_bidding then
    if r.search_status<>'exhausted' or exists(select 1 from public.contractor_opportunities where project_request_id=r.id) then
      raise exception 'Only an exhausted request without invitations can be opened';end if;
    update public.project_requests set open_bidding=true,search_status='searching',search_next_check_at=now(),updated_at=now() where id=r.id;
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
    values(auth.uid(),'project_requests',r.id::text,'project_open_bidding_published',jsonb_build_object('open_bidding',true));
  end if;
  perform public.advance_contractor_project_search(r.id);
  select count(*) into v_count from public.contractor_opportunities where project_request_id=r.id;
  return jsonb_build_object('project_id',r.id,'opportunities',v_count,'open_bidding',true);
end;
$$;

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
  if v_request.open_bidding then
    return public.advance_open_project_search(p_project_id);
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
  if v_request.customer_profile_id=auth.uid() or not v_request.is_open
     or v_request.search_status in ('stopped','awarded')
     or v_request.lifecycle_status not in ('published','receiving_proposals','under_customer_review')
     or (not v_request.open_bidding and (v_request.search_status<>'awaiting_contractor'
       or v_request.active_opportunity_id is distinct from p_opportunity_id)) then
    raise exception 'Project search is not awaiting this contractor';end if;

  select * into v_opportunity
  from public.contractor_opportunities
  where id = p_opportunity_id
    and contractor_profile_id = v_contractor
  for update;
  if not found or v_opportunity.expires_at<=now() or (not v_request.open_bidding and not v_opportunity.is_current) or v_opportunity.status not in ('new','viewed') then
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

  if p_submit and v_request.open_bidding then
    perform public.advance_contractor_project_search(v_request.id);
    if v_request.active_opportunity_id=p_opportunity_id then
      insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
      values('contractor_proposal',v_id,'contractor.proposal_submitted','{}','proposal-submitted:'||v_id||':'||p_idempotency_key)
      on conflict(idempotency_key) where idempotency_key is not null do nothing;
    end if;
  elsif p_submit then
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
    and (r.open_bidding and r.search_status not in ('stopped','awarded')
      or not r.open_bidding and o.is_current and r.active_opportunity_id=o.id and r.search_status='awaiting_contractor')
    and o.status in ('new','viewed')
    and o.expires_at > now()
    and (r.lifecycle_status in ('published','receiving_proposals') or r.open_bidding and r.lifecycle_status='under_customer_review')
    and r.is_open
;
$$;

revoke all on function public.sync_open_project_opportunities(uuid),public.advance_open_project_search(uuid) from public,anon,authenticated,service_role;
revoke all on function public.publish_open_project_opportunities(uuid) from public,anon,service_role;
grant execute on function public.publish_open_project_opportunities(uuid) to authenticated;
-- Existing command guards and RLS also protect the added open_bidding field.
notify pgrst, 'reload schema';
commit;
