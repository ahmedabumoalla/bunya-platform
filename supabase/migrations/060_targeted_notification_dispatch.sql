begin;

-- Interactive workflows may ask the worker to process the exact outbox event
-- they just created instead of waiting for the scheduled batch. Claiming stays
-- atomic and service-role only, so cron and interactive dispatch cannot send it
-- twice.
create or replace function public.claim_notification_outbox_event(
  p_id uuid,
  p_event_types text[]
) returns setof public.outbox_events
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'Service role required';
  end if;

  update public.outbox_events
  set status='failed',locked_at=null,next_attempt_at=now(),sanitized_error='worker_lock_expired'
  where id=p_id and status='processing' and locked_at<now()-interval '10 minutes';

  return query
  update public.outbox_events o
  set status='processing',locked_at=now(),attempts=o.attempts+1
  where o.id=p_id
    and o.status in ('pending','failed')
    and o.event_type=any(p_event_types)
    and coalesce(o.next_attempt_at,o.available_at)<=now()
  returning o.*;
end
$$;

revoke execute on function public.claim_notification_outbox_event(uuid,text[]) from public,anon,authenticated;
grant execute on function public.claim_notification_outbox_event(uuid,text[]) to service_role;

commit;
