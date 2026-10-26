begin;

-- New material requests are administered by Bunya. Historical supplier orders
-- remain in their existing tables and keep their current lifecycle.
create table public.managed_quote_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'submitted' check (status in ('submitted','offered','accepted','rejected','delivered','cancelled')),
  details jsonb not null check (jsonb_typeof(details)='object'),
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 50),
  pricing jsonb not null default '[]'::jsonb check (jsonb_typeof(pricing)='array'),
  subtotal numeric(18,2) not null default 0 check (subtotal>=0),
  vat_rate numeric(5,2) not null default 15 check (vat_rate between 0 and 100),
  vat_amount numeric(18,2) not null default 0 check (vat_amount>=0),
  delivery_fee numeric(18,2) not null default 0 check (delivery_fee>=0),
  total numeric(18,2) not null default 0 check (total>=0 and total=subtotal+vat_amount+delivery_fee),
  valid_until timestamptz,
  expected_delivery_at timestamptz,
  terms text not null default '',
  assigned_admin_id uuid references public.profiles(id) on delete restrict,
  revision integer not null default 0 check (revision>=0),
  idempotency_key text not null,
  request_fingerprint text not null,
  accepted_at timestamptz,
  rejected_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,idempotency_key),
  check (length(terms)<=10000),
  check (status not in ('offered','accepted','delivered') or (revision>0 and valid_until is not null and jsonb_array_length(pricing)=jsonb_array_length(items))),
  check (status not in ('accepted','delivered') or accepted_at is not null),
  check (status<>'delivered' or delivered_at is not null)
);
create index managed_quote_requests_customer_created_idx on public.managed_quote_requests(customer_id,created_at desc);
create index managed_quote_requests_status_created_idx on public.managed_quote_requests(status,created_at desc);
create index managed_quote_requests_admin_idx on public.managed_quote_requests(assigned_admin_id,status) where assigned_admin_id is not null;

