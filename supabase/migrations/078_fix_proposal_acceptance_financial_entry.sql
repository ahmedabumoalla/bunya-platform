begin;

-- Migration 008 made financial_kind mandatory after the proposal workflow was
-- introduced. Keep proposal acceptance atomic by writing the complete ledger
-- entry shape expected by the current schema.
create or replace function public.decide_contractor_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.contractor_proposals%rowtype;
  v_request public.project_requests%rowtype;
  v_project uuid;
begin
  if p_decision not in ('accepted', 'rejected', 'needs_changes')
     or length(btrim(p_reason)) < 5
     or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'Invalid decision';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':proposal-decision:' || p_idempotency_key, 0)
  );

  select p.* into v_p
  from public.contractor_proposals p
  where p.id = p_proposal_id
  for update;
  if not found or v_p.status not in ('under_review', 'needs_changes') then
    raise exception 'Proposal is not reviewable';
  end if;

  select r.* into v_request
  from public.contractor_opportunities o
  join public.project_requests r on r.id = o.project_request_id
  where o.id = v_p.opportunity_id
  for update;
  if v_request.customer_profile_id <> auth.uid()
     and not public.admin_has_permission('projects.manage') then
    raise exception 'Not authorized';
  end if;

  update public.contractor_proposals
  set status = p_decision::public.contractor_proposal_status,
      reviewed_at = now(),
      rejection_reason = case when p_decision = 'rejected' then p_reason end,
      change_request = case when p_decision = 'needs_changes' then p_reason end,
      updated_at = now()
  where id = v_p.id;

  if p_decision = 'accepted' then
    insert into public.contractor_projects(
      project_code, accepted_proposal_id, contractor_profile_id,
      customer_profile_id, name, customer_label, project_value, start_at,
      expected_end_at, scope, status
    )
    values (
      'CTR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_p.id, v_p.contractor_profile_id, v_request.customer_profile_id,
      v_request.title, v_request.customer_label, v_p.amount,
      coalesce(v_p.proposed_start_at, current_date),
      coalesce(v_p.proposed_start_at, current_date)
        + greatest(1, v_request.proposal_deadline_at::date - current_date),
      coalesce(v_p.scope_details, v_request.scope), 'awaiting_start'
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
    set lifecycle_status = 'awarded', is_open = false, updated_at = now()
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
  end if;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  values (
    'contractor_proposal', v_p.id, 'contractor.proposal_' || p_decision,
    jsonb_build_object('project_id', v_project),
    'proposal-decision:' || v_p.id || ':' || p_decision
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  insert into public.audit_logs(
    actor_profile_id, contractor_profile_id, entity_table, entity_id,
    action, new_data
  )
  values (
    auth.uid(), v_p.contractor_profile_id, 'contractor_proposals',
    v_p.id::text, 'proposal_' || p_decision,
    jsonb_build_object('reason', p_reason, 'project_id', v_project)
  );
  return v_project;
end
$$;

revoke execute on function public.decide_contractor_proposal(uuid, text, text, text)
  from public, anon;
grant execute on function public.decide_contractor_proposal(uuid, text, text, text)
  to authenticated;

commit;
