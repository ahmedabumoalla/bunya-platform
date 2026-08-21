begin;

create or replace function public.protect_notification_payload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or current_setting('bunya.internal_notification_write', true) = 'on'
     or public.admin_has_permission('operations.manage')
     or public.admin_has_permission('projects.manage') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'UPDATE'
     or (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Notification recipients may only change read_at';
  end if;
  return new;
end;
$$;

create or replace function public.notify_admins_product_pending_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_name text;
begin
  if new.review_status <> 'pending_review' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.review_status = new.review_status then
    return new;
  end if;

  select company_name into v_provider_name
  from public.providers
  where id = new.provider_id;

  perform set_config('bunya.internal_notification_write', 'on', true);
  insert into public.notifications (
    profile_id,
    actor_profile_id,
    type,
    title,
    message,
    action_url,
    entity_type,
    entity_id,
    metadata
  )
  select
    admin_user.profile_id,
    auth.uid(),
    'admin.product_pending_review',
    'منتج جديد بانتظار المراجعة',
    format('أضافت منشأة %s المنتج «%s» وأرسلته للمراجعة.', coalesce(v_provider_name, 'مزود'), new.name),
    '/admin/products/review/' || new.id,
    'product',
    new.id,
    jsonb_build_object('provider_id', new.provider_id, 'provider_name', v_provider_name, 'product_name', new.name)
  from public.admin_users admin_user
  where admin_user.is_active;
  perform set_config('bunya.internal_notification_write', 'off', true);

  return new;
end;
$$;

revoke execute on function public.notify_admins_product_pending_review() from public, anon, authenticated;

commit;
