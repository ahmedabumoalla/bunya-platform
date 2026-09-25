begin;

-- Authentication is owned by Supabase Auth, while the provider-facing driver
-- directory lives in public.provider_drivers. Keep their activity timestamps
-- synchronized through a driver-scoped RPC instead of trusting client writes.
create or replace function public.mark_driver_activity()
returns timestamptz
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_driver_id uuid;
  v_now timestamptz:=now();
begin
  if auth.uid() is null then return null; end if;
  select a.driver_id into v_driver_id
  from public.provider_driver_accounts a
  join public.provider_drivers d on d.id=a.driver_id
  where a.auth_user_id=auth.uid() and d.status<>'suspended';
  if not found then return null; end if;

  update public.provider_drivers
  set last_active_at=v_now,updated_at=v_now
  where id=v_driver_id
    and (last_active_at is null or last_active_at<v_now-interval '1 minute');
  return v_now;
end
$$;

revoke execute on function public.mark_driver_activity() from public,anon;
grant execute on function public.mark_driver_activity() to authenticated;

-- Repair existing driver rows from the authoritative Auth sign-in timestamp.
update public.provider_drivers d
set last_active_at=u.last_sign_in_at,
    updated_at=greatest(d.updated_at,u.last_sign_in_at)
from public.provider_driver_accounts a
join auth.users u on u.id=a.auth_user_id
where a.driver_id=d.id
  and u.last_sign_in_at is not null
  and (d.last_active_at is null or d.last_active_at<u.last_sign_in_at);

commit;
