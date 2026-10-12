begin;

-- No raw conversation text is delivered until an authorized reviewer releases it.
-- Detection supplements pre-moderation; it is deliberately not a guarantee about language.
create or replace function public.contractor_contact_detected(p_text text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v text; compact text;
begin
  v:=lower(normalize(coalesce(p_text,''),NFKC));
  v:=translate(v,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآىة','01234567890123456789ااايه');
  v:=regexp_replace(v,'[ـً-ٟ‎‏​‌‍﻿]','','g');
  compact:=regexp_replace(v,'[^a-z0-9ء-ي@.+]','','g');
  if compact ~ '([0-9]{7,}|@|https?|www|mailto|tel:|whatsapp|snapchat|instagram|telegram|tiktok|facebook|discord|signal|gmail|hotmail|outlook|yahoo|واتس|سناب|انست|انستا|تلجرام|تيليجرام|تيكتوك|فيسبوك|ايميل|بريدالكتروني|جوالي|رقمي|اتصل|تواصلخارج|خاصخارج|رابط)' then return true; end if;
  if compact ~ '[a-z0-9]+[.](com|net|org|sa|me|io|co)' or v ~ '(دوت|dot)[[:space:]]*(كوم|com|net|نت)' then return true; end if;
  v:=regexp_replace(v,'(صفر|زيرو|zero)','0','g');
  v:=regexp_replace(v,'(واحد|ون|one)','1','g');
  v:=regexp_replace(v,'(اثنين|اثنان|اتنين|two)','2','g');
  v:=regexp_replace(v,'(ثلاثه|ثلاث|three)','3','g');
  v:=regexp_replace(v,'(اربعه|اربع|four)','4','g');
  v:=regexp_replace(v,'(خمسه|خمس|five)','5','g');
  v:=regexp_replace(v,'(سته|ست|six)','6','g');
  v:=regexp_replace(v,'(سبعه|سبع|seven)','7','g');
  v:=regexp_replace(v,'(ثمانيه|ثمان|eight)','8','g');
  v:=regexp_replace(v,'(تسعه|تسع|nine)','9','g');
  return regexp_replace(v,'[^0-9]','','g') ~ '[0-9]{7,}'
    or regexp_replace(v,'[^a-z0-9ء-ي]','','g') ~ '(050|05[0-9]|9665)';
end $$;
revoke all on function public.contractor_contact_detected(text) from public;
grant execute on function public.contractor_contact_detected(text) to authenticated;

create or replace function public.contractor_safe_label(p_text text,p_fallback text)
returns text language sql immutable set search_path='' as $$
select case when public.contractor_contact_detected(p_text) then p_fallback else coalesce(nullif(btrim(p_text),''),p_fallback) end
$$;
revoke all on function public.contractor_safe_label(text,text) from public;

-- Close the direct Data API route to contact fields, including old anonymous clients.
alter policy contractor_profiles_public_read on public.contractor_profiles
using(public.is_admin() or profile_id=(select auth.uid()));
alter policy contractor_profile_specialties_public_read on public.contractor_profile_specialties
using(public.is_admin() or public.is_contractor_owner(profile_id));
alter policy contractor_profile_regions_public_read on public.contractor_profile_regions
using(public.is_admin() or public.is_contractor_owner(profile_id));
-- Keep collecting reviews privately until publication is explicitly enabled.
alter policy contractor_reviews_public_select on public.contractor_reviews
using(public.is_admin() or customer_profile_id=(select auth.uid()));
alter policy contractor_review_replies_public_select on public.contractor_review_replies
using(public.is_admin() or public.is_contractor_owner(contractor_profile_id));
alter policy contractor_services_public_select on public.contractor_services
using(public.is_admin() or public.is_contractor_owner(contractor_profile_id));
alter policy contractor_portfolio_public_read on public.contractor_portfolio_items
using(public.is_admin() or public.is_contractor_owner(profile_id));
alter policy contractor_portfolio_media_public_select on public.contractor_portfolio_media
using(public.is_admin() or exists(select 1 from public.contractor_portfolio_items i where i.id=portfolio_item_id and public.is_contractor_owner(i.profile_id)));

create or replace function public.contractor_directory_cards()
returns table(id uuid,display_name text,commercial_name text,city text,badge text,availability text,years_experience integer,projects_count integer,service_types text[],work_regions text[])
language sql stable security definer set search_path='' as $$
select c.id,public.contractor_safe_label(c.display_name,'مقاول معتمد'),public.contractor_safe_label(c.commercial_name,'مقاول معتمد'),
 public.contractor_safe_label(c.city,'غير محدد'),'مقاول معتمد',c.availability::text,c.years_experience,c.projects_count,
 array(select public.contractor_safe_label(s.specialty_name,'مقاولات عامة') from public.contractor_profile_specialties s where s.profile_id=c.id order by s.sort_order),
 array(select public.contractor_safe_label(r.region_name,'غير محدد') from public.contractor_profile_regions r where r.profile_id=c.id order by r.region_name)
from public.contractor_profiles c where public.contractor_publicly_eligible(c.id) order by c.commercial_name
$$;
revoke all on function public.contractor_directory_cards() from public;
grant execute on function public.contractor_directory_cards() to anon,authenticated,service_role;

create table public.contractor_conversations(
 id uuid primary key default gen_random_uuid(),
 number bigint generated always as identity unique,
 customer_id uuid not null references public.profiles(id) on delete restrict,
 contractor_id uuid not null references public.contractor_profiles(id) on delete restrict,
 contractor_user_id uuid not null references public.profiles(id) on delete restrict,
 customer_name text not null,contractor_name text not null,
 status text not null default 'open' check(status in('open','contracted','completion_requested','completed','disputed','closed')),
 project_id uuid unique references public.contractor_projects(id) on delete restrict,
 accepted_quote_id uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(customer_id<>contractor_user_id)
);
create unique index contractor_conversations_active_pair_idx on public.contractor_conversations(customer_id,contractor_id) where status not in('closed','completed');
create index contractor_conversations_customer_idx on public.contractor_conversations(customer_id,updated_at desc);
create index contractor_conversations_contractor_idx on public.contractor_conversations(contractor_user_id,updated_at desc);
create table public.contractor_chat_messages(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.contractor_conversations(id) on delete restrict,
 sender_id uuid not null references public.profiles(id) on delete restrict,
 kind text not null check(kind in('message','quote')),
 body text not null check(length(body) between 1 and 4000),
 moderation text not null check(moderation in('pending','blocked','released','rejected')),
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index contractor_chat_messages_page_idx on public.contractor_chat_messages(conversation_id,created_at,id);
create index contractor_chat_messages_review_idx on public.contractor_chat_messages(moderation,created_at) where moderation='pending';
create table public.contractor_chat_originals(
 message_id uuid primary key references public.contractor_chat_messages(id) on delete restrict,
 original_body text not null,detected boolean not null
);
create table public.contractor_chat_quotes(
 id uuid primary key references public.contractor_chat_messages(id) on delete restrict,
 amount numeric(14,2) not null check(amount>0 and amount<100000000),
 duration_days integer not null check(duration_days between 1 and 3650),
 start_at date not null,valid_until timestamptz not null,
 status text not null default 'offered' check(status in('offered','accepted','rejected','changes_requested','superseded')),
 commission_rate numeric(5,2) not null default 5 check(commission_rate=5),
 commission_amount numeric(14,2) generated always as (round(amount*0.05,2)) stored,
 accepted_by uuid references public.profiles(id),accepted_at timestamptz,
 terms_version text not null default 'contractor-platform-v1',
 check((status='accepted')=(accepted_at is not null and accepted_by is not null))
);
alter table public.contractor_conversations add foreign key(accepted_quote_id) references public.contractor_chat_quotes(id) on delete restrict;
create table public.contractor_chat_events(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.contractor_conversations(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 action text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create index contractor_chat_events_page_idx on public.contractor_chat_events(conversation_id,created_at,id);
create unique index contractor_chat_payment_reference_idx on public.contractor_financial_transactions(reference) where reference like 'chat-payment:%';
create table public.contractor_chat_receipts(
 actor_id uuid not null references public.profiles(id),key uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,key)
);
create table public.contractor_chat_payments(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.contractor_conversations(id),
 customer_id uuid not null references public.profiles(id),amount numeric(14,2) not null check(amount>0),
 status text not null default 'pending' check(status in('pending','succeeded','failed','review')),
 gateway_order_id text unique,gateway_transaction_id text unique,session_secret text,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '70 minutes',
 processed_at timestamptz
);
create index contractor_chat_payments_conversation_idx on public.contractor_chat_payments(conversation_id,created_at desc);
create table public.contractor_collection_account(
 singleton boolean primary key default true check(singleton),bank_name text not null,beneficiary text not null,iban text not null,
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.contractor_chat_transfers(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.contractor_conversations(id),
 customer_id uuid not null references public.profiles(id),amount numeric(14,2) not null check(amount>0 and amount<100000000),
 reference text not null check(length(reference) between 4 and 120),status text not null default 'pending' check(status in('pending','confirmed','rejected')),
 created_at timestamptz not null default now(),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz
);
create index contractor_chat_transfers_conversation_idx on public.contractor_chat_transfers(conversation_id,created_at);
alter table public.contractor_collection_account enable row level security;
alter table public.contractor_chat_transfers enable row level security;
revoke all on public.contractor_collection_account,public.contractor_chat_transfers from public,anon,authenticated;
grant select on public.contractor_collection_account,public.contractor_chat_transfers to authenticated;
create policy collection_account_finance on public.contractor_collection_account for select to authenticated using(public.admin_has_permission('finance.manage'));
create policy chat_transfers_read on public.contractor_chat_transfers for select to authenticated using(public.admin_has_permission('finance.manage') or customer_id=auth.uid());
alter table public.contractor_chat_payments enable row level security;
revoke all on public.contractor_chat_payments from public,anon,authenticated;
grant all on public.contractor_chat_payments to service_role;

create or replace function public.contractor_chat_member(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.contractor_conversations c join public.profiles p on p.id=auth.uid() and p.is_active and not p.must_change_password
 where c.id=p_id and (c.customer_id=p.id and exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role='customer' and r.revoked_at is null)
 or c.contractor_user_id=p.id and public.contractor_publicly_eligible(c.contractor_id)))
$$;
revoke all on function public.contractor_chat_member(uuid) from public;
grant execute on function public.contractor_chat_member(uuid) to authenticated;
alter table public.contractor_conversations enable row level security;
alter table public.contractor_chat_messages enable row level security;
alter table public.contractor_chat_originals enable row level security;
alter table public.contractor_chat_quotes enable row level security;
alter table public.contractor_chat_events enable row level security;
alter table public.contractor_chat_receipts enable row level security;
revoke all on public.contractor_conversations,public.contractor_chat_messages,public.contractor_chat_originals,public.contractor_chat_quotes,public.contractor_chat_events,public.contractor_chat_receipts from anon,authenticated;
grant select on public.contractor_conversations,public.contractor_chat_messages,public.contractor_chat_originals,public.contractor_chat_quotes,public.contractor_chat_events to authenticated;
create policy chat_conversations_read on public.contractor_conversations for select to authenticated using(public.admin_has_permission('projects.manage') or public.contractor_chat_member(id));
create policy chat_messages_read on public.contractor_chat_messages for select to authenticated using(public.admin_has_permission('projects.manage') or (public.contractor_chat_member(conversation_id) and (moderation='released' or sender_id=auth.uid())));
create policy chat_originals_admin on public.contractor_chat_originals for select to authenticated using(public.admin_has_permission('projects.manage'));
create policy chat_quotes_read on public.contractor_chat_quotes for select to authenticated using(exists(select 1 from public.contractor_chat_messages m where m.id=contractor_chat_quotes.id));
create policy chat_events_read on public.contractor_chat_events for select to authenticated using(public.admin_has_permission('projects.manage') or public.contractor_chat_member(conversation_id));

create or replace function public.contractor_chat_command(p_action text,p_conversation uuid,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();v_admin boolean;v_c public.contractor_conversations%rowtype;
 v_m public.contractor_chat_messages%rowtype;v_q public.contractor_chat_quotes%rowtype;
 v_body text;v_detected boolean;v_id uuid;v_result jsonb;v_old record;v_request jsonb;v_transfer public.contractor_chat_transfers%rowtype;
 v_request_id uuid;v_op uuid;v_proposal uuid;v_project uuid;v_amount numeric;v_paid numeric;v_ref text;v_balance numeric;
begin
 if v_actor is null or p_key is null or p_action is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>18000
 or not exists(select 1 from public.profiles where id=v_actor and is_active and not must_change_password) then raise exception 'Not authorized';end if;
 v_admin:=public.admin_has_permission('projects.manage');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,73021));
 v_request:=jsonb_build_object('action',p_action,'conversation',p_conversation,'payload',p_payload);
 select request,result into v_old from public.contractor_chat_receipts where actor_id=v_actor and key=p_key;
 if found then if v_old.request<>v_request then raise exception 'Request key already used';end if;return v_old.result;end if;
 if p_action='open' then
   if not public.has_verified_customer_identity(v_actor) or not exists(select 1 from public.user_roles where profile_id=v_actor and role='customer' and revoked_at is null) then raise exception 'Verified customer required';end if;
   if not exists(select 1 from public.contractor_profiles where id=(p_payload->>'contractor_id')::uuid and profile_id<>v_actor and public.contractor_publicly_eligible(id)) then raise exception 'Contractor unavailable';end if;
   insert into public.contractor_conversations(customer_id,contractor_id,contractor_user_id,customer_name,contractor_name)
   select v_actor,c.id,c.profile_id,public.contractor_safe_label(p.full_name,'عميل بُنية'),public.contractor_safe_label(c.commercial_name,'مقاول معتمد')
   from public.contractor_profiles c join public.profiles p on p.id=v_actor where c.id=(p_payload->>'contractor_id')::uuid
   on conflict(customer_id,contractor_id) where status not in('closed','completed') do update set customer_id=excluded.customer_id returning * into v_c;
   v_result:=jsonb_build_object('id',v_c.id);
 else
   select * into v_c from public.contractor_conversations where id=p_conversation for update;
   if not found or (not v_admin and not public.contractor_chat_member(v_c.id)) then raise exception 'Not authorized';end if;
   if p_action in('send','quote') then
     if v_actor not in(v_c.customer_id,v_c.contractor_user_id) or not public.contractor_chat_member(v_c.id) then raise exception 'Participants only';end if;
     if v_c.status in('closed','completed') then raise exception 'Conversation closed';end if;
     if (select count(*) from public.contractor_chat_messages where sender_id=v_actor and created_at>now()-interval '1 minute')>=10 then raise exception 'Rate limit';end if;
     v_body:=btrim(coalesce(p_payload->>'body',''));
     if length(v_body) not between 1 and 4000 then raise exception 'Invalid message';end if;
     v_detected:=public.contractor_contact_detected(v_body);
     insert into public.contractor_chat_messages(conversation_id,sender_id,kind,body,moderation)
     values(v_c.id,v_actor,case when p_action='quote' then 'quote' else 'message' end,
       case when v_detected then 'حُجبت الرسالة لاحتوائها على وسيلة تواصل.' else v_body end,case when v_detected then 'blocked' else 'pending' end) returning id into v_id;
     insert into public.contractor_chat_originals values(v_id,v_body,v_detected);
     if p_action='quote' then
       if v_actor<>v_c.contractor_user_id or v_c.status<>'open' or v_c.accepted_quote_id is not null then raise exception 'Quote not allowed';end if;
       if coalesce((p_payload->>'terms_accepted')::boolean,false) is not true then raise exception 'Terms required';end if;
       if (p_payload->>'valid_days')::integer not between 1 and 30 or (p_payload->>'start_at')::date<current_date then raise exception 'Invalid quote dates';end if;
       insert into public.contractor_chat_quotes(id,amount,duration_days,start_at,valid_until)
       values(v_id,(p_payload->>'amount')::numeric,(p_payload->>'duration_days')::integer,(p_payload->>'start_at')::date,now()+((p_payload->>'valid_days')::integer*interval '1 day'));
     end if;
     v_result:=jsonb_build_object('id',v_id,'moderation',case when v_detected then 'blocked' else 'pending' end);
   elsif p_action in('release','reject_message') then
     if not v_admin then raise exception 'Not authorized';end if;
     select * into v_m from public.contractor_chat_messages where id=(p_payload->>'message_id')::uuid and conversation_id=v_c.id for update;
     if not found or v_m.moderation not in('pending','blocked') then raise exception 'Message already reviewed';end if;
     if p_action='release' then
       if v_c.status in('closed','completed') then raise exception 'Conversation closed';end if;
       if v_m.moderation='blocked' then raise exception 'Blocked contact cannot be released';end if;
       v_body:=btrim(coalesce(p_payload->>'body',v_m.body));
       if v_m.kind='quote' and v_body<>v_m.body then raise exception 'Quote scope cannot be edited by reviewer';end if;
       if length(v_body) not between 1 and 4000 or public.contractor_contact_detected(v_body) then raise exception 'Contact information prohibited';end if;
       if coalesce((p_payload->>'review_confirmed')::boolean,false) is not true then raise exception 'Review confirmation required';end if;
     else v_body:='لم تُعتمد الرسالة لمخالفتها سياسة التواصل.';end if;
     update public.contractor_chat_messages set body=v_body,moderation=case when p_action='release' then 'released' else 'rejected' end,reviewed_by=v_actor,reviewed_at=now() where id=v_m.id;
     -- Review details are private: they do not disclose a blocked message to its recipient.
     insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data) values(v_actor,'contractor_chat_messages',v_m.id::text,p_action,jsonb_build_object('conversation_id',v_c.id));
     v_result:=jsonb_build_object('id',v_m.id);
   elsif p_action in('accept_quote','reject_quote','request_changes') then
     if v_actor<>v_c.customer_id or not public.has_verified_customer_identity(v_actor) then raise exception 'Customer decision required';end if;
     select * into v_m from public.contractor_chat_messages where id=(p_payload->>'quote_id')::uuid and conversation_id=v_c.id and moderation='released' for update;
     if not found then raise exception 'Quote unavailable';end if;
     select * into v_q from public.contractor_chat_quotes where id=v_m.id for update;
     if not found or v_q.status<>'offered' or v_q.valid_until<=now() or v_c.status<>'open' or v_c.accepted_quote_id is not null then raise exception 'Quote expired or decided';end if;
     if not public.contractor_publicly_eligible(v_c.contractor_id) then raise exception 'Contractor unavailable';end if;
     if p_action='accept_quote' then
       if coalesce((p_payload->>'terms_accepted')::boolean,false) is not true then raise exception 'Terms required';end if;
       if v_q.start_at<current_date then raise exception 'Quote start date expired';end if;
       -- Materialize the existing project/finance workflow only from a reviewed immutable offer.
       insert into public.project_requests(request_code,customer_profile_id,title,project_type,description,scope,city,region,estimated_budget_min,estimated_budget_max,expected_start_at,estimated_duration,proposal_deadline_at,customer_label,lifecycle_status,search_status)
       values('CHAT-'||v_c.number||'-'||substr(v_q.id::text,1,8),v_c.customer_id,'مشروع المحادثة '||v_c.number,'مقاولات',v_m.body,v_m.body,'حسب الاتفاق','حسب الاتفاق',v_q.amount,v_q.amount,v_q.start_at,v_q.duration_days||' يوم',v_q.valid_until,v_c.customer_name,'receiving_proposals','awaiting_customer') returning id into v_request_id;
       insert into public.contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at,is_current) values(v_request_id,v_c.contractor_id,'proposed',v_q.valid_until,true) returning id into v_op;
       update public.project_requests set active_opportunity_id=v_op where id=v_request_id;
       insert into public.contractor_proposals(proposal_code,opportunity_id,contractor_profile_id,amount,vat_inclusive,execution_duration,proposed_start_at,scope_details,valid_until,policy_accepted,status,submitted_at)
       values('CQ-'||v_c.number||'-'||substr(v_q.id::text,1,8),v_op,v_c.contractor_id,v_q.amount,true,v_q.duration_days||' يوم',v_q.start_at,v_m.body,v_q.valid_until,true,'under_review',now()) returning id into v_proposal;
       insert into public.contractor_proposal_stages(proposal_id,name,description,duration,value_percentage,expected_at) values(v_proposal,'تسليم الأعمال',v_m.body,v_q.duration_days||' يوم',100,v_q.start_at+v_q.duration_days);
       v_project:=public.decide_contractor_proposal(v_proposal,'accepted','اعتماد موثق داخل المحادثة',p_key::text);
       update public.contractor_chat_quotes set status='accepted',accepted_by=v_actor,accepted_at=now() where id=v_q.id;
       update public.contractor_chat_quotes set status='superseded' where id<>v_q.id and status='offered' and id in(select id from public.contractor_chat_messages where conversation_id=v_c.id);
       update public.contractor_conversations set accepted_quote_id=v_q.id,project_id=v_project,status='contracted' where id=v_c.id;
     else update public.contractor_chat_quotes set status=case when p_action='reject_quote' then 'rejected' else 'changes_requested' end where id=v_q.id;end if;
     insert into public.contractor_chat_events(conversation_id,actor_id,action,details) values(v_c.id,v_actor,p_action,jsonb_build_object('quote_id',v_q.id,'amount',v_q.amount,'commission_rate',v_q.commission_rate,'commission_amount',v_q.commission_amount,'terms_version',v_q.terms_version));
     v_result:=jsonb_build_object('id',v_q.id,'project_id',v_project);
   elsif p_action='transfer_notice' then
     if v_actor<>v_c.customer_id or v_c.status not in('contracted','completion_requested') or not exists(select 1 from public.contractor_collection_account) then raise exception 'Transfer not available';end if;
     if exists(select 1 from public.contractor_chat_transfers where conversation_id=v_c.id and status='pending') then raise exception 'Transfer already under review';end if;
     v_amount:=(p_payload->>'amount')::numeric;v_ref:=btrim(coalesce(p_payload->>'reference',''));
     select * into v_q from public.contractor_chat_quotes where id=v_c.accepted_quote_id;
     if v_amount is null or v_amount<=0 or v_amount>v_q.amount or v_amount::text in('NaN','Infinity','-Infinity') then raise exception 'Invalid payment';end if;
     insert into public.contractor_chat_transfers(conversation_id,customer_id,amount,reference) values(v_c.id,v_actor,v_amount,v_ref) returning id into v_id;
     v_result:=jsonb_build_object('id',v_id);
   elsif p_action='reject_transfer' then
     if not v_admin or not public.admin_has_permission('finance.manage') then raise exception 'Not authorized';end if;
     update public.contractor_chat_transfers set status='rejected',reviewed_by=v_actor,reviewed_at=now() where id=(p_payload->>'transfer_id')::uuid and conversation_id=v_c.id and status='pending';
     if not found then raise exception 'Transfer already reviewed';end if;
     v_result:=jsonb_build_object('id',v_c.id);
   elsif p_action='record_payment' then
     if not v_admin or not public.admin_has_permission('finance.manage') or v_c.project_id is null or v_c.status not in('contracted','completion_requested') then raise exception 'Finance permission required';end if;
     if coalesce((p_payload->>'payment_confirmed')::boolean,false) is not true then raise exception 'Actual receipt confirmation required';end if;
     if exists(select 1 from public.contractor_chat_payments where conversation_id=v_c.id and status in('review','pending')) then raise exception 'Online payment requires reconciliation first';end if;
     v_amount:=(p_payload->>'amount')::numeric;v_ref:=btrim(coalesce(p_payload->>'reference',''));
     if p_payload->>'transfer_id' is not null then
       select * into v_transfer from public.contractor_chat_transfers where id=(p_payload->>'transfer_id')::uuid and conversation_id=v_c.id and status='pending' for update;
       if not found then raise exception 'Transfer already reviewed';end if;
       v_amount:=v_transfer.amount;v_ref:=v_transfer.reference;
     end if;
     if v_amount is null or v_amount::text in('NaN','Infinity','-Infinity') or v_amount<=0 or v_amount<>round(v_amount,2) or length(v_ref) not between 4 and 120 then raise exception 'Invalid payment';end if;
     perform 1 from public.contractor_projects where id=v_c.project_id for update;
     select * into v_q from public.contractor_chat_quotes where id=v_c.accepted_quote_id;
     select coalesce(sum(amount),0) into v_paid from public.contractor_financial_transactions where project_id=v_c.project_id and status in('available','completed') and financial_kind in('advance','milestone_payment','final_payment');
     if v_paid+v_amount>v_q.amount then raise exception 'Payment exceeds remaining amount';end if;
     if exists(select 1 from public.contractor_financial_transactions where reference='chat-payment:'||v_ref) then raise exception 'Payment reference already recorded';end if;
     select coalesce(sum(case when financial_kind in('commission','tax','discount') then -abs(amount) else amount end),0)+v_amount into v_balance from public.contractor_financial_transactions where contractor_profile_id=v_c.contractor_id and status in('available','completed');
     insert into public.contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,transaction_type,financial_kind,amount,status,balance_after,reference,metadata)
     values('CHATPAY-'||p_key::text,v_c.contractor_id,v_c.project_id,'milestone_payment','milestone_payment',v_amount,'available',v_balance,'chat-payment:'||v_ref,jsonb_build_object('conversation_id',v_c.id,'verified_by',v_actor,'idempotency_key',p_key));
     update public.contractor_projects set payment_status=case when v_paid+v_amount=v_q.amount then 'paid' else 'partial' end,status='active' where id=v_c.project_id;
     insert into public.contractor_chat_events(conversation_id,actor_id,action,details) values(v_c.id,v_actor,p_action,jsonb_build_object('amount',v_amount));
     if v_transfer.id is not null then update public.contractor_chat_transfers set status='confirmed',reviewed_by=v_actor,reviewed_at=now() where id=v_transfer.id;end if;
     v_result:=jsonb_build_object('id',v_c.id);
   elsif p_action in('request_completion','confirm_completion','dispute','resolve_dispute','close') then
     if p_action='request_completion' then
       if v_actor<>v_c.contractor_user_id or v_c.status<>'contracted' then raise exception 'Invalid state';end if;
       update public.contractor_conversations set status='completion_requested' where id=v_c.id;
     elsif p_action='confirm_completion' then
       if v_actor<>v_c.customer_id or v_c.status<>'completion_requested' then raise exception 'Customer completion required';end if;
       if not exists(select 1 from public.contractor_projects where id=v_c.project_id and payment_status='paid') then raise exception 'Full payment required';end if;
       update public.contractor_conversations set status='completed' where id=v_c.id;
       update public.contractor_projects set status='completed',progress=100 where id=v_c.project_id;
     elsif p_action='dispute' then
       if v_actor not in(v_c.customer_id,v_c.contractor_user_id) or v_c.status not in('contracted','completion_requested') then raise exception 'Invalid state';end if;
       update public.contractor_conversations set status='disputed' where id=v_c.id;
     elsif p_action='resolve_dispute' then
       if not v_admin or v_c.status<>'disputed' then raise exception 'Not authorized';end if;
       update public.contractor_conversations set status='contracted' where id=v_c.id;
     else
       if not v_admin or v_c.status<>'open' then raise exception 'Only uncontracted conversations can close';end if;
       update public.contractor_conversations set status='closed' where id=v_c.id;
     end if;
     insert into public.contractor_chat_events(conversation_id,actor_id,action) values(v_c.id,v_actor,p_action);
     v_result:=jsonb_build_object('id',v_c.id);
   else raise exception 'Unknown action';end if;
   update public.contractor_conversations set updated_at=now() where id=v_c.id;
 end if;
 insert into public.contractor_chat_receipts(actor_id,key,request,result) values(v_actor,p_key,v_request,v_result);
 return v_result;
