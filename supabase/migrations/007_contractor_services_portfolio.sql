begin;

do $$ begin
  if to_regclass('public.contractor_services') is null or to_regclass('public.contractor_portfolio_items') is null or to_regclass('public.outbox_events') is null then
    raise exception '007 requires migrations 001-006';
  end if;
end $$;

alter table public.contractor_services
  add column if not exists title text,
  add column if not exists review_status text not null default 'draft',
  add column if not exists review_notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz;
update public.contractor_services set title=name where title is null;
alter table public.contractor_services alter column title set not null;
alter table public.contractor_services add constraint contractor_services_review_status_check check(review_status in('draft','pending_review','approved','rejected','needs_changes'));

alter table public.contractor_portfolio_items
  add column if not exists completion_date date,
  add column if not exists region text,
  add column if not exists review_status text not null default 'draft',
  add column if not exists review_notes text,
  add column if not exists deleted_at timestamptz;
alter table public.contractor_portfolio_items add constraint contractor_portfolio_review_status_check check(review_status in('draft','pending_review','approved','rejected','needs_changes'));

create index if not exists contractor_services_review_idx on public.contractor_services(review_status,created_at desc) where deleted_at is null;
create index if not exists contractor_services_owner_active_idx on public.contractor_services(contractor_profile_id,is_active,updated_at desc) where deleted_at is null;
create index if not exists contractor_portfolio_review_idx on public.contractor_portfolio_items(review_status,created_at desc) where deleted_at is null;
create index if not exists contractor_portfolio_owner_visible_idx on public.contractor_portfolio_items(profile_id,is_visible,sort_order) where deleted_at is null;
create index if not exists contractor_portfolio_media_item_sort_idx on public.contractor_portfolio_media(portfolio_item_id,sort_order,created_at);
alter table public.contractor_portfolio_media add constraint contractor_portfolio_media_mime_check check(mime_type in('image/jpeg','image/png','image/webp','video/mp4'));

create or replace function public.protect_contractor_catalog_review_fields() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_user='postgres' or coalesce(auth.jwt()->>'role','')='service_role' or public.admin_has_permission('reviews.manage') then return new;end if;
  if tg_table_name='contractor_services' then
    if new.contractor_profile_id is distinct from old.contractor_profile_id or new.review_status is distinct from old.review_status or new.review_notes is distinct from old.review_notes or new.deleted_at is distinct from old.deleted_at then raise exception 'Protected service fields';end if;
  else
    if new.profile_id is distinct from old.profile_id or new.review_status is distinct from old.review_status or new.review_notes is distinct from old.review_notes or new.is_approved is distinct from old.is_approved or new.deleted_at is distinct from old.deleted_at then raise exception 'Protected portfolio fields';end if;
  end if;
  return new;
end $$;
drop trigger if exists contractor_services_protect_review on public.contractor_services;
create trigger contractor_services_protect_review before update on public.contractor_services for each row execute function public.protect_contractor_catalog_review_fields();
drop trigger if exists contractor_portfolio_protect_review on public.contractor_portfolio_items;
create trigger contractor_portfolio_protect_review before update on public.contractor_portfolio_items for each row execute function public.protect_contractor_catalog_review_fields();

