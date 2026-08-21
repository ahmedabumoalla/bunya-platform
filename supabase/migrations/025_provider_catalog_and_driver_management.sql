begin;

do $$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.provider_drivers') is null
    or to_regclass('public.provider_driver_accounts') is null
    or to_regprocedure('public.complete_temporary_password_change()') is null
  then
    raise exception '025 requires the product catalog, driver accounts, and onboarding schema';
  end if;
end
$$;

alter table public.products
  add column if not exists custom_category text;

alter table public.products
  alter column category_id drop not null;

alter table public.products
  add constraint products_category_shape check (
    (category_id is not null and custom_category is null)
    or (
      category_id is null
      and custom_category is not null
      and length(btrim(custom_category)) between 2 and 80
    )
  ) not valid;

alter table public.products validate constraint products_category_shape;

comment on column public.products.custom_category is
  'Provider-entered product category used only when no standard product category applies.';

create or replace function public.complete_temporary_password_change()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now(),
      temporary_password_expires_at = null,
      updated_at = now()
  where id = auth.uid() and must_change_password;

  if not found then
    raise exception 'Password change is not pending';
  end if;

  update public.provider_drivers d
  set must_change_password = false,
      status = 'active',
      updated_at = now()
  from public.provider_driver_accounts a
  where a.driver_id = d.id
    and a.auth_user_id = auth.uid()
    and d.status = 'must_change_password';

  insert into public.audit_logs (
    actor_profile_id, entity_table, entity_id, action, new_data
  ) values (
    auth.uid(), 'profiles', auth.uid(), 'temporary_password_changed', '{}'::jsonb
  );
end
$$;

revoke execute on function public.complete_temporary_password_change()
  from public, anon;
grant execute on function public.complete_temporary_password_change()
  to authenticated;

commit;
