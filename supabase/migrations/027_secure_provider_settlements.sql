-- Provider finance must be writable only through validated server/RPC paths.

alter table public.settlement_requests add column if not exists idempotency_key text;
create unique index if not exists settlement_requests_provider_idempotency_idx
  on public.settlement_requests(provider_id,idempotency_key) where idempotency_key is not null;

drop policy if exists bank_accounts_provider_manage on public.provider_bank_accounts;
drop policy if exists provider_bank_accounts_member_read on public.provider_bank_accounts;
create policy provider_bank_accounts_member_read on public.provider_bank_accounts for select to authenticated
  using (public.is_provider_member(provider_id) or public.is_admin());
drop policy if exists provider_bank_accounts_admin_manage on public.provider_bank_accounts;
create policy provider_bank_accounts_admin_manage on public.provider_bank_accounts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke insert,update,delete on public.provider_bank_accounts from authenticated;
grant select on public.provider_bank_accounts to authenticated;

drop policy if exists settlements_provider_insert on public.settlement_requests;
revoke insert on public.settlement_requests from authenticated;

create or replace function public.request_provider_settlement(p_amount numeric,p_bank uuid,p_notes text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_provider uuid;v_balance numeric:=0;v_reserved numeric:=0;v_id uuid;
begin
  if auth.uid() is null or p_amount<=0 or length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid settlement request';end if;
  select pm.provider_id into v_provider from public.provider_members pm where pm.profile_id=auth.uid() and pm.is_active order by pm.created_at limit 1;
  if v_provider is null then raise exception 'Provider membership required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_provider::text||':provider-settlement',0));
  select id into v_id from public.settlement_requests where provider_id=v_provider and idempotency_key=p_idempotency_key;
  if found then return v_id;end if;
  if not exists(select 1 from public.provider_bank_accounts b where b.id=p_bank and b.provider_id=v_provider and b.is_active and b.is_verified) then raise exception 'Verified bank account required';end if;
  select coalesce(t.balance_after,0) into v_balance from public.financial_transactions t where t.provider_id=v_provider order by t.created_at desc,t.id desc limit 1;
  select coalesce(sum(s.amount),0) into v_reserved from public.settlement_requests s where s.provider_id=v_provider and s.status in('pending_review','approved','transferring');
  if p_amount>greatest(0,v_balance-v_reserved) then raise exception 'Insufficient available balance';end if;
  insert into public.settlement_requests(settlement_code,provider_id,bank_account_id,amount,notes,status,idempotency_key)
  values('PST-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),v_provider,p_bank,p_amount,nullif(btrim(p_notes),''),'pending_review',p_idempotency_key) returning id into v_id;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data) values(auth.uid(),'settlement_requests',v_id::text,'provider_settlement_requested',jsonb_build_object('provider_id',v_provider,'amount',p_amount));
  return v_id;
end$$;
revoke execute on function public.request_provider_settlement(numeric,uuid,text,text) from public,anon;
grant execute on function public.request_provider_settlement(numeric,uuid,text,text) to authenticated;