create table public.managed_quote_delivery_codes (
  request_id uuid primary key references public.managed_quote_requests(id) on delete restrict,
  code_salt text not null check (code_salt ~ '^[a-f0-9]{48}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  customer_code_ciphertext text not null check (customer_code_ciphertext ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts>=0),
  max_attempts integer not null default 5 check (max_attempts=5),
  locked_until timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.managed_quote_delivery_codes is 'Service-only code material. Plaintext is returned only by the authenticated owner endpoint, never to administrators.';

create table public.managed_quote_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.managed_quote_requests(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  revision integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index managed_quote_events_request_time_idx on public.managed_quote_events(request_id,created_at);

alter table public.managed_quote_requests enable row level security;
alter table public.managed_quote_delivery_codes enable row level security;
alter table public.managed_quote_events enable row level security;
revoke all on public.managed_quote_requests,public.managed_quote_delivery_codes,public.managed_quote_events from public,anon,authenticated;
grant select on public.managed_quote_requests,public.managed_quote_events to authenticated;
grant all on public.managed_quote_requests,public.managed_quote_delivery_codes,public.managed_quote_events to service_role;

create policy managed_quote_requests_read on public.managed_quote_requests for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and not p.must_change_password)
  and public.admin_has_permission('sourcing.manage')
);
-- Customer reads go through the owner-checked server API, which strips draft
-- pricing. Direct RLS reads are admin-only so an unfinished quote cannot leak.
create policy managed_quote_events_read on public.managed_quote_events for select to authenticated using (
  exists(select 1 from public.managed_quote_requests r where r.id=request_id)
);

-- This helper accepts an actor only because all mutation entrypoints below are
-- executable exclusively by the trusted server service role.
create or replace function public.managed_quote_actor_allowed(p_actor uuid,p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor and p.is_active and not p.must_change_password)
  and case when p_kind='customer' then exists(
    select 1 from public.user_roles ur join public.customer_profiles cp on cp.profile_id=ur.profile_id
    join auth.users u on u.id=ur.profile_id
    where ur.profile_id=p_actor and ur.role='customer' and ur.revoked_at is null and u.phone_confirmed_at is not null
  ) when p_kind='admin' then exists(
    select 1 from public.admin_users au join public.admin_roles ar on ar.id=au.role_id
    join public.user_roles ur on ur.profile_id=au.profile_id and ur.role='admin' and ur.revoked_at is null
    where au.profile_id=p_actor and au.is_active and (ar.role_key='super_admin' or exists(
      select 1 from public.admin_role_permissions arp join public.admin_permissions ap on ap.id=arp.permission_id
      where arp.role_id=ar.id and ap.permission_key='sourcing.manage'
    ))
  ) else false end
$$;
revoke all on function public.managed_quote_actor_allowed(uuid,text) from public,anon,authenticated;
grant execute on function public.managed_quote_actor_allowed(uuid,text) to service_role;

create or replace function public.managed_quote_notify(p_request uuid,p_actor uuid,p_title text,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.managed_quote_requests%rowtype;
begin
  select * into strict r from public.managed_quote_requests where id=p_request;
  if p_admin then
    insert into public.notifications(profile_id,actor_profile_id,type,title,message,action_url,entity_type,entity_id)
    select au.profile_id,p_actor,'managed_quote.updated',p_title,p_title||' · '||r.request_code,
      '/admin/managed-quotes/'||r.id,'managed_quote',r.id
    from public.admin_users au where public.managed_quote_actor_allowed(au.profile_id,'admin')
      and (r.assigned_admin_id is null or au.profile_id=r.assigned_admin_id);
    -- If an assignee lost permission, return the item to the eligible team.
    if not found and r.assigned_admin_id is not null then
      insert into public.notifications(profile_id,actor_profile_id,type,title,message,action_url,entity_type,entity_id)
      select au.profile_id,p_actor,'managed_quote.updated',p_title,p_title||' · '||r.request_code,
        '/admin/managed-quotes/'||r.id,'managed_quote',r.id
      from public.admin_users au where public.managed_quote_actor_allowed(au.profile_id,'admin');
    end if;
  else
    insert into public.customer_notifications(customer_profile_id,notification_type,title,message,action_url)
    values(r.customer_id,'managed_quote',p_title,p_title||' · '||r.request_code,'/customer/managed-quotes/'||r.id);
  end if;
end
$$;
revoke all on function public.managed_quote_notify(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.managed_quote_notify(uuid,uuid,text,boolean) to service_role;

create or replace function public.managed_quote_submit(p_actor uuid,p_details jsonb,p_items jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.managed_quote_requests%rowtype; item jsonb; q numeric; fingerprint text;
begin
  if not public.managed_quote_actor_allowed(p_actor,'customer') then raise exception 'Verified customer required';end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120
    or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>50000
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50
    or octet_length(p_items::text)>300000 then raise exception 'Invalid managed request';end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(length(item->>'id'),0) not between 1 and 100
      or coalesce(length(item->>'product_id'),0) not between 1 and 80
      or coalesce(length(item->>'product_name'),0) not between 1 and 200
      or coalesce(length(item->>'unit'),0) not between 1 and 80
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or jsonb_typeof(item->'attributes') is distinct from 'array' then raise exception 'Invalid managed item';end if;
    q:=(item->>'quantity')::numeric;
    if q<=0 or q>1000000 or q<>round(q,3) then raise exception 'Invalid item quantity';end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Duplicate item';end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('details',p_details,'items',p_items)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':managed:'||p_idempotency_key,0));
  select * into r from public.managed_quote_requests where customer_id=p_actor and idempotency_key=p_idempotency_key;
  if found then
    if r.request_fingerprint<>fingerprint then raise exception 'Idempotency conflict';end if;
    return r.id;
  end if;
  insert into public.managed_quote_requests(request_code,customer_id,details,items,idempotency_key,request_fingerprint)
  values('BQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),p_actor,p_details,p_items,p_idempotency_key,fingerprint)
  returning * into r;
  insert into public.managed_quote_events(request_id,actor_id,action,revision) values(r.id,p_actor,'submitted',r.revision);
  perform public.managed_quote_notify(r.id,p_actor,'طلب عرض سعر جديد',true);
  return r.id;
end
$$;

create or replace function public.managed_quote_command(p_actor uuid,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.managed_quote_requests%rowtype; item jsonb; line jsonb; result_pricing jsonb:='[]'::jsonb;
  price numeric; duration numeric; unit_label text; sub numeric:=0; delivery numeric; vat numeric; expiry timestamptz; expected timestamptz;
  admin_actor boolean:=public.managed_quote_actor_allowed(p_actor,'admin');
  customer_actor boolean:=public.managed_quote_actor_allowed(p_actor,'customer');
begin
  if not admin_actor and not customer_actor then raise exception 'Not authorized';end if;
  select * into r from public.managed_quote_requests where id=p_request_id for update;
  if not found or (not admin_actor and r.customer_id<>p_actor) then raise exception 'Request unavailable';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>200000 then raise exception 'Invalid action payload';end if;
  if p_action in ('save_quote','publish_quote','accept','reject') and
    (jsonb_typeof(p_payload->'revision') is distinct from 'number' or (p_payload->>'revision')::numeric<>r.revision) then raise exception 'Revision conflict';end if;
  if p_action in ('save_quote','publish_quote') then
    if not admin_actor then raise exception 'Not authorized';end if;
    if r.status not in ('submitted','offered','rejected') then raise exception 'Quote is immutable';end if;
    if jsonb_typeof(p_payload->'pricing') is distinct from 'array' or jsonb_array_length(p_payload->'pricing')<>jsonb_array_length(r.items)
      or (select count(distinct value->>'item_id') from jsonb_array_elements(p_payload->'pricing'))<>jsonb_array_length(r.items) then raise exception 'Price every requested item';end if;
    for item in select value from jsonb_array_elements(r.items) loop
      select value into line from jsonb_array_elements(p_payload->'pricing') where value->>'item_id'=item->>'id';
      if not found or jsonb_typeof(line->'unit_price') is distinct from 'number' or (line->>'offer_type') is null
        or line->>'offer_type' not in ('sale','rental') then raise exception 'Invalid price line';end if;
      price:=(line->>'unit_price')::numeric;
      if price<0 or price>1000000000 or price<>round(price,2) then raise exception 'Invalid unit price';end if;
      unit_label:=coalesce(nullif(btrim(line->>'unit'),''),item->>'unit');
      if coalesce(length(unit_label),0) not between 1 and 80 or unit_label='تحددها الإدارة' then raise exception 'Pricing unit required';end if;
      if item->>'unit'<>'تحددها الإدارة' and unit_label is distinct from item->>'unit' then raise exception 'Requested unit cannot change';end if;
      duration:=null;
      if line->>'offer_type'='rental' then
        if jsonb_typeof(line->'rental_duration_value') is distinct from 'number' then raise exception 'Rental duration required';end if;
        duration:=(line->>'rental_duration_value')::numeric;
        if duration<=0 or duration>10000 or duration<>round(duration,2) or coalesce(line->>'rental_duration_unit','') not in ('hour','day','week','month','year') then raise exception 'Invalid rental duration';end if;
      end if;
      if coalesce(length(btrim(line->>'warranty')),0) not between 1 and 2000
        or coalesce(length(btrim(line->>'delivery_duration')),0) not between 1 and 500
        or length(coalesce(line->>'notes',''))>3000 then raise exception 'Warranty and delivery terms required';end if;
      sub:=sub+round(price*(item->>'quantity')::numeric,2);
      result_pricing:=result_pricing||jsonb_build_array(jsonb_build_object('item_id',item->>'id','unit',unit_label,'unit_price',price,'line_total',round(price*(item->>'quantity')::numeric,2),
        'offer_type',line->>'offer_type','rental_duration_value',duration,'rental_duration_unit',case when duration is not null then line->>'rental_duration_unit' else null end,
        'warranty',btrim(line->>'warranty'),'delivery_duration',btrim(line->>'delivery_duration'),'notes',coalesce(line->>'notes','')));
    end loop;
    if jsonb_typeof(p_payload->'delivery_fee') is distinct from 'number' or jsonb_typeof(p_payload->'vat_rate') is distinct from 'number' then raise exception 'Invalid quote totals';end if;
    delivery:=(p_payload->>'delivery_fee')::numeric;vat:=(p_payload->>'vat_rate')::numeric;
    expiry:=nullif(p_payload->>'valid_until','')::timestamptz;expected:=nullif(p_payload->>'expected_delivery_at','')::timestamptz;
    if delivery<0 or delivery>1000000000 or delivery<>round(delivery,2) or vat<0 or vat>100 or vat<>round(vat,2)
      or expiry is null or expiry<=now() or expiry>now()+interval '365 days' or expected is null or expected<=now()
      or expected>now()+interval '365 days' or coalesce(length(btrim(p_payload->>'terms')),0) not between 1 and 10000 then raise exception 'Invalid quote terms';end if;
    update public.managed_quote_requests set pricing=result_pricing,subtotal=sub,delivery_fee=delivery,vat_rate=vat,
      vat_amount=round((sub+delivery)*vat/100,2),total=sub+delivery+round((sub+delivery)*vat/100,2),valid_until=expiry,expected_delivery_at=expected,
      terms=btrim(p_payload->>'terms'),assigned_admin_id=p_actor,revision=revision+1,
      status=case when p_action='publish_quote' then 'offered' else 'submitted' end,rejected_at=null,updated_at=now()
    where id=r.id returning * into r;
    insert into public.managed_quote_events(request_id,actor_id,action,revision,metadata) values(r.id,p_actor,p_action,r.revision,
      jsonb_build_object('pricing',r.pricing,'subtotal',r.subtotal,'delivery_fee',r.delivery_fee,'vat_rate',r.vat_rate,'total',r.total,'terms',r.terms,'valid_until',r.valid_until,'expected_delivery_at',r.expected_delivery_at));
    if p_action='publish_quote' then perform public.managed_quote_notify(r.id,p_actor,'عرض السعر جاهز',false);end if;
  elsif p_action in ('accept','reject') then
    if not customer_actor or r.customer_id<>p_actor then raise exception 'Not authorized';end if;
    if (p_action='accept' and r.status='accepted') or (p_action='reject' and r.status='rejected') then return to_jsonb(r);end if;
    if r.status<>'offered' or r.valid_until<=now() then raise exception 'Quote expired or already decided';end if;
    update public.managed_quote_requests set status=case when p_action='accept' then 'accepted' else 'rejected' end,
      accepted_at=case when p_action='accept' then now() else null end,rejected_at=case when p_action='reject' then now() else null end,updated_at=now()
    where id=r.id returning * into r;
    insert into public.managed_quote_events(request_id,actor_id,action,revision) values(r.id,p_actor,p_action,r.revision);
    perform public.managed_quote_notify(r.id,p_actor,case when p_action='accept' then 'وافق العميل على عرض السعر' else 'رفض العميل عرض السعر' end,true);
  elsif p_action='cancel' then
    if not admin_actor and (not customer_actor or r.customer_id<>p_actor) then raise exception 'Not authorized';end if;
    if r.status='cancelled' then return to_jsonb(r);end if;
    if r.status not in ('submitted','offered','rejected') then raise exception 'Cannot cancel this quote';end if;
    update public.managed_quote_requests set status='cancelled',updated_at=now() where id=r.id returning * into r;
    insert into public.managed_quote_events(request_id,actor_id,action,revision) values(r.id,p_actor,'cancel',r.revision);
    perform public.managed_quote_notify(r.id,p_actor,'أُلغي طلب عرض السعر',not admin_actor);
  else raise exception 'Unknown managed quote action';end if;
  return to_jsonb(r);
end
$$;

create or replace function public.managed_quote_issue_code(p_actor uuid,p_request_id uuid,p_salt text,p_hash text,p_ciphertext text,p_reissue boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.managed_quote_requests%rowtype; admin_actor boolean:=public.managed_quote_actor_allowed(p_actor,'admin'); expiry timestamptz;
begin
  select * into r from public.managed_quote_requests where id=p_request_id for update;
  if not found or (not admin_actor and (r.customer_id<>p_actor or not public.managed_quote_actor_allowed(p_actor,'customer')))
    or (p_reissue and not admin_actor) then raise exception 'Not authorized';end if;
  if r.status<>'accepted' then raise exception 'Accepted quote required';end if;
  if p_reissue is null then raise exception 'Invalid reissue request';end if;
  if not p_reissue and exists(select 1 from public.managed_quote_delivery_codes where request_id=r.id) then return jsonb_build_object('issued',false);end if;
  if p_salt is null or p_hash is null or p_ciphertext is null then raise exception 'Invalid code material';end if;
  expiry:=least(now()+interval '90 days',greatest(now()+interval '7 days',r.expected_delivery_at+interval '2 days'));
  insert into public.managed_quote_delivery_codes(request_id,code_salt,code_hash,customer_code_ciphertext,expires_at)
  values(r.id,p_salt,p_hash,p_ciphertext,expiry)
  on conflict(request_id) do update set code_salt=excluded.code_salt,code_hash=excluded.code_hash,customer_code_ciphertext=excluded.customer_code_ciphertext,
    expires_at=excluded.expires_at,attempts=0,locked_until=null,verified_at=null,updated_at=now();
  insert into public.managed_quote_events(request_id,actor_id,action,revision) values(r.id,p_actor,case when p_reissue then 'code_reissued' else 'code_issued' end,r.revision);
  if p_reissue then perform public.managed_quote_notify(r.id,p_actor,'تم تجديد رمز التسليم',false);end if;
  return jsonb_build_object('issued',true,'expires_at',expiry);
end
$$;

create or replace function public.managed_quote_confirm_delivery(p_actor uuid,p_request_id uuid,p_plain_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.managed_quote_requests%rowtype; c public.managed_quote_delivery_codes%rowtype; attempts_left integer;
begin
  if not public.managed_quote_actor_allowed(p_actor,'admin') then raise exception 'Not authorized';end if;
  select * into r from public.managed_quote_requests where id=p_request_id for update;
  if not found then raise exception 'Request unavailable';end if;
  if r.status='delivered' then return jsonb_build_object('ok',true,'status','delivered');end if;
  if r.status<>'accepted' then raise exception 'Accepted quote required';end if;
  select * into c from public.managed_quote_delivery_codes where request_id=r.id for update;
  if not found then return jsonb_build_object('ok',false,'status','not_issued');end if;
  if c.expires_at<=now() then return jsonb_build_object('ok',false,'status','expired');end if;
  if c.attempts>=c.max_attempts or c.locked_until>now() then return jsonb_build_object('ok',false,'status','locked','attempts_remaining',0);end if;
  if p_plain_code is null or p_plain_code !~ '^[0-9]{6}$' or encode(extensions.digest(c.code_salt||':'||p_plain_code,'sha256'),'hex')<>c.code_hash then
    update public.managed_quote_delivery_codes set attempts=attempts+1,
      locked_until=case when attempts+1>=max_attempts then now()+interval '15 minutes' else null end,updated_at=now() where request_id=r.id
      returning max_attempts-attempts into attempts_left;
    insert into public.managed_quote_events(request_id,actor_id,action,revision,metadata) values(r.id,p_actor,'code_rejected',r.revision,jsonb_build_object('attempts_remaining',attempts_left));
    return jsonb_build_object('ok',false,'status',case when attempts_left=0 then 'locked' else 'invalid_code' end,'attempts_remaining',attempts_left);
  end if;
  update public.managed_quote_delivery_codes set verified_at=now(),updated_at=now() where request_id=r.id;
  update public.managed_quote_requests set status='delivered',delivered_at=now(),updated_at=now() where id=r.id;
  insert into public.managed_quote_events(request_id,actor_id,action,revision) values(r.id,p_actor,'delivered',r.revision);
  perform public.managed_quote_notify(r.id,p_actor,'تم تأكيد استلام طلبك',false);
  return jsonb_build_object('ok',true,'status','delivered');
end
$$;

revoke all on function public.managed_quote_submit(uuid,jsonb,jsonb,text),public.managed_quote_command(uuid,uuid,text,jsonb),
  public.managed_quote_issue_code(uuid,uuid,text,text,text,boolean),public.managed_quote_confirm_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.managed_quote_submit(uuid,jsonb,jsonb,text),public.managed_quote_command(uuid,uuid,text,jsonb),
  public.managed_quote_issue_code(uuid,uuid,text,text,text,boolean),public.managed_quote_confirm_delivery(uuid,uuid,text) to service_role;
grant execute on function public.canonicalize_rfq_catalog_item(jsonb) to service_role;

-- Retire the old customer submission API; historical draft/accepted records and
-- existing provider fulfillment functions remain untouched.
revoke execute on function public.submit_storefront_rfq(jsonb,jsonb,text),public.submit_customer_rfq(jsonb,jsonb,text) from public,anon,authenticated;

-- Extend the existing snapshot without modifying the previous migration.
alter function public.admin_attention_counts() rename to admin_attention_counts_before_managed_quotes;
revoke all on function public.admin_attention_counts_before_managed_quotes() from public,anon;
grant execute on function public.admin_attention_counts_before_managed_quotes() to authenticated;
create or replace function public.admin_attention_counts()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare counts jsonb; amount bigint;
begin
  counts:=public.admin_attention_counts_before_managed_quotes();
  if public.admin_has_permission('sourcing.manage') then
    select count(*) into amount from public.managed_quote_requests where status in ('submitted','accepted');
  else amount:=null;end if;
  return counts||jsonb_build_object('/admin/managed-quotes',amount);
end
$$;
revoke all on function public.admin_attention_counts() from public,anon;
grant execute on function public.admin_attention_counts() to authenticated;

commit;
