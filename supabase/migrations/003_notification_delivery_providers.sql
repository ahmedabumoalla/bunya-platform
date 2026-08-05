begin;

do $$ begin
  if to_regclass('public.notification_deliveries') is null
     or to_regclass('public.outbox_events') is null
     or to_regclass('public.account_onboarding_deliveries') is null then
    raise exception '003 notification providers requires migrations 001 and 002';
  end if;
end $$;

alter table public.notification_deliveries drop constraint notification_deliveries_channel_check;
alter table public.notification_deliveries drop constraint notification_deliveries_status_check;
alter table public.notification_deliveries
  add column idempotency_key text,
  add column provider_message_id text,
  add column submitted_at timestamptz,
  add column next_attempt_at timestamptz,
  add column dead_letter_at timestamptz,
  add column sanitized_error text,
  add constraint notification_deliveries_channel_check check (channel in ('in_app','email','sms','whatsapp','push')),
  add constraint notification_deliveries_status_check check (status in ('pending','processing','submitted','delivered','failed','configuration_missing','cancelled','dead_letter')),
  add constraint notification_deliveries_sanitized_error_length check (sanitized_error is null or length(sanitized_error)<=500);
create unique index notification_deliveries_idempotency_idx on public.notification_deliveries(idempotency_key) where idempotency_key is not null;
create index notification_deliveries_retry_idx on public.notification_deliveries(status,next_attempt_at) where status in ('pending','failed');

create table public.notification_provider_submissions(
  id uuid primary key default gen_random_uuid(),
  event_type text not null check(event_type ~ '^[a-z0-9_.-]+$'),
  channel text not null check(channel in ('whatsapp','email')),
  masked_destination text not null,
  idempotency_key text not null unique,
  status text not null check(status in ('submitted','failed','configuration_missing')),
  provider_message_id text,
  attempts integer not null default 1 check(attempts>0),
  submitted_at timestamptz,
  sanitized_error text check(sanitized_error is null or length(sanitized_error)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_submission_consistency check((status='submitted' and provider_message_id is not null and submitted_at is not null) or status<>'submitted')
);
create index notification_provider_submissions_event_idx on public.notification_provider_submissions(event_type,created_at desc);
create trigger notification_provider_submissions_set_updated_at before update on public.notification_provider_submissions for each row execute function public.set_updated_at();
alter table public.notification_provider_submissions enable row level security;
create policy notification_provider_submissions_admin_read on public.notification_provider_submissions for select to authenticated using(public.admin_has_permission('operations.manage') or public.admin_has_permission('audit.read'));

alter table public.outbox_events
  add column idempotency_key text,
  add column next_attempt_at timestamptz,
  add column dead_letter_at timestamptz,
  add column locked_at timestamptz,
  add column sanitized_error text,
  add constraint outbox_sanitized_error_length check(sanitized_error is null or length(sanitized_error)<=500);
create unique index outbox_events_idempotency_idx on public.outbox_events(idempotency_key) where idempotency_key is not null;
create index outbox_events_dispatch_idx on public.outbox_events(status,coalesce(next_attempt_at,available_at),created_at) where status in ('pending','failed');

alter table public.account_onboarding_deliveries drop constraint account_onboarding_provisioning_status;
alter table public.account_onboarding_deliveries drop constraint account_onboarding_email_status;
alter table public.account_onboarding_deliveries drop constraint account_onboarding_whatsapp_status;
alter table public.account_onboarding_deliveries
  add constraint account_onboarding_provisioning_status check(provisioning_status in ('not_started','creating_auth','provisioned','credentials_pending','credentials_submitted','credentials_partially_submitted','credentials_sent','credentials_partially_sent','credentials_failed')),
  add constraint account_onboarding_email_status check(email_delivery_status in ('pending','submitted','sent','failed','configuration_missing','not_configured')),
  add constraint account_onboarding_whatsapp_status check(whatsapp_delivery_status in ('pending','submitted','sent','failed','configuration_missing','not_configured'));

create or replace function public.mark_onboarding_credentials_delivery(p_application_kind text,p_application_id uuid,p_email_status text,p_whatsapp_status text,p_email_reference text,p_whatsapp_reference text,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;v_error text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  if p_email_status not in ('submitted','sent','failed','configuration_missing','not_configured') or p_whatsapp_status not in ('submitted','sent','failed','configuration_missing','not_configured') then raise exception 'Invalid delivery status';end if;
  v_status:=case when p_email_status in ('submitted','sent') and p_whatsapp_status in ('submitted','sent') then 'credentials_submitted' when p_email_status in ('submitted','sent') or p_whatsapp_status in ('submitted','sent') then 'credentials_partially_submitted' else 'credentials_failed' end;
  v_error:=nullif(left(regexp_replace(coalesce(p_error,''),'[\r\n\t]+',' ','g'),500),'');
  update public.account_onboarding_deliveries set provisioning_status=v_status,email_delivery_status=p_email_status,whatsapp_delivery_status=p_whatsapp_status,email_provider_reference=nullif(left(p_email_reference,255),''),whatsapp_provider_reference=nullif(left(p_whatsapp_reference,255),''),delivery_attempts=delivery_attempts+1,last_delivery_at=now(),last_delivery_error=v_error,updated_at=now() where application_kind=p_application_kind and application_id=p_application_id;
  if not found then raise exception 'Onboarding record not found';end if;
end $$;

revoke all on public.notification_provider_submissions from public,anon,authenticated;
grant select on public.notification_provider_submissions to authenticated;
grant all on public.notification_provider_submissions to service_role;
revoke execute on function public.mark_onboarding_credentials_delivery(text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mark_onboarding_credentials_delivery(text,uuid,text,text,text,text,text) to service_role;

create or replace function public.claim_notification_outbox(p_limit integer,p_event_types text[])
returns setof public.outbox_events language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  return query
  update public.outbox_events o set status='processing',locked_at=now(),attempts=o.attempts+1
  where o.id in(select id from public.outbox_events where status in('pending','failed') and event_type=any(p_event_types) and coalesce(next_attempt_at,available_at)<=now() order by created_at for update skip locked limit greatest(1,least(p_limit,25)))
  returning o.*;
end $$;

create or replace function public.finish_notification_outbox(p_id uuid,p_success boolean,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempts integer;v_error text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
  v_error:=nullif(left(regexp_replace(coalesce(p_error,''),'[\r\n\t]+',' ','g'),500),'');
  select attempts into v_attempts from public.outbox_events where id=p_id and status='processing' for update;
  if not found then raise exception 'Outbox event is not processing';end if;
  if p_success then update public.outbox_events set status='processed',processed_at=now(),locked_at=null,sanitized_error=null where id=p_id;
  elsif v_attempts>=5 then update public.outbox_events set status='dead_letter',dead_letter_at=now(),locked_at=null,sanitized_error=v_error,last_error=v_error where id=p_id;
  else update public.outbox_events set status='failed',next_attempt_at=now()+(interval '30 seconds'*power(2,greatest(0,v_attempts-1))),locked_at=null,sanitized_error=v_error,last_error=v_error where id=p_id;end if;
end $$;

revoke execute on function public.claim_notification_outbox(integer,text[]) from public,anon,authenticated;
revoke execute on function public.finish_notification_outbox(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_notification_outbox(integer,text[]) to service_role;
grant execute on function public.finish_notification_outbox(uuid,boolean,text) to service_role;

commit;
