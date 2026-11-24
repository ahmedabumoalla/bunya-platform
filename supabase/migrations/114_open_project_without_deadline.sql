-- Open bidding has no submission cutoff. Private response windows and quote validity remain finite.
begin;
alter table public.project_requests alter column proposal_deadline_at drop not null;
alter table public.project_requests add constraint project_deadline_when_private
  check(open_bidding or proposal_deadline_at is not null);

create or replace function public.sync_open_project_opportunities(p_project_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at,is_current,invitation_round)
  select r.id,c.id,'new','infinity'::timestamptz,false,1
  from public.project_requests r cross join public.contractor_profiles c
  where r.id=p_project_id and r.open_bidding and r.is_open
    and r.search_status not in ('stopped','awarded')
    and r.lifecycle_status in ('published','receiving_proposals','under_customer_review')
    and c.profile_id<>r.customer_profile_id and public.contractor_publicly_eligible(c.id)
  on conflict(project_request_id,contractor_profile_id) do nothing;
$$;

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
    search_status='searching',
    lifecycle_status='receiving_proposals',
    search_next_check_at=now()+interval '5 minutes',
    updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('status',r.search_status,'active_opportunity_id',null);
end;
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
         r.duration_unit, nullif(o.expires_at,'infinity'::timestamptz), r.terms, r.published_at
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

create or replace function public.publish_open_project_internal(p_project_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.project_requests%rowtype;v_count integer;
begin
  select * into r from public.project_requests where id=p_project_id for update;
  if not found or not r.is_open or r.search_status in ('stopped','awarded')
    or r.lifecycle_status not in ('published','receiving_proposals','under_customer_review') then
    raise exception 'Open request required';end if;
  if not r.open_bidding then
    if r.search_status<>'exhausted' or exists(select 1 from public.contractor_opportunities where project_request_id=r.id) then
      raise exception 'Only an exhausted request without invitations can be opened';end if;
    update public.project_requests set open_bidding=true,proposal_deadline_at=null,search_status='searching',search_next_check_at=now(),updated_at=now() where id=r.id;
    insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
    values(auth.uid(),'project_requests',r.id::text,'project_open_bidding_published',jsonb_build_object('open_bidding',true,'database_actor',session_user));
  end if;
  perform public.advance_contractor_project_search(r.id);
  select count(*) into v_count from public.contractor_opportunities where project_request_id=r.id;
  return jsonb_build_object('project_id',r.id,'opportunities',v_count,'open_bidding',true);
end;
$$;

create or replace function public.publish_open_project_opportunities(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.admin_has_permission('projects.manage')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'Project administrator required';end if;
  return public.publish_open_project_internal(p_project_id);
end;
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
      proposal_deadline_at=case when open_bidding then null else v_deadline end,search_next_check_at=v_deadline,updated_at=now() where id=v_request.id;
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
revoke all on function public.publish_open_project_internal(uuid) from public,anon,authenticated,service_role;

-- Upgrade any previously published listings without reopening stopped or awarded projects.
update public.project_requests set proposal_deadline_at=null,search_next_check_at=now()
where open_bidding and is_open and search_status not in ('stopped','awarded');
update public.contractor_opportunities o set expires_at='infinity'
from public.project_requests r where r.id=o.project_request_id and r.open_bidding and r.is_open
  and o.status in ('new','viewed')
  and not exists(select 1 from public.contractor_proposals p where p.opportunity_id=o.id and p.status='needs_changes');
notify pgrst,'reload schema';
commit;
