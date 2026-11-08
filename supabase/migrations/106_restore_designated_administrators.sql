-- Owner-requested restoration of both operators, 2026-11-08.
-- One atomic transition is required: live membership and directory access must
-- return together when archive routing stops. Preserve the immutable snapshot,
-- existing role assignments, password lifecycle and owner-only impersonation.
-- Rollback is a new, explicitly authorized forward migration using the audit
-- before-state; do not re-run the old activation script or recapture data.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(101);

do $$
begin
  if (select count(*) from auth.users u
      join public.profiles p on p.id=u.id
      join public.admin_users a on a.profile_id=u.id
      join public.admin_roles r on r.id=a.role_id
      where (u.id,lower(u.email)) in (
        ('7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'farraamjad@gmail.com'),
        ('d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid,'hakimnaes@gmail.com'))
        and p.is_active and r.role_key='super_admin'
        and exists(select 1 from public.user_roles ur where ur.profile_id=u.id
          and ur.role='admin' and ur.revoked_at is null)) <> 2 then
    raise exception 'Restoration target identity or existing administrator role mismatch';
  end if;
  if not exists(select 1 from private.admin_archive_state where singleton
      and captured_at='2026-10-28T11:21:28.966975Z'::timestamptz
      and capture_complete and files_ready and api_ready) then
    raise exception 'Expected original archive state missing';
  end if;
end $$;

-- This helper originally restricted only these two fixed identities. Ordinary
-- permission checks and permissive RLS policies remain authoritative.
create or replace function private.admin_directory_restricted()
returns boolean language sql stable set search_path = '' as $$
  select false
$$;
revoke all on function private.admin_directory_restricted() from public, anon;
grant execute on function private.admin_directory_restricted() to authenticated;

do $$
declare
  actors constant uuid[] := array[
    '7f4152b6-63d2-49ec-866f-681a3308f670',
    'd5b7d59e-3a22-4d59-8096-d546c9bd8c4e']::uuid[];
  actor uuid; previous_active boolean; previous_frozen boolean;
  previous_push jsonb; restored_push integer;
begin
  select active into previous_frozen from private.admin_archive_state where singleton for update;
  -- Also releases notification suppression, Storage and Realtime guards.
  update private.admin_archive_state set active=false where singleton and active;
  foreach actor in array actors loop
    select is_active into previous_active from public.admin_users where profile_id=actor for update;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'active',active)),'[]'::jsonb)
      into previous_push from public.push_subscriptions where profile_id=actor;
    update public.admin_users set is_active=true where profile_id=actor and not is_active;
    update public.push_subscriptions set active=true,updated_at=statement_timestamp()
      where profile_id=actor and not active;
    get diagnostics restored_push=row_count;
    if not exists(select 1 from public.audit_logs
        where entity_table='profiles' and entity_id=actor::text
          and action='admin_live_access_restored') then
      insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
      values(null,'profiles',actor::text,'admin_live_access_restored',jsonb_build_object(
        'reason','Explicit owner request to remove both operator restrictions',
        'migration','106','previous_archive_active',previous_frozen,
        'previous_admin_active',previous_active,'previous_push',previous_push,
        'restored_push_subscriptions',restored_push,'archive_active',false,
        'administrator_directory_restricted',false,'role_assignment_preserved',true));
    end if;
  end loop;
end $$;
commit;