create or replace function public.save_contractor_service(p_id uuid,p_service jsonb,p_regions text[],p_submit boolean) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_contractor uuid;v_id uuid;v_pricing public.contractor_pricing_method;v_review text;
begin
  select id into v_contractor from public.contractor_profiles where profile_id=auth.uid() limit 1;if v_contractor is null then raise exception 'Contractor profile required';end if;
  if length(btrim(p_service->>'title')) not between 3 and 160 or length(btrim(p_service->>'description'))<10 or length(btrim(p_service->>'specialty'))<2 or length(btrim(p_service->>'estimated_duration'))<2 or cardinality(p_regions) not between 1 and 30 then raise exception 'Invalid service';end if;
  v_pricing:=(p_service->>'pricing_method')::public.contractor_pricing_method;v_review:=case when p_submit then 'pending_review' else 'draft' end;
  if p_id is null then
    insert into public.contractor_services(contractor_profile_id,name,title,primary_specialty,description,pricing_method,minimum_price,maximum_price,estimated_duration,status,is_active,review_status)
    values(v_contractor,btrim(p_service->>'title'),btrim(p_service->>'title'),btrim(p_service->>'specialty'),btrim(p_service->>'description'),v_pricing,nullif(p_service->>'minimum_price','')::numeric,nullif(p_service->>'maximum_price','')::numeric,btrim(p_service->>'estimated_duration'),'pending_review',coalesce((p_service->>'is_active')::boolean,true),v_review) returning id into v_id;
  else
    update public.contractor_services set name=btrim(p_service->>'title'),title=btrim(p_service->>'title'),primary_specialty=btrim(p_service->>'specialty'),description=btrim(p_service->>'description'),pricing_method=v_pricing,minimum_price=nullif(p_service->>'minimum_price','')::numeric,maximum_price=nullif(p_service->>'maximum_price','')::numeric,estimated_duration=btrim(p_service->>'estimated_duration'),is_active=coalesce((p_service->>'is_active')::boolean,true),review_status=v_review,review_notes=null,status='pending_review',updated_at=now() where id=p_id and contractor_profile_id=v_contractor and deleted_at is null and review_status in('draft','rejected','needs_changes','approved') returning id into v_id;
    if v_id is null then raise exception 'Service cannot be edited';end if;
  end if;
  delete from public.contractor_service_regions where service_id=v_id;insert into public.contractor_service_regions(service_id,region_name)select v_id,btrim(x)from unnest(p_regions)x where btrim(x)<>'' on conflict do nothing;
  if p_submit then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_service',v_id,'admin.contractor_service_submitted',jsonb_build_object('contractor_id',v_contractor),'service-submit:'||v_id||':'||extract(epoch from now())::bigint);end if;
  return v_id;
end $$;

