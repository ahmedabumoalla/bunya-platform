begin;

do $$ begin
  if to_regclass('public.contractor_projects') is null or to_regclass('public.outbox_events') is null then raise exception '006 requires migrations 001-005';end if;
end $$;

alter table public.contractor_notifications add column event_key text;
create unique index contractor_notifications_event_key_idx on public.contractor_notifications(event_key) where event_key is not null;

create table public.contractor_workflow_idempotency(
  profile_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  key text not null,
  entity_id uuid,
  created_at timestamptz not null default now(),
  primary key(profile_id,scope,key)
);
alter table public.contractor_workflow_idempotency enable row level security;

create or replace function public.submit_customer_project_request(p_request jsonb,p_specialties text[],p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid;v_deadline timestamptz;v_count integer:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.customer_profiles where profile_id=auth.uid()) then raise exception 'Verified customer required';end if;
  if length(p_idempotency_key) not between 8 and 120 or cardinality(p_specialties) not between 1 and 20 then raise exception 'Invalid request';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':project:'||p_idempotency_key,0));
  select entity_id into v_id from public.contractor_workflow_idempotency where profile_id=auth.uid() and scope='project_request' and key=p_idempotency_key;
  if found then return v_id;end if;
  v_deadline:=(p_request->>'proposal_deadline_at')::timestamptz;if v_deadline<=now()+interval '1 hour' then raise exception 'Invalid deadline';end if;
  insert into public.project_requests(request_code,customer_profile_id,title,project_type,description,scope,city,region,quantity_label,estimated_budget_min,estimated_budget_max,expected_start_at,estimated_duration,proposal_deadline_at,minimum_rating,customer_label,terms,is_open,lifecycle_status,submitted_at,published_at,budget_negotiable,duration_value,duration_unit,location_name,access_description,technical_details)
  values('PRJ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),auth.uid(),btrim(p_request->>'title'),btrim(p_request->>'project_type'),btrim(p_request->>'description'),btrim(p_request->>'scope'),btrim(p_request->>'city'),btrim(p_request->>'region'),nullif(btrim(p_request->>'quantity_label'),''),nullif(p_request->>'budget_min','')::numeric,(p_request->>'budget_max')::numeric,(p_request->>'expected_start_at')::date,btrim(p_request->>'estimated_duration'),v_deadline,nullif(p_request->>'minimum_rating','')::numeric,'عميل بُنية',coalesce(array(select jsonb_array_elements_text(coalesce(p_request->'terms','[]'))),'{}'),true,'receiving_proposals',now(),now(),coalesce((p_request->>'budget_negotiable')::boolean,false),nullif(p_request->>'duration_value','')::numeric,nullif(p_request->>'duration_unit',''),nullif(btrim(p_request->>'location_name'),''),nullif(btrim(p_request->>'access_description'),''),coalesce(p_request->'technical_details','{}')) returning id into v_id;
  insert into public.project_request_specialties(project_request_id,specialty_name) select v_id,btrim(x) from unnest(p_specialties)x where btrim(x)<>'' on conflict do nothing;
  insert into public.contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at)
  select distinct v_id,c.id,'new',v_deadline from public.contractor_profiles c join public.contractor_profile_regions r on r.profile_id=c.id join public.contractor_profile_specialties s on s.profile_id=c.id join public.contractor_availability a on a.contractor_profile_id=c.id and a.status='available' where c.approval_status='approved' and c.subscription_active and lower(r.region_name)=lower(p_request->>'region') and lower(s.specialty_name)=any(select lower(x) from unnest(p_specialties)x) and c.average_rating>=coalesce(nullif(p_request->>'minimum_rating','')::numeric,0) on conflict do nothing;
  get diagnostics v_count=row_count;
  insert into public.contractor_opportunity_matches(opportunity_id,specialty_matched,region_matched,account_approved,availability_matched,rating_matched,eligible,reasons) select id,true,true,true,true,true,true,'{}' from public.contractor_opportunities where project_request_id=v_id on conflict(opportunity_id) do nothing;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'contractor_opportunity',o.id,'contractor.opportunity_new',jsonb_build_object('contractor_profile_id',o.contractor_profile_id),'contractor-opportunity:'||o.id from public.contractor_opportunities o where o.project_request_id=v_id;
  if v_count=0 then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('project_request',v_id,'admin.project_no_contractors','{}','project-no-contractors:'||v_id);end if;
  insert into public.contractor_workflow_idempotency values(auth.uid(),'project_request',p_idempotency_key,v_id,now());return v_id;
end $$;

