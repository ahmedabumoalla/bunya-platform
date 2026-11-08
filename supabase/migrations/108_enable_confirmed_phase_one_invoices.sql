-- Enable existing Phase 1 issuance after the owner's explicit confirmation
-- that the company is currently subject to Phase 1 (2026-11-08).
-- This records the owner's confirmation, not ZATCA clearance/certification.
-- No invoices are issued here. To disable later, use a new audited migration
-- setting phase='unconfigured'; preserve all already-issued invoice snapshots.
begin;
set local lock_timeout='10s';
set local statement_timeout='30s';
do $$
declare
  owner_id constant uuid := '8b9f3886-e1b8-4816-9fbb-d425b0753255';
  previous public.price_invoice_settings;
begin
  select * into previous from public.price_invoice_settings where singleton for update;
  if not found or previous.phase not in ('unconfigured','phase1') then
    raise exception 'Unexpected invoice configuration; refuse to downgrade Phase 2';
  end if;
  if previous.seller->>'name' is distinct from 'شركة العنوان الحصري'
    or previous.seller->>'vat_number' is distinct from '312872746700003'
    or previous.seller->>'commercial_registration' is distinct from '5850157983'
    or coalesce(length(btrim(previous.seller->>'address')),0)=0 then
    raise exception 'Confirmed company identity does not match';
  end if;
  if not exists(select 1 from public.admin_users a
      join public.admin_roles r on r.id=a.role_id
      join public.profiles p on p.id=a.profile_id
      join public.user_roles u on u.profile_id=p.id and u.role='admin' and u.revoked_at is null
      where a.profile_id=owner_id and a.is_active and p.is_active and r.role_key='super_admin') then
    raise exception 'Expected owner administrator is not active';
  end if;
  if previous.phase='phase1' and previous.verified_at is not null and previous.configured_by=owner_id then
    return;
  end if;
  update public.price_invoice_settings
    set phase='phase1',verified_at=statement_timestamp(),configured_by=owner_id
    where singleton;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,old_data,new_data)
  values(owner_id,'price_invoice_settings','true','price_invoice_phase1_enabled',
    jsonb_build_object('phase',previous.phase,'verified_at',previous.verified_at,'configured_by',previous.configured_by),
    jsonb_build_object('phase','phase1','verification_basis','explicit_owner_confirmation',
      'confirmation_date','2026-11-08','authority_clearance_claimed',false,'migration','108'));
end $$;
commit;
