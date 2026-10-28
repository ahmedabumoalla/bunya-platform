-- Frozen business access must not prevent the account's own password lifecycle.
-- This does not authorize delegated credential changes or any business mutation.
create or replace function public.guard_admin_archive_request()
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
      or (profile='public' and path='/rpc/complete_temporary_password_change' and method='POST'
        and not exists(select 1 from public.admin_impersonation_sessions s
          where s.target_profile_id=auth.uid() and s.target_auth_session_id::text=auth.jwt()->>'session_id'))
    ) then raise exception 'This account can access only its frozen archive' using errcode='42501';end if;
  end if;
  select n.nspname,p.proname into previous from private.admin_archive_state s join pg_proc p on p.oid=s.previous_pre_request join pg_namespace n on n.oid=p.pronamespace;
  if found then execute format('select %I.%I()',previous.nspname,previous.proname);end if;
end $$;
revoke all on function public.guard_admin_archive_request() from public;
grant execute on function public.guard_admin_archive_request() to anon,authenticated,service_role;
notify pgrst,'reload schema';
