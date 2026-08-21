begin;

do $$
begin
  if to_regprocedure('public.submit_customer_rfq(jsonb,jsonb,text)') is null then
    raise exception '011 requires submit_customer_rfq from migration 005';
  end if;
end
$$;

-- PostgreSQL resolves the CASE branches below as text. Cast the complete CASE
-- expressions explicitly before assigning them to enum columns.
create or replace function public.submit_customer_rfq(p_request jsonb, p_items jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_id uuid;v_item jsonb;v_item_id uuid;v_source uuid;v_source_item uuid;v_deadline timestamptz;v_required timestamptz;v_city text;v_count integer:=0;v_added integer;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.customer_profiles where profile_id=auth.uid()) then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid items';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':rfq:'||p_idempotency_key,0));
  select aggregate_id into v_id from public.outbox_events where aggregate_type='quote_request' and idempotency_key='rfq:'||auth.uid()||':'||p_idempotency_key limit 1;
  if found then return v_id;end if;
  v_city:=btrim(p_request->>'city');v_required:=(p_request->>'desired_receipt_at')::timestamptz;v_deadline:=least(v_required-interval '1 hour',now()+interval '24 hours');
  if length(v_city)<2 or v_required<=now()+interval '2 hours' then raise exception 'Invalid request schedule';end if;
  insert into public.quote_requests(request_code,requester_id,requester_role,city,location_hint,desired_receipt_at,quote_window_label,quote_deadline,notes,status,delivery_mode,project_name,recipient_name,recipient_mobile)
  values('RFQ-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),auth.uid(),'customer',v_city,btrim(coalesce(p_request->>'location_hint',v_city)),v_required,'24 hours',v_deadline,nullif(btrim(p_request->>'notes'),''),'submitted',case when p_request->>'delivery_mode'='pickup' then 'pickup' else 'delivery' end,nullif(btrim(p_request->>'project_name'),''),nullif(btrim(p_request->>'recipient_name'),''),nullif(btrim(p_request->>'recipient_mobile'),'')) returning id into v_id;
  insert into public.internal_sourcing_requests(internal_code,customer_request_id,stage,expected_ready_at,response_deadline_at)
  values('SRC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),v_id,'received',least(v_required,now()+interval '48 hours'),v_deadline) returning id into v_source;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Invalid item quantity';end if;
    insert into public.quote_request_items(request_id,product_id,measurement_id,unit_id,product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes)
    select v_id,p.id,nullif(v_item->>'measurement_id','')::uuid,nullif(v_item->>'unit_id','')::uuid,p.name,nullif(btrim(v_item->>'measurement'),''),coalesce(nullif(btrim(v_item->>'unit'),''),p.base_unit),(v_item->>'quantity')::numeric,nullif(btrim(v_item->>'notes'),'') from public.products p where p.id=(v_item->>'product_id')::uuid and p.is_published and p.review_status='approved' returning id into v_item_id;
    if v_item_id is null then raise exception 'Product is not available';end if;
    insert into public.internal_sourcing_request_items(sourcing_request_id,quote_request_item_id,product_id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at)
    select v_source,v_item_id,i.product_id,i.quantity,i.unit_name_snapshot,i.measurement_label_snapshot,v_city,v_required from public.quote_request_items i where i.id=v_item_id returning id into v_source_item;
    insert into public.internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at)
    select v_source_item,p.id,v_deadline from public.providers p join public.provider_product_prices pp on pp.provider_id=p.id and pp.product_id=(v_item->>'product_id')::uuid join public.subscriptions s on s.profile_id=p.owner_profile_id and s.status='active' and (s.ends_at is null or s.ends_at>now()) where p.status='approved' and pp.expires_at>now() and pp.freshness_status in('valid','expiring_soon') and (p.application_id is null or exists(select 1 from public.provider_delivery_regions r where r.application_id=p.application_id and lower(r.region_name)=lower(v_city)) or p_request->>'delivery_mode'='pickup') on conflict do nothing;
    get diagnostics v_added=row_count;v_count:=v_count+v_added;
  end loop;
  update public.quote_requests set status=(case when v_count>0 then 'sourcing' else 'verifying' end)::public.quote_request_status where id=v_id;
  update public.internal_sourcing_requests set stage=(case when v_count>0 then 'comparing_prices' else 'verifying_availability' end)::public.quote_processing_stage where id=v_source;
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values('quote_request',v_id,case when v_count>0 then 'rfq.submitted' else 'admin.rfq_no_providers' end,jsonb_build_object('sourcing_request_id',v_source),'rfq:'||auth.uid()||':'||p_idempotency_key);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select 'sourcing_target',t.sourcing_request_item_id,'provider.rfq_new',jsonb_build_object('provider_id',t.provider_id,'sourcing_item_id',t.sourcing_request_item_id),'rfq-target:'||t.sourcing_request_item_id||':'||t.provider_id from public.internal_sourcing_request_targets t join public.internal_sourcing_request_items i on i.id=t.sourcing_request_item_id where i.sourcing_request_id=v_source on conflict(idempotency_key) where idempotency_key is not null do nothing;
  return v_id;
end
$$;

revoke execute on function public.submit_customer_rfq(jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;

commit;
