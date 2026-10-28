-- Explicit predicates keep service control RPCs compatible with PostgREST safeupdate.
-- Setup only: this migration neither marks files ready nor activates the archive.

create or replace function public.configure_admin_archive_api(p_current_schemas text,p_previous_pre_request text default null)
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
  update private.admin_archive_state set api_ready=true,previous_pre_request=previous where singleton=true;
  notify pgrst,'reload config'; notify pgrst,'reload schema';
end $$;

create or replace function public.admin_archive_mark_files_ready(p_expected_cutoff timestamptz,p_manifest jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(101);
  if not exists(select 1 from private.admin_archive_state where captured_at=p_expected_cutoff and capture_complete and not active) then raise exception 'Archive capture is not ready' using errcode='42501';end if;
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest)<>(select count(*) from admin_archive.archive_storage_objects) then raise exception 'Archive file manifest is incomplete';end if;
  delete from private.admin_archive_file_copies where object_id is not null;
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
  update private.admin_archive_state set files_ready=true where singleton=true and captured_at=p_expected_cutoff and not active;
end $$;

create or replace function public.activate_admin_archive(p_expected_cutoff timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(101);
  if not exists(select 1 from private.admin_archive_state where captured_at=p_expected_cutoff and capture_complete and files_ready and api_ready and not active) then raise exception 'Archive data, files and API configuration must be ready' using errcode='42501';end if;
  update private.admin_archive_state set active=true,activated_at=statement_timestamp() where singleton=true and captured_at=p_expected_cutoff and not active;
  delete from realtime.subscription where claims->>'sub' in('7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e');
  update public.admin_users set is_active=false where private.admin_archive_designated(profile_id);
  if to_regclass('public.push_subscriptions') is not null then execute 'update public.push_subscriptions set active=false where private.admin_archive_designated(profile_id)';end if;
  insert into private.admin_archive_activation_log(captured_at,executor_role,actor_ids)
    values(p_expected_cutoff,coalesce(auth.jwt()->>'role',session_user),array['7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid]);
end $$;

revoke all on function public.configure_admin_archive_api(text,text),public.admin_archive_mark_files_ready(timestamptz,jsonb),public.activate_admin_archive(timestamptz) from public,anon,authenticated;
grant execute on function public.configure_admin_archive_api(text,text),public.admin_archive_mark_files_ready(timestamptz,jsonb),public.activate_admin_archive(timestamptz) to service_role;

-- Canonical explicit ACLs; same grants as101, readable by static validation.
revoke all on function private.admin_archive_designated(uuid),private.admin_archive_frozen(uuid),private.admin_archive_eligible(uuid),private.admin_archive_request_actor(),private.admin_archive_visible(text,jsonb),private.admin_archive_sanitize(jsonb),private.admin_archive_rpc(text,jsonb),private.suppress_frozen_notifications(),private.block_frozen_archive_subscription() from public,anon,authenticated,service_role;
grant execute on function private.admin_archive_frozen(uuid),private.admin_archive_visible(text,jsonb),private.admin_archive_rpc(text,jsonb),private.admin_archive_request_actor() to authenticated,service_role;

-- Live authentication restrictions override the immutable business snapshot.
-- The service transport separately authenticates its context; it must inspect
-- requires_password_change and permit that state only for validated delegation.
create function private.admin_archive_session_allowed(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.admin_archive_eligible(p_actor) and (
    auth.jwt()->>'role'='service_role'
    or (auth.uid()=p_actor and (
      exists(select 1 from public.profiles where id=p_actor and not must_change_password)
      or exists(select 1 from public.admin_impersonation_sessions s
        where s.target_profile_id=p_actor and s.target_auth_session_id::text=auth.jwt()->>'session_id'
          and public.validate_admin_impersonation(s.id,s.actor_profile_id,s.actor_auth_session_id))
    ))
  )
$$;
revoke all on function private.admin_archive_session_allowed(uuid) from public,anon,authenticated,service_role;

create or replace function private.admin_archive_visible(p_table text,p_key jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select private.admin_archive_frozen((select auth.uid())) and private.admin_archive_session_allowed((select auth.uid()))
    and exists(select 1 from private.admin_archive_visibility where actor_id=(select auth.uid()) and table_name=p_table and row_key=p_key)
$$;
create or replace function private.admin_archive_rpc(p_name text,p_arguments jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.admin_archive_request_actor(); result jsonb;
begin
  if not private.admin_archive_frozen(actor) or not private.admin_archive_session_allowed(actor) then raise exception 'Archive access denied' using errcode='42501';end if;
  select r.result into result from private.admin_archive_rpc_results r where r.actor_id=actor and r.function_name=p_name and r.arguments=p_arguments;
  if not found then raise exception 'Archived result is unavailable' using errcode='42501';end if;
  return result;
end $$;
create or replace function public.admin_archive_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('active',private.admin_archive_frozen(auth.uid()),'eligible',private.admin_archive_session_allowed(auth.uid()),
    'captured_at',case when private.admin_archive_designated(auth.uid()) then (select captured_at from private.admin_archive_state) end)
$$;
create or replace function public.admin_archive_actor_status(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('active',private.admin_archive_frozen(p_actor),'eligible',private.admin_archive_eligible(p_actor),
    'requires_password_change',coalesce((select must_change_password from public.profiles where id=p_actor),true),
    'captured_at',case when private.admin_archive_designated(p_actor) then (select captured_at from private.admin_archive_state) end,
    'capture_complete',(select capture_complete from private.admin_archive_state),'files_ready',(select files_ready from private.admin_archive_state))
$$;
revoke all on function public.admin_archive_status() from public,anon;
grant execute on function public.admin_archive_status() to authenticated;
revoke all on function public.admin_archive_actor_status(uuid) from public,anon,authenticated;
grant execute on function public.admin_archive_actor_status(uuid) to service_role;
notify pgrst, 'reload schema';
