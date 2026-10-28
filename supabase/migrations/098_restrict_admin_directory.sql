-- Restrict the two designated operators by immutable profile ID, never editable email.
-- Keep self identity readable so authentication and ordinary operations still work.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.admin_directory_restricted()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.uid()) in (
    '7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,
    'd5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid
  ), false)
$$;
revoke all on function private.admin_directory_restricted() from public, anon;
grant execute on function private.admin_directory_restricted() to authenticated;

create or replace function public.admin_has_permission(requested_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not (private.admin_directory_restricted()
    and requested_permission in ('roles.manage', 'admins.manage', 'audit.read'))
  and exists (
    select 1 from public.admin_users au
    join public.admin_roles ar on ar.id = au.role_id
    join public.user_roles ur on ur.profile_id = au.profile_id and ur.role = 'admin' and ur.revoked_at is null
    join public.profiles p on p.id = au.profile_id and p.is_active
    where au.profile_id = (select auth.uid()) and au.is_active
      and (ar.role_key = 'super_admin' or exists (
        select 1 from public.admin_role_permissions arp
        join public.admin_permissions ap on ap.id = arp.permission_id
        where arp.role_id = ar.id and ap.permission_key = requested_permission
      ))
  )
$$;
revoke all on function public.admin_has_permission(text) from public, anon;
grant execute on function public.admin_has_permission(text) to authenticated, service_role;

-- No target argument: this capability cannot be used to probe administrator IDs.
create or replace function public.admin_can_view_administrators()
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.is_admin() and not private.admin_directory_restricted()
$$;
revoke all on function public.admin_can_view_administrators() from public, anon;
grant execute on function public.admin_can_view_administrators() to authenticated;

-- Private definer avoids policy recursion across profiles, user_roles, admin_users.
-- Both inactive admin memberships and secondary admin roles remain confidential.
create or replace function private.admin_profile_visible(target_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    target_profile_id = (select auth.uid())
    or not private.admin_directory_restricted()
    or not (
      exists (select 1 from public.profiles p where p.id = target_profile_id and p.role = 'admin')
      or exists (select 1 from public.user_roles ur where ur.profile_id = target_profile_id and ur.role = 'admin' and ur.revoked_at is null)
      or exists (select 1 from public.admin_users au where au.profile_id = target_profile_id)
    )
  )
$$;
revoke all on function private.admin_profile_visible(uuid) from public, anon;
grant execute on function private.admin_profile_visible(uuid) to authenticated;

-- Restrictive ALL policies also constrain existing permissive management policies.
create policy profiles_admin_directory_boundary on public.profiles
as restrictive for all to authenticated
using (private.admin_profile_visible(id))
with check (private.admin_profile_visible(id));

create policy user_roles_admin_directory_boundary on public.user_roles
as restrictive for all to authenticated
using (private.admin_profile_visible(profile_id))
with check (private.admin_profile_visible(profile_id));

create policy admin_users_directory_boundary on public.admin_users
as restrictive for all to authenticated
using (profile_id = (select auth.uid()) or not (select private.admin_directory_restricted()))
with check (not (select private.admin_directory_restricted()));