create or replace function public.set_contractor_service_active(p_id uuid,p_active boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.contractor_services set is_active=p_active,status=case when p_active and review_status='approved' then 'active'::public.contractor_service_status else 'hidden'::public.contractor_service_status end,updated_at=now() where id=p_id and public.is_contractor_owner(contractor_profile_id) and deleted_at is null;if not found then raise exception 'Service not found';end if;end $$;
create or replace function public.delete_contractor_service(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.contractor_services set deleted_at=now(),is_active=false,status='hidden',updated_at=now() where id=p_id and public.is_contractor_owner(contractor_profile_id) and deleted_at is null;if not found then raise exception 'Service not found';end if;end $$;

create or replace function public.save_contractor_portfolio_item(p_id uuid,p_item jsonb,p_submit boolean) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_contractor uuid;v_id uuid;v_review text;
begin select id into v_contractor from public.contractor_profiles where profile_id=auth.uid() limit 1;if v_contractor is null then raise exception 'Contractor profile required';end if;
  if length(btrim(p_item->>'title')) not between 3 and 160 or length(btrim(p_item->>'description'))<10 or length(btrim(p_item->>'project_type'))<2 then raise exception 'Invalid portfolio item';end if;v_review:=case when p_submit then 'pending_review' else 'draft' end;
  if p_id is null then insert into public.contractor_portfolio_items(profile_id,title,description,project_type,completion_date,city,region,is_visible,is_approved,review_status,sort_order)values(v_contractor,btrim(p_item->>'title'),btrim(p_item->>'description'),btrim(p_item->>'project_type'),nullif(p_item->>'completion_date','')::date,nullif(btrim(p_item->>'city'),''),nullif(btrim(p_item->>'region'),''),coalesce((p_item->>'visibility')::boolean,false),false,v_review,greatest(0,coalesce((p_item->>'sort_order')::integer,0))) returning id into v_id;
  else update public.contractor_portfolio_items set title=btrim(p_item->>'title'),description=btrim(p_item->>'description'),project_type=btrim(p_item->>'project_type'),completion_date=nullif(p_item->>'completion_date','')::date,city=nullif(btrim(p_item->>'city'),''),region=nullif(btrim(p_item->>'region'),''),is_visible=coalesce((p_item->>'visibility')::boolean,false),is_approved=false,review_status=v_review,review_notes=null,sort_order=greatest(0,coalesce((p_item->>'sort_order')::integer,0)),updated_at=now() where id=p_id and profile_id=v_contractor and deleted_at is null and review_status in('draft','rejected','needs_changes','approved') returning id into v_id;if v_id is null then raise exception 'Portfolio item cannot be edited';end if;end if;
  if p_submit then insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_portfolio',v_id,'admin.contractor_portfolio_submitted',jsonb_build_object('contractor_id',v_contractor),'portfolio-submit:'||v_id||':'||extract(epoch from now())::bigint);end if;return v_id;
end $$;
create or replace function public.set_contractor_portfolio_visibility(p_id uuid,p_visible boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin update public.contractor_portfolio_items set is_visible=p_visible,updated_at=now() where id=p_id and public.is_contractor_owner(profile_id) and deleted_at is null;if not found then raise exception 'Portfolio item not found';end if;end$$;
create or replace function public.delete_contractor_portfolio_item(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin update public.contractor_portfolio_items set deleted_at=now(),is_visible=false,updated_at=now() where id=p_id and public.is_contractor_owner(profile_id) and deleted_at is null;if not found then raise exception 'Portfolio item not found';end if;end$$;
create or replace function public.set_contractor_portfolio_primary_media(p_item_id uuid,p_media_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin if not exists(select 1 from public.contractor_portfolio_items where id=p_item_id and public.is_contractor_owner(profile_id) and deleted_at is null) then raise exception 'Portfolio item not found';end if;update public.contractor_portfolio_media set is_primary=false where portfolio_item_id=p_item_id;update public.contractor_portfolio_media set is_primary=true where id=p_media_id and portfolio_item_id=p_item_id;if not found then raise exception 'Media not found';end if;end$$;

create or replace function public.review_contractor_catalog_item(p_kind text,p_id uuid,p_decision text,p_notes text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_contractor uuid;v_old text;
begin if not public.admin_has_permission('reviews.manage') or p_kind not in('service','portfolio') or p_decision not in('approved','rejected','needs_changes') or length(btrim(p_notes))<5 then raise exception 'Invalid or unauthorized review';end if;
  if p_kind='service' then select contractor_profile_id,review_status into v_contractor,v_old from public.contractor_services where id=p_id and deleted_at is null for update;if not found then raise exception 'Service not found';end if;update public.contractor_services set review_status=p_decision,review_notes=btrim(p_notes),status=case when p_decision='approved' and is_active then 'active'::public.contractor_service_status else 'hidden'::public.contractor_service_status end,updated_at=now() where id=p_id;
  else select profile_id,review_status into v_contractor,v_old from public.contractor_portfolio_items where id=p_id and deleted_at is null for update;if not found then raise exception 'Portfolio item not found';end if;update public.contractor_portfolio_items set review_status=p_decision,review_notes=btrim(p_notes),is_approved=(p_decision='approved'),updated_at=now() where id=p_id;end if;
  insert into public.audit_logs(actor_profile_id,contractor_profile_id,entity_table,entity_id,action,old_data,new_data)values(auth.uid(),v_contractor,case when p_kind='service' then 'contractor_services' else 'contractor_portfolio_items' end,p_id::text,p_kind||'_review_'||p_decision,jsonb_build_object('review_status',v_old),jsonb_build_object('review_status',p_decision,'notes',btrim(p_notes)));
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)values('contractor_'||p_kind,p_id,'contractor.'||p_kind||'_'||p_decision,jsonb_build_object('contractor_id',v_contractor,'notes',btrim(p_notes)),p_kind||'-review:'||p_id||':'||p_decision||':'||extract(epoch from now())::bigint);
end $$;

drop policy if exists contractor_services_public_select on public.contractor_services;
drop policy if exists contractor_services_owner_all on public.contractor_services;
create policy contractor_services_public_select on public.contractor_services for select to anon,authenticated using(deleted_at is null and ((review_status='approved' and is_active and status='active' and exists(select 1 from public.contractor_profiles c where c.id=contractor_profile_id and c.approval_status='approved' and c.subscription_active and c.directory_visible)) or public.is_contractor_owner(contractor_profile_id) or public.is_admin()));
create policy contractor_services_owner_insert on public.contractor_services for insert to authenticated with check(public.is_contractor_owner(contractor_profile_id) and review_status in('draft','pending_review'));
create policy contractor_services_owner_update on public.contractor_services for update to authenticated using(public.is_contractor_owner(contractor_profile_id) and deleted_at is null) with check(public.is_contractor_owner(contractor_profile_id));
create policy contractor_services_admin_all on public.contractor_services for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists contractor_portfolio_public_read on public.contractor_portfolio_items;drop policy if exists contractor_portfolio_owner_all on public.contractor_portfolio_items;
create policy contractor_portfolio_public_read on public.contractor_portfolio_items for select to anon,authenticated using(deleted_at is null and ((is_visible and review_status='approved' and is_approved and exists(select 1 from public.contractor_profiles p where p.id=profile_id and p.approval_status='approved' and p.subscription_active and p.directory_visible)) or public.is_contractor_owner(profile_id) or public.is_admin()));
create policy contractor_portfolio_owner_insert on public.contractor_portfolio_items for insert to authenticated with check(public.is_contractor_owner(profile_id) and review_status in('draft','pending_review') and not is_approved);
create policy contractor_portfolio_owner_update on public.contractor_portfolio_items for update to authenticated using(public.is_contractor_owner(profile_id) and deleted_at is null) with check(public.is_contractor_owner(profile_id));
create policy contractor_portfolio_admin_all on public.contractor_portfolio_items for all to authenticated using(public.is_admin()) with check(public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('contractor-portfolio','contractor-portfolio',false,10485760,array['image/jpeg','image/png','image/webp','video/mp4'])on conflict(id)do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists contractor_portfolio_storage_insert on storage.objects;drop policy if exists contractor_portfolio_storage_select on storage.objects;drop policy if exists contractor_portfolio_storage_update on storage.objects;drop policy if exists contractor_portfolio_storage_delete on storage.objects;
create policy contractor_portfolio_storage_insert on storage.objects for insert to authenticated with check(bucket_id='contractor-portfolio' and exists(select 1 from public.contractor_profiles c where c.profile_id=auth.uid() and c.id=public.safe_storage_folder_uuid(name)));
create policy contractor_portfolio_storage_select on storage.objects for select to authenticated using(bucket_id='contractor-portfolio' and (exists(select 1 from public.contractor_profiles c where c.profile_id=auth.uid() and c.id=public.safe_storage_folder_uuid(name)) or public.is_admin()));
create policy contractor_portfolio_storage_update on storage.objects for update to authenticated using(bucket_id='contractor-portfolio' and exists(select 1 from public.contractor_profiles c where c.profile_id=auth.uid() and c.id=public.safe_storage_folder_uuid(name))) with check(bucket_id='contractor-portfolio' and exists(select 1 from public.contractor_profiles c where c.profile_id=auth.uid() and c.id=public.safe_storage_folder_uuid(name)));
create policy contractor_portfolio_storage_delete on storage.objects for delete to authenticated using(bucket_id='contractor-portfolio' and (exists(select 1 from public.contractor_profiles c where c.profile_id=auth.uid() and c.id=public.safe_storage_folder_uuid(name)) or public.is_admin()));

grant select,insert,update on public.contractor_services,public.contractor_service_regions,public.contractor_portfolio_items,public.contractor_portfolio_media to authenticated;
grant select on public.contractor_services,public.contractor_service_regions,public.contractor_portfolio_items,public.contractor_portfolio_media to anon;
revoke execute on function public.save_contractor_service(uuid,jsonb,text[],boolean),public.set_contractor_service_active(uuid,boolean),public.delete_contractor_service(uuid),public.save_contractor_portfolio_item(uuid,jsonb,boolean),public.set_contractor_portfolio_visibility(uuid,boolean),public.delete_contractor_portfolio_item(uuid),public.set_contractor_portfolio_primary_media(uuid,uuid),public.review_contractor_catalog_item(text,uuid,text,text) from public,anon;
grant execute on function public.save_contractor_service(uuid,jsonb,text[],boolean),public.set_contractor_service_active(uuid,boolean),public.delete_contractor_service(uuid),public.save_contractor_portfolio_item(uuid,jsonb,boolean),public.set_contractor_portfolio_visibility(uuid,boolean),public.delete_contractor_portfolio_item(uuid),public.set_contractor_portfolio_primary_media(uuid,uuid),public.review_contractor_catalog_item(text,uuid,text,text) to authenticated;

commit;
