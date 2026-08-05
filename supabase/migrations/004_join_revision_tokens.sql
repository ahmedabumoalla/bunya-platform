begin;
create table public.join_application_revision_tokens(
  id uuid primary key default gen_random_uuid(),application_kind text not null check(application_kind in('provider','contractor')),application_id uuid not null,token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),expires_at timestamptz not null,attempts integer not null default 0 check(attempts between 0 and 10),max_attempts integer not null default 5 check(max_attempts between 1 and 10),used_at timestamptz,created_by uuid not null references public.profiles(id) on delete restrict,created_at timestamptz not null default now(),constraint join_revision_expiry check(expires_at>created_at),unique(application_kind,application_id,token_hash)
);
create index join_revision_active_idx on public.join_application_revision_tokens(token_hash,expires_at) where used_at is null;
alter table public.join_application_revision_tokens enable row level security;
create policy join_revision_admin_read on public.join_application_revision_tokens for select to authenticated using(public.admin_has_permission('reviews.manage'));
revoke all on public.join_application_revision_tokens from public,anon,authenticated;
grant select on public.join_application_revision_tokens to authenticated;
grant all on public.join_application_revision_tokens to service_role;
commit;
