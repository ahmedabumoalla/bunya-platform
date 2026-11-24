begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('project-media','project-media',false,52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);

create policy project_media_stage on storage.objects for insert to authenticated with check (
  bucket_id='project-media' and split_part(name,'/',1)=auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/media/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$'
  and exists(select 1 from public.customer_profiles where profile_id=auth.uid())
);

create unique index project_media_attachment_path on public.customer_project_request_attachments(storage_path)
  where category='site_photos' and split_part(storage_path,'/',2)='media';

create or replace function public.submit_project_with_media(
  p_request jsonb,p_specialties text[],p_idempotency_key text,p_media jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  project_id uuid;
  item jsonb;
  object_path text;
  object_meta jsonb;
  mime text;
  ext text;
  byte_count bigint;
  previous_id uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media) not between 1 and 8 then
    raise exception 'Invalid project media'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':project:' || p_idempotency_key,0));
  select entity_id into previous_id from public.contractor_workflow_idempotency
    where profile_id=auth.uid() and scope='project_request' and key=p_idempotency_key;
  project_id:=public.submit_customer_project_request(p_request,p_specialties,p_idempotency_key);
  if previous_id is not null then
    if (select array_agg(value->>'path' order by value->>'path') from jsonb_array_elements(p_media))
       is distinct from (select array_agg(a.storage_path order by a.storage_path) from public.customer_project_request_attachments a
         where a.project_request_id=project_id and a.category='site_photos' and split_part(a.storage_path,'/',2)='media') then
      raise exception 'Project media does not match original submission';end if;
    return previous_id;
  end if;
  for item in select value from jsonb_array_elements(p_media) loop
    object_path:=item->>'path';
    if split_part(object_path,'/',1) is distinct from auth.uid()::text or
       object_path !~ '^[0-9a-f-]{36}/media/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$'
       or length(btrim(coalesce(item->>'name',''))) not between 1 and 240 then raise exception 'Invalid media path or name';end if;
    select metadata into strict object_meta from storage.objects where bucket_id='project-media' and name=object_path;
    mime:=object_meta->>'mimetype';
    ext:=case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
      when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' when 'video/quicktime' then 'mov' end;
    byte_count:=(object_meta->>'size')::bigint;
    if ext is null or right(object_path,length(ext)+1)<>'.'||ext or byte_count is null or byte_count not between 1 and 52428800 then
      raise exception 'Invalid project media object';end if;
    if not exists(select 1 from public.customer_project_request_attachments a where a.project_request_id=project_id and a.storage_path=object_path) then
      insert into public.customer_project_request_attachments(project_request_id,storage_path,file_name,mime_type,file_size_bytes,category,is_contractor_visible)
      values(project_id,object_path,item->>'name',mime,byte_count,'site_photos',true);
    end if;
  end loop;
  if (select count(*) from public.customer_project_request_attachments a where a.project_request_id=project_id and a.category='site_photos' and split_part(a.storage_path,'/',2)='media')>8 then
    raise exception 'Too many attachments'; end if;
  return project_id;
end; $$;

create or replace function public.project_visible_media(p_project_id uuid default null,p_path text default null)
returns table(storage_path text,file_name text,mime_type text)
language sql stable security definer set search_path=public,pg_temp as $$
  select a.storage_path,a.file_name,a.mime_type
  from public.customer_project_request_attachments a join public.project_requests r on r.id=a.project_request_id
  where (p_project_id is not null or p_path is not null)
    and (p_project_id is null or r.id=p_project_id) and (p_path is null or a.storage_path=p_path)
    and a.category='site_photos' and split_part(a.storage_path,'/',1)=r.customer_profile_id::text
    and split_part(a.storage_path,'/',2)='media'
    and (r.customer_profile_id=auth.uid() or (a.is_contractor_visible and r.id in (select o.project_request_id from public.get_contractor_opportunities() o)))
  order by a.uploaded_at,a.id;
$$;

create policy project_media_read on storage.objects for select to authenticated using
  (bucket_id='project-media' and (split_part(name,'/',1)=auth.uid()::text or exists(select 1 from public.project_visible_media(null,name))));

create policy project_media_discard on storage.objects for delete to authenticated using
  (bucket_id='project-media' and split_part(name,'/',1)=auth.uid()::text
   and not exists(select 1 from public.project_visible_media(null,name)));

revoke all on function public.project_visible_media(uuid,text), public.submit_project_with_media(jsonb,text[],text,jsonb) from public,anon;
grant execute on function public.project_visible_media(uuid,text), public.submit_project_with_media(jsonb,text[],text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
