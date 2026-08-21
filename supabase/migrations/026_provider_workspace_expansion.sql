-- Complete the merchant operational workspace: establishment profile, documents,
-- bank account lifecycle, and provider-aware support tickets.

alter table public.provider_profiles
  add column if not exists commercial_registration_number text,
  add column if not exists vat_number text,
  add column if not exists national_address_short_code text,
  add column if not exists building_number text,
  add column if not exists street_name text,
  add column if not exists district text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists secondary_number text,
  add column if not exists country text not null default 'السعودية',
  add column if not exists website_url text;

create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  document_type text not null check (document_type in ('commercial_registration','vat_certificate','national_address','bank_certificate','license','other')),
  document_number text,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  expires_at date,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','expired')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists provider_documents_provider_status_idx on public.provider_documents(provider_id,status,created_at desc);
drop trigger if exists provider_documents_set_updated_at on public.provider_documents;
create trigger provider_documents_set_updated_at before update on public.provider_documents for each row execute function public.set_updated_at();
alter table public.provider_documents enable row level security;
drop policy if exists provider_documents_member_read on public.provider_documents;
create policy provider_documents_member_read on public.provider_documents for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin());
drop policy if exists provider_documents_member_insert on public.provider_documents;
create policy provider_documents_member_insert on public.provider_documents for insert to authenticated
  with check (public.is_provider_member(provider_id) and status='pending_review' and reviewed_by is null);
drop policy if exists provider_documents_member_delete_pending on public.provider_documents;
create policy provider_documents_member_delete_pending on public.provider_documents for delete to authenticated
  using (public.is_provider_member(provider_id) and status in ('pending_review','rejected'));
drop policy if exists provider_documents_admin_manage on public.provider_documents;
create policy provider_documents_admin_manage on public.provider_documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select,insert,delete on public.provider_documents to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('provider-documents','provider-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists provider_documents_storage_read on storage.objects;
create policy provider_documents_storage_read on storage.objects for select to authenticated using (
  bucket_id='provider-documents' and (
    public.is_admin() or exists(select 1 from public.provider_members pm where pm.provider_id::text=(storage.foldername(name))[1] and pm.profile_id=auth.uid() and pm.is_active)
  )
);
drop policy if exists provider_documents_storage_insert on storage.objects;
create policy provider_documents_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='provider-documents' and exists(select 1 from public.provider_members pm where pm.provider_id::text=(storage.foldername(name))[1] and pm.profile_id=auth.uid() and pm.is_active)
);
drop policy if exists provider_documents_storage_delete on storage.objects;
create policy provider_documents_storage_delete on storage.objects for delete to authenticated using (
  bucket_id='provider-documents' and (
    public.is_admin() or exists(select 1 from public.provider_members pm where pm.provider_id::text=(storage.foldername(name))[1] and pm.profile_id=auth.uid() and pm.is_active)
  )
);

alter table public.provider_bank_accounts
  add column if not exists iban_fingerprint text,
  add column if not exists is_active boolean not null default true;
create unique index if not exists provider_bank_accounts_iban_fingerprint_idx on public.provider_bank_accounts(provider_id,iban_fingerprint) where iban_fingerprint is not null;
drop index if exists provider_bank_accounts_one_primary_idx;
create unique index provider_bank_accounts_one_primary_idx on public.provider_bank_accounts(provider_id) where is_primary and is_active;

create or replace function public.create_support_ticket(p_data jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_role text;v_provider_id uuid;
begin
  if auth.uid() is null or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid request'; end if;
  v_role:=p_data->>'requester_role';
  if v_role not in('customer','provider','contractor','driver','admin') or length(btrim(p_data->>'subject'))<3 or length(btrim(p_data->>'description'))<10 then raise exception 'Invalid ticket'; end if;
  if v_role='provider' then
    select pm.provider_id into v_provider_id from public.provider_members pm where pm.profile_id=auth.uid() and pm.is_active order by pm.created_at limit 1;
    if v_provider_id is null then raise exception 'Provider membership is required'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_idempotency_key,0));
  select id into v_id from public.support_tickets where opened_by=auth.uid() and message=p_idempotency_key;
  if found then return v_id; end if;
  insert into public.support_tickets(ticket_code,opened_by,provider_id,subject,category,priority,message,description,requester_role,related_entity_type,related_entity_id,status)
  values('SUP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),auth.uid(),v_provider_id,btrim(p_data->>'subject'),btrim(p_data->>'category'),coalesce(nullif(p_data->>'priority',''),'normal')::public.support_ticket_priority,p_idempotency_key,btrim(p_data->>'description'),v_role,nullif(btrim(p_data->>'related_entity_type'),''),nullif(p_data->>'related_entity_id','')::uuid,'open') returning id into v_id;
  insert into public.support_messages(ticket_id,author_profile_id,body,event_key) values(v_id,auth.uid(),btrim(p_data->>'description'),'ticket-created:'||v_id);
  insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('support_ticket',v_id,'ticket.created',jsonb_build_object('actor_id',auth.uid(),'requester_role',v_role),'ticket-created:'||v_id);
  return v_id;
end$$;
revoke execute on function public.create_support_ticket(jsonb,text) from public,anon;
grant execute on function public.create_support_ticket(jsonb,text) to authenticated;
