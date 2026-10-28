-- Setup only. Capture and Storage verification precede explicit activation.
create schema admin_archive;
revoke all on schema admin_archive from public, anon;
grant usage on schema admin_archive to authenticated, service_role;
grant usage on schema private to authenticated, service_role;

create table private.admin_archive_state (
  singleton boolean primary key default true check(singleton),
  captured_at timestamptz,
  capture_complete boolean not null default false,
  files_ready boolean not null default false,
  api_ready boolean not null default false,
  active boolean not null default false,
  activated_at timestamptz,
  previous_pre_request oid,
  check(not active or (capture_complete and files_ready and api_ready and captured_at is not null))
);
insert into private.admin_archive_state(singleton) values(true);
create table private.admin_archive_visibility (
  actor_id uuid not null,
  table_name text not null,
  row_key jsonb not null,
  primary key(actor_id,table_name,row_key)
);
create table private.admin_archive_rpc_results (
  actor_id uuid not null,
  function_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb not null,
  primary key(actor_id,function_name,arguments)
);
create table private.admin_archive_file_copies (
  object_id uuid primary key,
  bucket_id text not null check(bucket_id='admin-archive'),
  name text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$')
);
create table private.admin_archive_activation_log (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  activated_at timestamptz not null default statement_timestamp(),
  executor_role text not null,
  actor_ids uuid[] not null
);
do $$ declare t text; begin
  foreach t in array array['admin_archive_state','admin_archive_visibility','admin_archive_rpc_results','admin_archive_file_copies','admin_archive_activation_log'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function private.admin_archive_designated(p_actor uuid)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_actor in('7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid),false)
$$;
create function private.admin_archive_frozen(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.admin_archive_designated(p_actor) and exists(select 1 from private.admin_archive_state where active)
$$;
create function private.admin_archive_eligible(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.admin_archive_designated(p_actor)
    and exists(select 1 from public.profiles where id=p_actor and is_active)
    and exists(select 1 from public.user_roles where profile_id=p_actor and role='admin' and revoked_at is null)
$$;
create function private.admin_archive_request_actor()
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare v text;
begin
  if auth.uid() is not null then return auth.uid(); end if;
  if auth.jwt()->>'role'='service_role' then
    v:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb)->>'x-bunya-archive-actor';
    if v ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return v::uuid; end if;
  end if;
  return null;
end $$;
create function private.admin_archive_visible(p_table text,p_key jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select private.admin_archive_frozen((select auth.uid())) and private.admin_archive_eligible((select auth.uid()))
    and exists(select 1 from private.admin_archive_visibility where actor_id=(select auth.uid()) and table_name=p_table and row_key=p_key)
$$;
create function public.admin_archive_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('active',private.admin_archive_frozen(auth.uid()),'eligible',private.admin_archive_eligible(auth.uid()),
    'captured_at',case when private.admin_archive_designated(auth.uid()) then (select captured_at from private.admin_archive_state) end)
$$;
create function public.admin_archive_actor_status(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('active',private.admin_archive_frozen(p_actor),'eligible',private.admin_archive_eligible(p_actor),
    'captured_at',case when private.admin_archive_designated(p_actor) then (select captured_at from private.admin_archive_state) end,
    'capture_complete',(select capture_complete from private.admin_archive_state),'files_ready',(select files_ready from private.admin_archive_state))
$$;
revoke all on function public.admin_archive_status() from public,anon;
grant execute on function public.admin_archive_status() to authenticated;
revoke all on function public.admin_archive_actor_status(uuid) from public,anon,authenticated;
grant execute on function public.admin_archive_actor_status(uuid) to service_role;

-- Snapshot payloads contain business data, never authentication tokens or vaults.
create function private.admin_archive_sanitize(value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; item record;
begin
  if jsonb_typeof(value)='object' then
    result:='{}'::jsonb;
    for item in select key,val from jsonb_each(value) e(key,val) loop
      if item.key !~* '(^|_)(password|token|secret|credential|authorization|ciphertext|private_key|code_salt|code_hash|otp)(_|$)' then
        result:=result||jsonb_build_object(item.key,private.admin_archive_sanitize(item.val));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value)='array' then
    return coalesce((select jsonb_agg(private.admin_archive_sanitize(x)) from jsonb_array_elements(value) x),'[]'::jsonb);
  end if;
  return value;
end $$;
create function private.admin_archive_rpc(p_name text,p_arguments jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.admin_archive_request_actor(); result jsonb;
begin
  if not private.admin_archive_frozen(actor) or not private.admin_archive_eligible(actor) then raise exception 'Archive access denied' using errcode='42501';end if;
  select r.result into result from private.admin_archive_rpc_results r where r.actor_id=actor and r.function_name=p_name and r.arguments=p_arguments;
  if not found then raise exception 'Archived result is unavailable' using errcode='42501';end if;
  return result;
end $$;
create function admin_archive.admin_has_permission(requested_permission text)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((private.admin_archive_rpc('admin_permissions')->>requested_permission)::boolean,false)
$$;
create function admin_archive.admin_attention_counts()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_archive_rpc('admin_attention_counts') $$;
create function admin_archive.admin_provider_financial_summary()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_archive_rpc('admin_provider_financial_summary') $$;
create function admin_archive.contractor_directory_cards()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_archive_rpc('contractor_directory_cards') $$;
create function admin_archive.contractor_chat_summary(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_archive_rpc('contractor_chat_summary',jsonb_build_object('p_id',p_id)) $$;
create function admin_archive.admin_can_view_administrators()
returns boolean language sql stable security invoker set search_path='' as $$ select (private.admin_archive_rpc('admin_can_view_administrators')#>>'{}')::boolean $$;
create function admin_archive.admin_can_impersonate()
returns boolean language sql stable security invoker set search_path='' as $$ select false $$;
create function admin_archive.is_admin()
returns boolean language sql stable security invoker set search_path='' as $$ select (private.admin_archive_rpc('is_admin')#>>'{}')::boolean $$;
revoke all on all functions in schema admin_archive from public,anon;
grant execute on all functions in schema admin_archive to authenticated,service_role;

create table admin_archive.safe_auth_users (
  id uuid primary key,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,last_sign_in_at timestamptz,
  created_at timestamptz,updated_at timestamptz,phone text,aud text,role text
);
create table admin_archive.archive_storage_objects (
  id uuid primary key,bucket_id text not null,name text not null,metadata jsonb,updated_at timestamptz,
  unique(bucket_id,name)
);
alter table admin_archive.safe_auth_users enable row level security;
alter table admin_archive.archive_storage_objects enable row level security;
create policy archive_storage_read on admin_archive.archive_storage_objects for select to authenticated
  using(private.admin_archive_visible('storage.objects',jsonb_build_object('id',id)));
revoke all on admin_archive.safe_auth_users,admin_archive.archive_storage_objects from public,anon,authenticated,service_role;
grant select on admin_archive.safe_auth_users,admin_archive.archive_storage_objects to service_role;
grant select on admin_archive.archive_storage_objects to authenticated;

-- Active frozen identities may read only their live status/role gates; every
-- operational table and every write is blocked independently of the web client.
do $$ declare t record; own text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') loop
    execute format('alter table public.%I enable row level security',t.relname);
    if t.relname in('profiles','user_roles') then
      own:=case when t.relname='profiles' then 'id' else 'profile_id' end;
      execute format('create policy archive_live_read_boundary on public.%I as restrictive for select to authenticated using(not private.admin_archive_frozen((select auth.uid())) or %I=(select auth.uid()))',t.relname,own);
      execute format('create policy archive_live_insert_boundary on public.%I as restrictive for insert to authenticated with check(not private.admin_archive_frozen((select auth.uid())))',t.relname);
      execute format('create policy archive_live_update_boundary on public.%I as restrictive for update to authenticated using(not private.admin_archive_frozen((select auth.uid()))) with check(not private.admin_archive_frozen((select auth.uid())))',t.relname);
      execute format('create policy archive_live_delete_boundary on public.%I as restrictive for delete to authenticated using(not private.admin_archive_frozen((select auth.uid())))',t.relname);
    else
      execute format('create policy archive_live_boundary on public.%I as restrictive for all to authenticated using(not private.admin_archive_frozen((select auth.uid()))) with check(not private.admin_archive_frozen((select auth.uid())))',t.relname);
    end if;
  end loop;
end $$;
create policy archive_live_storage_boundary on storage.objects as restrictive for all to authenticated
using(not private.admin_archive_frozen((select auth.uid()))) with check(not private.admin_archive_frozen((select auth.uid())));

create function private.suppress_frozen_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; row_data jsonb:=to_jsonb(new);
begin
  recipient:=coalesce(row_data->>'profile_id',row_data->>'customer_profile_id',row_data->>'recipient_profile_id')::uuid;
  if private.admin_archive_frozen(recipient) then return null;end if;
  if row_data->>'contractor_profile_id' is not null and exists(select 1 from public.contractor_profiles where id=(row_data->>'contractor_profile_id')::uuid and private.admin_archive_frozen(profile_id)) then return null;end if;
  return new;
end $$;
do $$ declare t text;begin
  foreach t in array array['notifications','customer_notifications','contractor_notifications','project_notifications'] loop
    if to_regclass('public.'||t) is not null then execute format('create trigger suppress_frozen_notifications before insert or update on public.%I for each row execute function private.suppress_frozen_notifications()',t);end if;
  end loop;
end $$;

-- DELETE broadcasts cannot be made confidential by ordinary row SELECT policies.
-- Reject these actors' subscriptions themselves, without altering Realtime's
-- managed apply_rls implementation or changing publications for other users.
create function private.block_frozen_archive_subscription()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.claims->>'sub' in('7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e')
    and exists(select 1 from private.admin_archive_state where active) then
    -- Switching an existing connection's JWT must remove its old authorization.
    if tg_op='UPDATE' then delete from realtime.subscription where id=old.id;end if;
    return null;
  end if;
  return new;
end $$;
create trigger block_frozen_archive_subscription before insert or update on realtime.subscription
for each row execute function private.block_frozen_archive_subscription();

create function public.guard_admin_archive_request()
returns void language plpgsql security definer set search_path='' as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  method text:=upper(coalesce(current_setting('request.method',true),'')); path text:=current_setting('request.path',true); profile text; previous record;
begin
  if private.admin_archive_frozen(auth.uid()) then
    profile:=coalesce(case when method in('GET','HEAD') then headers->>'accept-profile' else headers->>'content-profile' end,'public');
    if not (
      profile='admin_archive' and (method in('GET','HEAD') or (method='POST' and path like '/rpc/%'))
      or profile='public' and path='/rpc/admin_archive_status' and method in('GET','HEAD','POST')
      or profile='public' and path in('/profiles','/user_roles') and method in('GET','HEAD')
    ) then raise exception 'This account can access only its frozen archive' using errcode='42501';end if;
  end if;
  select n.nspname,p.proname into previous from private.admin_archive_state s join pg_proc p on p.oid=s.previous_pre_request join pg_namespace n on n.oid=p.pronamespace;
  if found then execute format('select %I.%I()',previous.nspname,previous.proname);end if;
end $$;
revoke all on function public.guard_admin_archive_request() from public,anon;
grant execute on function public.guard_admin_archive_request() to anon,authenticated,service_role;

-- Caller supplies the verified current exposed-schema list; never replace an
-- unknown API setting with guessed defaults. Preserve a prior request hook.
create function public.configure_admin_archive_api(p_current_schemas text,p_previous_pre_request text default null)
returns void language plpgsql security definer set search_path='' as $$
declare schemas text; previous oid;
begin
  if nullif(btrim(p_current_schemas),'') is null then raise exception 'Current exposed schemas are required';end if;
  select string_agg(quote_ident(name),', ') into schemas from(select distinct btrim(x) as name from unnest(string_to_array(p_current_schemas,',')||array['admin_archive']) x where btrim(x)<>'') s;
  if nullif(btrim(p_previous_pre_request),'') is not null then
    previous:=to_regprocedure(p_previous_pre_request||'()');
    if previous is null or previous='public.guard_admin_archive_request()'::regprocedure then raise exception 'Invalid previous request hook';end if;
  end if;
  execute format('alter role authenticator set pgrst.db_schemas = %L',schemas);
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.guard_admin_archive_request''';
  update private.admin_archive_state set api_ready=true,previous_pre_request=previous;
  notify pgrst,'reload config'; notify pgrst,'reload schema';
end $$;
revoke all on function public.configure_admin_archive_api(text,text) from public,anon,authenticated;
grant execute on function public.configure_admin_archive_api(text,text) to service_role;

create function public.admin_archive_mark_files_ready(p_expected_cutoff timestamptz,p_manifest jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(101);
  if not exists(select 1 from private.admin_archive_state where captured_at=p_expected_cutoff and capture_complete and not active) then raise exception 'Archive capture is not ready' using errcode='42501';end if;
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest)<>(select count(*) from admin_archive.archive_storage_objects) then raise exception 'Archive file manifest is incomplete';end if;
  delete from private.admin_archive_file_copies;
  insert into private.admin_archive_file_copies(object_id,bucket_id,name,sha256)
    select (x->>'object_id')::uuid,x->>'bucket_id',x->>'name',x->>'sha256' from jsonb_array_elements(p_manifest) x;
  if exists(select 1 from admin_archive.archive_storage_objects s left join private.admin_archive_file_copies c on c.object_id=s.id
    where c.object_id is null or c.bucket_id<>'admin-archive' or c.name<>s.bucket_id||'/'||s.name)
    or exists(select 1 from private.admin_archive_file_copies c where not exists(select 1 from admin_archive.archive_storage_objects s where s.id=c.object_id)) then raise exception 'Archive file manifest does not match captured objects';end if;
  if exists(select 1 from admin_archive.archive_storage_objects s
    left join storage.objects source on source.id=s.id
    join private.admin_archive_file_copies c on c.object_id=s.id
    left join storage.objects destination on destination.bucket_id=c.bucket_id and destination.name=c.name
    where source.id is null or source.bucket_id is distinct from s.bucket_id or source.name is distinct from s.name
      or source.updated_at is distinct from s.updated_at or source.metadata is distinct from s.metadata
      or destination.id is null or destination.metadata->>'size' is distinct from s.metadata->>'size'
      or s.metadata->>'size' is null) then raise exception 'Archive storage source changed or verified destination is missing';end if;
  update private.admin_archive_state set files_ready=true;
end $$;
revoke all on function public.admin_archive_mark_files_ready(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.admin_archive_mark_files_ready(timestamptz,jsonb) to service_role;

create function public.admin_archive_storage_location(p_actor uuid,p_bucket text,p_name text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('bucket_id',c.bucket_id,'name',c.name)
  from admin_archive.archive_storage_objects s join private.admin_archive_file_copies c on c.object_id=s.id
  where s.bucket_id=p_bucket and s.name=p_name and private.admin_archive_frozen(p_actor) and private.admin_archive_eligible(p_actor)
    and exists(select 1 from private.admin_archive_visibility v where v.actor_id=p_actor and v.table_name='storage.objects' and v.row_key=jsonb_build_object('id',s.id))
$$;
revoke all on function public.admin_archive_storage_location(uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_archive_storage_location(uuid,text,text) to service_role;

create function public.activate_admin_archive(p_expected_cutoff timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(101);
  if not exists(select 1 from private.admin_archive_state where captured_at=p_expected_cutoff and capture_complete and files_ready and api_ready and not active) then raise exception 'Archive data, files and API configuration must be ready' using errcode='42501';end if;
  update private.admin_archive_state set active=true,activated_at=statement_timestamp();
  delete from realtime.subscription where claims->>'sub' in('7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e');
  update public.admin_users set is_active=false where private.admin_archive_designated(profile_id);
  if to_regclass('public.push_subscriptions') is not null then execute 'update public.push_subscriptions set active=false where private.admin_archive_designated(profile_id)';end if;
  insert into private.admin_archive_activation_log(captured_at,executor_role,actor_ids)
    values(p_expected_cutoff,coalesce(auth.jwt()->>'role',session_user),array['7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid]);
end $$;
revoke all on function public.activate_admin_archive(timestamptz) from public,anon,authenticated;
grant execute on function public.activate_admin_archive(timestamptz) to service_role;

-- Frozen target identity remains valid for Ahmed's existing audited delegation.
create or replace function private.admin_impersonation_target_allowed(p_actor uuid,p_actor_session uuid,p_target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(p_actor='8b9f3886-e1b8-4816-9fbb-d425b0753255'::uuid and p_actor<>p_target
    and exists(select 1 from public.admin_users a join public.admin_roles r on r.id=a.role_id and r.role_key='super_admin'
      join public.profiles p on p.id=a.profile_id and p.is_active and not p.must_change_password
      join public.user_roles u on u.profile_id=p.id and u.role='admin' and u.revoked_at is null where a.profile_id=p_actor and a.is_active)
    and exists(select 1 from auth.sessions where id=p_actor_session and user_id=p_actor)
    and exists(select 1 from public.profiles where id=p_target and is_active)
    and exists(select 1 from public.user_roles u where u.profile_id=p_target and u.revoked_at is null and u.is_primary
      and (u.role<>'admin' or exists(select 1 from public.admin_users a where a.profile_id=p_target and a.is_active)
        or (private.admin_archive_frozen(p_target) and private.admin_archive_eligible(p_target)
          and exists(select 1 from private.admin_archive_rpc_results r where r.actor_id=p_target and r.function_name='is_admin' and r.result='true'::jsonb)))),false)
$$;

-- No new private helper is an anonymously callable endpoint.
do $$ declare f record;begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'admin_archive_%' or p.proname in('suppress_frozen_notifications','block_frozen_archive_subscription')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function private.admin_archive_frozen(uuid),private.admin_archive_visible(text,jsonb),private.admin_archive_rpc(text,jsonb),private.admin_archive_request_actor() to authenticated,service_role;