create or replace function public.save_contractor_proposal(p_opportunity_id uuid,p_proposal jsonb,p_stages jsonb,p_submit boolean,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_contractor uuid;v_opportunity public.contractor_opportunities%rowtype;v_id uuid;v_stage jsonb;v_status public.contractor_proposal_status;
begin
  select id into v_contractor from public.contractor_profiles where profile_id=auth.uid() and approval_status='approved' and subscription_active limit 1;if v_contractor is null then raise exception 'Active contractor required';end if;
  select * into v_opportunity from public.contractor_opportunities where id=p_opportunity_id and contractor_profile_id=v_contractor for update;if not found or v_opportunity.expires_at<=now() then raise exception 'Opportunity unavailable';end if;
  if p_submit and (jsonb_typeof(p_stages)<>'array' or jsonb_array_length(p_stages)=0) then raise exception 'Proposal stages required';end if;v_status:=case when p_submit then 'under_review' else 'draft' end;
  insert into public.contractor_proposals(proposal_code,opportunity_id,contractor_profile_id,amount,vat_inclusive,execution_duration,proposed_start_at,scope_details,includes,excludes,valid_until,warranty,team,notes,policy_accepted,status,submitted_at)
  values('CP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_opportunity_id,v_contractor,coalesce((p_proposal->>'amount')::numeric,0),coalesce((p_proposal->>'vat_inclusive')::boolean,false),nullif(btrim(p_proposal->>'execution_duration'),''),nullif(p_proposal->>'proposed_start_at','')::date,nullif(btrim(p_proposal->>'scope_details'),''),coalesce(array(select jsonb_array_elements_text(coalesce(p_proposal->'includes','[]'))),'{}'),coalesce(array(select jsonb_array_elements_text(coalesce(p_proposal->'excludes','[]'))),'{}'),nullif(p_proposal->>'valid_until','')::timestamptz,nullif(btrim(p_proposal->>'warranty'),''),nullif(btrim(p_proposal->>'team'),''),nullif(btrim(p_proposal->>'notes'),''),coalesce((p_proposal->>'policy_accepted')::boolean,false),v_status,case when p_submit then now() end)
  on conflict(opportunity_id,contractor_profile_id) do update set amount=excluded.amount,vat_inclusive=excluded.vat_inclusive,execution_duration=excluded.execution_duration,proposed_start_at=excluded.proposed_start_at,scope_details=excluded.scope_details,includes=excluded.includes,excludes=excluded.excludes,valid_until=excluded.valid_until,warranty=excluded.warranty,team=excluded.team,notes=excluded.notes,policy_accepted=excluded.policy_accepted,status=excluded.status,submitted_at=excluded.submitted_at,updated_at=now() where contractor_proposals.status in('draft','needs_changes') returning id into v_id;
  if v_id is null then raise exception 'Proposal cannot be edited';end if;delete from public.contractor_proposal_stages where proposal_id=v_id;
  for v_stage in select value from jsonb_array_elements(p_stages) loop insert into public.contractor_proposal_stages(proposal_id,name,description,duration,value_percentage,expected_at,sort_order)values(v_id,btrim(v_stage->>'name'),btrim(v_stage->>'description'),btrim(v_stage->>'duration'),(v_stage->>'value_percentage')::numeric,(v_stage->>'expected_at')::date,coalesce((v_stage->>'sort_order')::integer,0));end loop;
  update public.contractor_opportunities set status=case when p_submit then 'proposed' else status end,updated_at=now() where id=p_opportunity_id;
  if p_submit then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_proposal',v_id,'contractor.proposal_submitted','{}','proposal-submitted:'||v_id);end if;return v_id;
end $$;

create or replace function public.decide_contractor_proposal(p_proposal_id uuid,p_decision text,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_p public.contractor_proposals%rowtype;v_request public.project_requests%rowtype;v_project uuid;v_stage record;
begin
  if p_decision not in('accepted','rejected','needs_changes') or length(btrim(p_reason))<5 then raise exception 'Invalid decision';end if;
  select p.* into v_p from public.contractor_proposals p where p.id=p_proposal_id for update;if not found or v_p.status not in('under_review','needs_changes') then raise exception 'Proposal is not reviewable';end if;
  select r.* into v_request from public.contractor_opportunities o join public.project_requests r on r.id=o.project_request_id where o.id=v_p.opportunity_id for update;if v_request.customer_profile_id<>auth.uid() and not public.admin_has_permission('projects.manage') then raise exception 'Not authorized';end if;
  update public.contractor_proposals set status=p_decision::public.contractor_proposal_status,reviewed_at=now(),rejection_reason=case when p_decision='rejected' then p_reason end,change_request=case when p_decision='needs_changes' then p_reason end,updated_at=now() where id=v_p.id;
  if p_decision='accepted' then
    insert into public.contractor_projects(project_code,accepted_proposal_id,contractor_profile_id,customer_profile_id,name,customer_label,project_value,start_at,expected_end_at,scope,status)
    values('CTR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_p.id,v_p.contractor_profile_id,v_request.customer_profile_id,v_request.title,v_request.customer_label,v_p.amount,coalesce(v_p.proposed_start_at,current_date),coalesce(v_p.proposed_start_at,current_date)+greatest(1,(v_request.proposal_deadline_at::date-current_date)),coalesce(v_p.scope_details,v_request.scope),'awaiting_start') on conflict(accepted_proposal_id) do update set accepted_proposal_id=excluded.accepted_proposal_id returning id into v_project;
    insert into public.contractor_project_milestones(project_id,name,description,start_at,expected_end_at,value_percentage,status,sort_order) select v_project,s.name,s.description,coalesce(v_p.proposed_start_at,current_date),s.expected_at,s.value_percentage,'not_started',s.sort_order from public.contractor_proposal_stages s where s.proposal_id=v_p.id on conflict do nothing;
    insert into public.contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,transaction_type,amount,status,balance_after)values('CTX-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_p.contractor_profile_id,v_project,'advance',0,'pending',0);
    update public.project_requests set lifecycle_status='awarded',is_open=false,updated_at=now() where id=v_request.id;update public.contractor_proposals set status='rejected',reviewed_at=now(),rejection_reason='تم اختيار عرض آخر' where id<>v_p.id and opportunity_id in(select id from public.contractor_opportunities where project_request_id=v_request.id) and status='under_review';
  end if;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_proposal',v_p.id,'contractor.proposal_'||p_decision,jsonb_build_object('project_id',v_project),'proposal-decision:'||v_p.id||':'||p_decision);insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,new_data)values(auth.uid(),v_p.contractor_profile_id,'contractor_proposals',v_p.id::text,'proposal_'||p_decision,jsonb_build_object('reason',p_reason,'project_id',v_project));return v_project;
end $$;

create or replace function public.transition_contractor_milestone(p_milestone_id uuid,p_action text,p_note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_m public.contractor_project_milestones%rowtype;v_p public.contractor_projects%rowtype;v_next public.contractor_milestone_status;
begin select * into v_m from public.contractor_project_milestones where id=p_milestone_id for update;select * into v_p from public.contractor_projects where id=v_m.project_id for update;if public.is_contractor_owner(v_p.contractor_profile_id) then v_next:=case p_action when 'start' then 'in_progress' when 'submit' then 'awaiting_customer_approval' when 'delay' then 'delayed' else null end;elsif v_p.customer_profile_id=auth.uid() then v_next:=case p_action when 'approve' then 'approved' when 'clarify' then 'in_progress' else null end;else raise exception 'Not authorized';end if;if v_next is null then raise exception 'Invalid action';end if;update public.contractor_project_milestones set status=v_next,progress=case when v_next='awaiting_customer_approval' then 100 else progress end,submitted_for_approval_at=case when v_next='awaiting_customer_approval' then now() else submitted_for_approval_at end,approved_at=case when v_next='approved' then now() else null end,updated_at=now() where id=v_m.id;update public.contractor_projects set progress=(select coalesce(sum(value_percentage*case when status='approved' then 1 else progress/100 end),0) from public.contractor_project_milestones where project_id=v_p.id),status=case when v_next='approved' and not exists(select 1 from public.contractor_project_milestones where project_id=v_p.id and id<>v_m.id and status<>'approved') then 'completed' when v_next='awaiting_customer_approval' then 'awaiting_milestone_approval' else status end,updated_at=now() where id=v_p.id;insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_milestone',v_m.id,case when v_next='awaiting_customer_approval' then 'customer.milestone_approval_requested' when v_next='approved' then 'contractor.milestone_approved' when p_action='clarify' then 'contractor.milestone_rejected' else 'contractor.milestone_started' end,jsonb_build_object('project_id',v_p.id),'milestone:'||v_m.id||':'||v_next||':'||v_m.updated_at);end $$;

revoke all on public.contractor_workflow_idempotency from public,anon,authenticated;grant all on public.contractor_workflow_idempotency to service_role;
revoke execute on function public.submit_customer_project_request(jsonb,text[],text) from public,anon;grant execute on function public.submit_customer_project_request(jsonb,text[],text) to authenticated;
revoke execute on function public.save_contractor_proposal(uuid,jsonb,jsonb,boolean,text) from public,anon;grant execute on function public.save_contractor_proposal(uuid,jsonb,jsonb,boolean,text) to authenticated;
revoke execute on function public.decide_contractor_proposal(uuid,text,text,text) from public,anon;grant execute on function public.decide_contractor_proposal(uuid,text,text,text) to authenticated;
revoke execute on function public.transition_contractor_milestone(uuid,text,text) from public,anon;grant execute on function public.transition_contractor_milestone(uuid,text,text) to authenticated;

commit;
