begin;

-- Reconcile installations that recorded either the original 002 forward migration
-- or the temporary compatibility-only variant. No object is recreated here.
do $$
declare
  v_missing text;
begin
  select string_agg(required_object, ', ' order by required_object)
    into v_missing
  from (values
    ('table public.account_onboarding_deliveries', to_regclass('public.account_onboarding_deliveries') is not null),
    ('column profiles.must_change_password', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='must_change_password')),
    ('column profiles.temporary_password_issued_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='temporary_password_issued_at')),
    ('column profiles.temporary_password_expires_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='temporary_password_expires_at')),
    ('column profiles.password_changed_at', exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='password_changed_at')),
    ('function finalize_provider_application_approval', to_regprocedure('public.finalize_provider_application_approval(uuid,uuid,uuid,text)') is not null),
    ('function finalize_contractor_application_approval', to_regprocedure('public.finalize_contractor_application_approval(uuid,uuid,uuid,text)') is not null),
    ('function mark_onboarding_credentials_delivery', to_regprocedure('public.mark_onboarding_credentials_delivery(text,uuid,text,text,text,text,text)') is not null),
    ('function complete_temporary_password_change', to_regprocedure('public.complete_temporary_password_change()') is not null)
  ) as required(required_object, present)
  where not present;

  if v_missing is not null then
    raise exception '010 onboarding history reconciliation failed; missing required schema: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='account_onboarding_deliveries' and c.relrowsecurity
  ) then
    raise exception '010 onboarding history reconciliation failed; RLS is not enabled';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where p.oid in (
      'public.finalize_provider_application_approval(uuid,uuid,uuid,text)'::regprocedure,
      'public.finalize_contractor_application_approval(uuid,uuid,uuid,text)'::regprocedure,
      'public.mark_onboarding_credentials_delivery(text,uuid,text,text,text,text,text)'::regprocedure
    )
      and privilege.grantee=0
      and privilege.privilege_type='EXECUTE'
  ) then
    raise exception '010 onboarding history reconciliation failed; privileged provisioning RPC is executable by PUBLIC';
  end if;

  if exists(select 1 from storage.buckets where id='join-applications' and public) then
    raise exception '010 onboarding history reconciliation failed; join-applications bucket must be private';
  end if;
end
$$;

commit;
