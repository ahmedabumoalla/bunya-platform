begin;

create temp table retained_join_request(id uuid primary key) on commit drop;
insert into retained_join_request(id)
select id
from public.provider_applications
where lower(btrim(email)) = 'ceo.branda@gmail.com'
  and status in ('pending', 'needs_changes')
order by created_at desc
limit 1;

do $$
begin
  if not exists (select 1 from retained_join_request) then
    raise exception 'The provider application for ceo.branda@gmail.com was not found';
  end if;
end $$;

create temp table purge_join_requests(
  application_kind text not null,
  application_id uuid not null,
  primary key(application_kind, application_id)
) on commit drop;

insert into purge_join_requests(application_kind, application_id)
select 'provider', id
from public.provider_applications
where status in ('pending', 'needs_changes')
  and id not in (select id from retained_join_request);

insert into purge_join_requests(application_kind, application_id)
select 'contractor', id
from public.contractor_applications
where status in ('pending', 'needs_changes');

create temp table purge_join_files(id uuid primary key) on commit drop;
insert into purge_join_files(id)
select distinct document.file_id
from public.provider_application_documents document
join purge_join_requests target
  on target.application_kind = 'provider'
 and target.application_id = document.application_id;

delete from public.join_application_revision_tokens token
using purge_join_requests target
where token.application_kind = target.application_kind
  and token.application_id = target.application_id;

delete from public.join_request_reviews review
using purge_join_requests target
where review.request_kind = target.application_kind
  and review.request_id = target.application_id;

delete from public.account_onboarding_deliveries delivery
using purge_join_requests target
where delivery.application_kind = target.application_kind
  and delivery.application_id = target.application_id;

alter table public.notifications disable trigger user;
delete from public.notifications notification
using purge_join_requests target
where notification.entity_id = target.application_id
  and notification.entity_type = target.application_kind || '_application';
alter table public.notifications enable trigger user;

delete from public.outbox_events event
using purge_join_requests target
where event.aggregate_id = target.application_id;

alter table public.audit_logs disable trigger user;
delete from public.audit_logs audit
using purge_join_requests target
where audit.entity_id = target.application_id::text
  and audit.entity_table = target.application_kind || '_applications';
alter table public.audit_logs enable trigger user;

delete from public.provider_applications application
using purge_join_requests target
where target.application_kind = 'provider'
  and application.id = target.application_id;

delete from public.contractor_applications application
using purge_join_requests target
where target.application_kind = 'contractor'
  and application.id = target.application_id;

delete from public.files file
using purge_join_files target
where file.id = target.id;

commit;
