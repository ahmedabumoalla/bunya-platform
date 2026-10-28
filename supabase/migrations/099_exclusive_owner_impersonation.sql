-- Only the verified Ahmed account may start/retain delegated maintenance sessions.
-- Bind to its immutable identity; an editable email or super-admin label is insufficient.
create or replace function public.admin_can_impersonate()
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select auth.uid()) = '8b9f3886-e1b8-4816-9fbb-d425b0753255'::uuid
    and exists (
      select 1 from public.admin_users a
      join public.admin_roles r on r.id = a.role_id and r.role_key = 'super_admin'
      join public.profiles p on p.id = a.profile_id and p.is_active and not p.must_change_password
      join public.user_roles u on u.profile_id = p.id and u.role = 'admin' and u.revoked_at is null
      where a.profile_id = (select auth.uid()) and a.is_active
    )
$$;
revoke all on function public.admin_can_impersonate() from public, anon;
grant execute on function public.admin_can_impersonate() to authenticated;

create or replace function public.impersonation_participants_allowed(p_actor uuid, p_target uuid, p_actor_session uuid, p_target_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor = '8b9f3886-e1b8-4816-9fbb-d425b0753255'::uuid
    and p_actor <> p_target
    and exists (
      select 1 from public.admin_users a
      join public.admin_roles r on r.id = a.role_id and r.role_key = 'super_admin'
      join public.profiles p on p.id = a.profile_id and p.is_active and not p.must_change_password
      join public.user_roles u on u.profile_id = p.id and u.role = 'admin' and u.revoked_at is null
      where a.profile_id = p_actor and a.is_active
    )
    and exists(select 1 from auth.sessions s where s.id = p_actor_session and s.user_id = p_actor)
    and exists(select 1 from auth.sessions s where s.id = p_target_session and s.user_id = p_target)
    and exists(select 1 from public.profiles p where p.id = p_target and p.is_active and not p.must_change_password)
    and exists (
      select 1 from public.user_roles u
      where u.profile_id = p_target and u.revoked_at is null and u.is_primary
        and (u.role <> 'admin' or exists(select 1 from public.admin_users a where a.profile_id = p_target and a.is_active))
    )
$$;
revoke all on function public.impersonation_participants_allowed(uuid,uuid,uuid,uuid) from public, anon, authenticated;

-- Extend metadata-only delegation auditing to tables added after migration083.
-- Ordinary user attribution is retained alongside the real operator in audit_logs.
-- Do not duplicate existing per-event audits or copy private payloads into new events.
do $$ declare t record; e record; events text[]; begin
  for t in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname not in ('audit_logs','admin_impersonation_sessions')
  loop
    events := array[]::text[];
    for e in select * from (values ('insert',4),('update',16),('delete',8)) v(event_name,event_flag) loop
      if not exists(select 1 from pg_trigger tr join pg_proc p on p.oid=tr.tgfoid
        where tr.tgrelid=t.oid and not tr.tgisinternal and tr.tgenabled in ('O','A')
          and p.proname in ('audit_sensitive_row','audit_delegated_change') and (tr.tgtype::int & e.event_flag) <> 0) then
        events := array_append(events,e.event_name);
      end if;
    end loop;
    if cardinality(events)>0 then
      execute format('create trigger audit_delegated_change_099 after %s on public.%I for each row execute function public.audit_delegated_change()',array_to_string(events,' or '),t.relname);
    end if;
  end loop;
end $$;
