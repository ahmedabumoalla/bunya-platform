begin;

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
  select distinct v_id,c.id,'new'::public.contractor_opportunity_status,v_deadline from public.contractor_profiles c join public.contractor_profile_regions r on r.profile_id=c.id join public.contractor_profile_specialties s on s.profile_id=c.id join public.contractor_availability a on a.contractor_profile_id=c.id and a.status='available' where c.approval_status='approved' and c.subscription_active and lower(r.region_name)=lower(p_request->>'region') and lower(s.specialty_name)=any(select lower(x) from unnest(p_specialties)x) and c.average_rating>=coalesce(nullif(p_request->>'minimum_rating','')::numeric,0) on conflict do nothing;
  get diagnostics v_count=row_count;
  insert into public.contractor_opportunity_matches(opportunity_id,specialty_matched,region_matched,account_approved,availability_matched,rating_matched,eligible,reasons) select id,true,true,true,true,true,true,'{}' from public.contractor_opportunities where project_request_id=v_id on conflict(opportunity_id) do nothing;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) select 'contractor_opportunity',o.id,'contractor.opportunity_new',jsonb_build_object('contractor_profile_id',o.contractor_profile_id),'contractor-opportunity:'||o.id from public.contractor_opportunities o where o.project_request_id=v_id;
  if v_count=0 then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('project_request',v_id,'admin.project_no_contractors','{}','project-no-contractors:'||v_id);end if;
  insert into public.contractor_workflow_idempotency values(auth.uid(),'project_request',p_idempotency_key,v_id,now());return v_id;
end $$;

revoke execute on function public.submit_customer_project_request(jsonb,text[],text) from public,anon;
grant execute on function public.submit_customer_project_request(jsonb,text[],text) to authenticated;

commit;