end $$;
revoke all on function public.contractor_chat_command(text,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.contractor_chat_command(text,uuid,jsonb,uuid) to authenticated;

create or replace function public.contractor_chat_summary(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.contractor_conversations%rowtype;q public.contractor_chat_quotes%rowtype;paid numeric;
begin
 if not public.contractor_chat_member(p_id) and not public.admin_has_permission('projects.manage') then raise exception 'Not authorized';end if;
 select * into c from public.contractor_conversations where id=p_id;
 select * into q from public.contractor_chat_quotes where id=c.accepted_quote_id;
 select coalesce(sum(amount),0) into paid from public.contractor_financial_transactions where project_id=c.project_id and status in('available','completed') and financial_kind in('advance','milestone_payment','final_payment');
 return jsonb_build_object('quote',case when q.id is null then null else to_jsonb(q)||jsonb_build_object('scope',(select body from public.contractor_chat_messages where id=q.id)) end,'paid',paid,
 'payment_review',exists(select 1 from public.contractor_chat_payments where conversation_id=p_id and status='review'),
 'bank',case when c.accepted_quote_id is not null and (c.customer_id=auth.uid() or public.admin_has_permission('finance.manage')) then
 (select jsonb_build_object('bank_name',bank_name,'beneficiary',beneficiary,'iban',iban) from public.contractor_collection_account) else null end);
end $$;
revoke all on function public.contractor_chat_summary(uuid) from public,anon,service_role;
grant execute on function public.contractor_chat_summary(uuid) to authenticated;

create or replace function public.configure_contractor_collection_account(p_bank text,p_beneficiary text,p_iban text)
returns void language plpgsql security definer set search_path='' as $$
declare iban text:=upper(regexp_replace(coalesce(p_iban,''),'[[:space:]]','','g'));
begin
 if not public.admin_has_permission('finance.manage') or not exists(select 1 from public.profiles where id=auth.uid() and is_active and not must_change_password) then raise exception 'Not authorized';end if;
 if length(btrim(coalesce(p_bank,''))) not between 2 and 100 or length(btrim(coalesce(p_beneficiary,''))) not between 2 and 150
 or iban!~'^SA[0-9]{22}$' or mod((substr(iban,5)||'2810'||substr(iban,3,2))::numeric,97)<>1 then raise exception 'Invalid Saudi bank account';end if;
 insert into public.contractor_collection_account(singleton,bank_name,beneficiary,iban,updated_by) values(true,btrim(p_bank),btrim(p_beneficiary),iban,auth.uid())
 on conflict(singleton) do update set bank_name=excluded.bank_name,beneficiary=excluded.beneficiary,iban=excluded.iban,updated_by=auth.uid(),updated_at=now();
 insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data) values(auth.uid(),'contractor_collection_account','true','collection_account_changed',jsonb_build_object('iban_last4',right(iban,4)));
end $$;
revoke all on function public.configure_contractor_collection_account(text,text,text) from public,anon,service_role;
grant execute on function public.configure_contractor_collection_account(text,text,text) to authenticated;

-- Server-only checkout reservation. A single lease prevents parallel checkout creation.
create or replace function public.reserve_contractor_chat_payment(p_id uuid,p_customer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contractor_conversations%rowtype;p public.contractor_chat_payments%rowtype;total numeric;paid numeric;
begin
 select * into c from public.contractor_conversations where id=p_id for update;
 if not found or c.customer_id<>p_customer or c.status not in('contracted','completion_requested')
 or not public.has_verified_customer_identity(p_customer)
 or not exists(select 1 from public.profiles where id=p_customer and is_active and not must_change_password)
 or not exists(select 1 from public.user_roles where profile_id=p_customer and role='customer' and revoked_at is null)
 then raise exception 'Not authorized';end if;
 if exists(select 1 from public.contractor_chat_payments where conversation_id=p_id and status='review') then raise exception 'Payment requires review';end if;
 if exists(select 1 from public.contractor_chat_transfers where conversation_id=p_id and status='pending') then raise exception 'Transfer requires review';end if;
 select amount into total from public.contractor_chat_quotes where id=c.accepted_quote_id;
 select coalesce(sum(amount),0) into paid from public.contractor_financial_transactions where project_id=c.project_id and status in('available','completed') and financial_kind in('advance','milestone_payment','final_payment');
 if total<=paid then return jsonb_build_object('status','succeeded');end if;
 -- Expiry alone never proves payment failure; server inquiry must resolve the old reservation first.
 select * into p from public.contractor_chat_payments where conversation_id=p_id and status='pending' order by created_at desc limit 1;
 if found then return to_jsonb(p)||jsonb_build_object('created',false,'number',c.number,'quote_id',c.accepted_quote_id);end if;
 insert into public.contractor_chat_payments(conversation_id,customer_id,amount) values(p_id,p_customer,total-paid) returning * into p;
 return to_jsonb(p)||jsonb_build_object('created',true,'number',c.number,'quote_id',c.accepted_quote_id);
end $$;
revoke all on function public.reserve_contractor_chat_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_contractor_chat_payment(uuid,uuid) to service_role;

create or replace function public.apply_contractor_chat_payment(p_id uuid,p_transaction text,p_order text,p_amount numeric,p_outcome text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.contractor_chat_payments%rowtype;c public.contractor_conversations%rowtype;total numeric;paid numeric;balance numeric;
begin
 select * into p from public.contractor_chat_payments where id=p_id;
 if not found then raise exception 'Payment not found';end if;
 select * into c from public.contractor_conversations where id=p.conversation_id for update;
 select * into p from public.contractor_chat_payments where id=p_id for update;
 if p.gateway_order_id is null or p.gateway_order_id is distinct from p_order or p_amount is distinct from p.amount or coalesce(p_transaction,'')!~'^[0-9]+$'
 or p_outcome is null or p_outcome not in('succeeded','failed','refunded') then raise exception 'Payment mismatch';end if;
 if p.gateway_transaction_id is not null and p.gateway_transaction_id<>p_transaction then
   if p.status='succeeded' and p_outcome='failed' then return jsonb_build_object('status',p.status);end if;
   raise exception 'Transaction mismatch';
 end if;
 if p.status='review' or (p.status='succeeded' and p_outcome<>'refunded') then return jsonb_build_object('status',p.status);end if;
 if p_outcome='refunded' then
   -- Keep the original financial history. Hold settlement until finance reconciles a refund/chargeback.
   update public.contractor_chat_payments set status='review',gateway_transaction_id=p_transaction,processed_at=now() where id=p.id;
   update public.contractor_conversations set status='disputed',updated_at=now() where id=c.id;
   insert into public.contractor_chat_events(conversation_id,actor_id,action) values(c.id,c.customer_id,'payment_review');
   return jsonb_build_object('status','review');
 elsif p_outcome='failed' then
   -- Keep the reservation until expiry: another transaction may still be pending in this checkout.
   return jsonb_build_object('status','pending');
 end if;
 perform 1 from public.contractor_projects where id=c.project_id for update;
 select amount into total from public.contractor_chat_quotes where id=c.accepted_quote_id;
 select coalesce(sum(amount),0) into paid from public.contractor_financial_transactions where project_id=c.project_id and status in('available','completed') and financial_kind in('advance','milestone_payment','final_payment');
 if paid+p.amount>total then
   update public.contractor_chat_payments set status='review',gateway_transaction_id=p_transaction,processed_at=now() where id=p.id;
   update public.contractor_conversations set status='disputed',updated_at=now() where id=c.id;
   insert into public.contractor_chat_events(conversation_id,actor_id,action) values(c.id,c.customer_id,'payment_review');
   return jsonb_build_object('status','review');
 end if;
 select coalesce(sum(case when financial_kind in('commission','tax','discount') then -abs(amount) else amount end),0)+p.amount into balance from public.contractor_financial_transactions where contractor_profile_id=c.contractor_id and status in('available','completed');
 insert into public.contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,transaction_type,financial_kind,amount,status,balance_after,reference,metadata)
 values('CHATPAY-'||p.id,c.contractor_id,c.project_id,'milestone_payment','milestone_payment',p.amount,'available',balance,'chat-payment:paymob-'||p_transaction,jsonb_build_object('conversation_id',c.id,'payment_id',p.id,'gateway','paymob'));
 update public.contractor_chat_payments set status='succeeded',gateway_transaction_id=p_transaction,processed_at=now() where id=p.id;
 update public.contractor_projects set payment_status=case when paid+p.amount=total then 'paid' else 'partial' end,status=case when c.status='disputed' then status else 'active'::public.contractor_project_status end where id=c.project_id;
 update public.contractor_conversations set updated_at=now() where id=c.id;
 insert into public.contractor_chat_events(conversation_id,actor_id,action,details) values(c.id,c.customer_id,'online_payment',jsonb_build_object('amount',p.amount));
 return jsonb_build_object('status','succeeded');
end $$;
revoke all on function public.apply_contractor_chat_payment(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.apply_contractor_chat_payment(uuid,text,text,numeric,text) to service_role;

create or replace function public.guard_contractor_chat_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.workflow_status not in('cancelled','rejected','failed') and (
  exists(select 1 from public.contractor_conversations c where c.contractor_id=new.contractor_profile_id and c.status='disputed') or
  exists(select 1 from public.contractor_chat_payments p join public.contractor_conversations c on c.id=p.conversation_id where c.contractor_id=new.contractor_profile_id and p.status='review')
 ) then raise exception 'Resolve platform conversation payment dispute before settlement';end if;
 return new;
end $$;
revoke all on function public.guard_contractor_chat_settlement() from public,anon,authenticated,service_role;
create trigger contractor_chat_settlement_guard before insert or update on public.contractor_settlement_requests for each row execute function public.guard_contractor_chat_settlement();

-- Linked projects may not reopen an unmoderated text/attachment path in legacy screens.
create or replace function public.guard_contractor_chat_project_content()
returns trigger language plpgsql security definer set search_path='' as $$
declare project uuid;c public.contractor_conversations%rowtype;
begin
 if tg_table_name='contractor_projects' then project:=new.id;else project:=new.project_id;end if;
 select * into c from public.contractor_conversations where project_id=project;
 if not found then return new;end if;
 if tg_table_name='contractor_projects' then
   if (to_jsonb(new)-array['progress','status','payment_status','next_payment_label','updated_at']) is distinct from (to_jsonb(old)-array['progress','status','payment_status','next_payment_label','updated_at'])
      or new.next_payment_label is distinct from old.next_payment_label then raise exception 'Use the moderated platform conversation';end if;
   if new.status='completed' and c.status<>'completed' then raise exception 'Customer conversation completion required';end if;
 else
   if not public.admin_has_permission('projects.manage') then raise exception 'Use the moderated platform conversation';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_contractor_chat_project_content() from public,anon,authenticated,service_role;
create trigger chat_project_content_guard before update on public.contractor_projects for each row execute function public.guard_contractor_chat_project_content();
create trigger chat_project_updates_guard before insert or update on public.contractor_project_updates for each row execute function public.guard_contractor_chat_project_content();
create trigger chat_project_documents_guard before insert or update on public.contractor_project_documents for each row execute function public.guard_contractor_chat_project_content();
create trigger chat_project_milestones_guard before insert or update on public.contractor_project_milestones for each row execute function public.guard_contractor_chat_project_content();

commit;
