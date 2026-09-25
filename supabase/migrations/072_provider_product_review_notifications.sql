begin;

-- Product-review decisions must appear in the provider's in-app inbox in the
-- same transaction as the decision. WhatsApp and native push remain handled
-- by the retryable outbox dispatcher using the same event key.
create or replace function public.notify_provider_product_review_in_app()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_product_name text := coalesce(nullif(btrim(new.payload ->> 'product_name'), ''), 'المنتج');
  v_reason text := coalesce(nullif(btrim(new.payload ->> 'reason'), ''), '—');
  v_title text;
  v_message text;
begin
  if new.event_type not in (
    'provider.product_approved',
    'provider.product_rejected',
    'provider.product_needs_changes'
  ) then
    return new;
  end if;

  select provider.owner_profile_id
    into v_owner
    from public.providers provider
   where provider.id::text = new.payload ->> 'provider_id';

  if v_owner is null then
    return new;
  end if;

  if new.event_type = 'provider.product_approved' then
    v_title := 'تم اعتماد منتجك';
    v_message := format('تم اعتماد المنتج «%s» ونشره في منصة بُنية. ملاحظة المراجعة: %s', v_product_name, v_reason);
  elsif new.event_type = 'provider.product_rejected' then
    v_title := 'تم رفض المنتج';
    v_message := format('تم رفض المنتج «%s». ملاحظة المراجعة: %s', v_product_name, v_reason);
  else
    v_title := 'المنتج يحتاج تعديلات';
    v_message := format('يحتاج المنتج «%s» إلى تعديلات قبل اعتماده. ملاحظة المراجعة: %s', v_product_name, v_reason);
  end if;

  perform set_config('bunya.internal_notification_write', 'on', true);
  insert into public.notifications (
    profile_id,
    type,
    title,
    message,
    action_url,
    entity_type,
    entity_id,
    metadata,
    event_key
  ) values (
    v_owner,
    new.event_type,
    v_title,
    v_message,
    '/merchant/products',
    'product',
    new.aggregate_id,
    jsonb_build_object(
      'provider_id', new.payload ->> 'provider_id',
      'product_name', v_product_name,
      'reason', v_reason,
      'decision', new.event_type
    ),
    'outbox-' || new.id || '-' || v_owner
  ) on conflict (event_key) where event_key is not null do nothing;
  perform set_config('bunya.internal_notification_write', 'off', true);

  return new;
end;
$$;

revoke all on function public.notify_provider_product_review_in_app()
  from public, anon, authenticated;

drop trigger if exists outbox_provider_product_review_in_app_notification
  on public.outbox_events;
create trigger outbox_provider_product_review_in_app_notification
after insert on public.outbox_events
for each row
when (new.event_type in (
  'provider.product_approved',
  'provider.product_rejected',
  'provider.product_needs_changes'
))
execute function public.notify_provider_product_review_in_app();

-- Repair product decisions that are still waiting in the outbox, including
-- the approval that exposed this gap. The stable event key prevents duplicates.
do $$
begin
  perform set_config('bunya.internal_notification_write', 'on', true);

  insert into public.notifications (
    profile_id,
    type,
    title,
    message,
    action_url,
    entity_type,
    entity_id,
    metadata,
    event_key
  )
  select
    provider.owner_profile_id,
    event.event_type,
    case event.event_type
      when 'provider.product_approved' then 'تم اعتماد منتجك'
      when 'provider.product_rejected' then 'تم رفض المنتج'
      else 'المنتج يحتاج تعديلات'
    end,
    case event.event_type
      when 'provider.product_approved' then format(
        'تم اعتماد المنتج «%s» ونشره في منصة بُنية. ملاحظة المراجعة: %s',
        coalesce(nullif(btrim(event.payload ->> 'product_name'), ''), 'المنتج'),
        coalesce(nullif(btrim(event.payload ->> 'reason'), ''), '—')
      )
      when 'provider.product_rejected' then format(
        'تم رفض المنتج «%s». ملاحظة المراجعة: %s',
        coalesce(nullif(btrim(event.payload ->> 'product_name'), ''), 'المنتج'),
        coalesce(nullif(btrim(event.payload ->> 'reason'), ''), '—')
      )
      else format(
        'يحتاج المنتج «%s» إلى تعديلات قبل اعتماده. ملاحظة المراجعة: %s',
        coalesce(nullif(btrim(event.payload ->> 'product_name'), ''), 'المنتج'),
        coalesce(nullif(btrim(event.payload ->> 'reason'), ''), '—')
      )
    end,
    '/merchant/products',
    'product',
    event.aggregate_id,
    jsonb_build_object(
      'provider_id', event.payload ->> 'provider_id',
      'product_name', event.payload ->> 'product_name',
      'reason', event.payload ->> 'reason',
      'decision', event.event_type
    ),
    'outbox-' || event.id || '-' || provider.owner_profile_id
  from public.outbox_events event
  join public.providers provider
    on provider.id::text = event.payload ->> 'provider_id'
  where event.event_type in (
      'provider.product_approved',
      'provider.product_rejected',
      'provider.product_needs_changes'
    )
    and event.status in ('pending', 'processing', 'failed')
  on conflict (event_key) where event_key is not null do nothing;

  perform set_config('bunya.internal_notification_write', 'off', true);
end;
$$;

commit;
