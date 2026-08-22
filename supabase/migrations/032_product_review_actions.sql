begin;

do $$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.product_review_decisions') is null
    or to_regclass('public.outbox_events') is null
    or to_regprocedure('public.admin_has_permission(text)') is null
  then
    raise exception '032 requires the product review and notification schema';
  end if;
end
$$;

alter table public.product_review_decisions
  add column if not exists idempotency_key text;

create unique index if not exists product_review_decisions_idempotency_idx
  on public.product_review_decisions(idempotency_key)
  where idempotency_key is not null;

create or replace function public.review_product(
  p_product_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_admin_user_id uuid;
  v_decision public.product_review_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.product_review_decisions%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or not public.admin_has_permission('reviews.manage') then
    raise exception 'Product review permission required';
  end if;

  if p_decision not in ('approved', 'rejected', 'needs_changes') then
    raise exception 'Invalid product review decision';
  end if;

  if length(v_reason) < 3
    or (p_decision in ('rejected', 'needs_changes') and length(v_reason) < 5)
  then
    raise exception 'A clear review reason is required';
  end if;

  if length(coalesce(p_idempotency_key, '')) not between 8 and 120 then
    raise exception 'Invalid idempotency key';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':product-review:' || p_idempotency_key, 0)
  );

  select *
    into v_existing
    from public.product_review_decisions
   where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'product_id', v_existing.product_id,
      'review_status', v_existing.outcome,
      'replayed', true
    );
  end if;

  select id
    into v_admin_user_id
    from public.admin_users
   where profile_id = auth.uid()
     and is_active
   limit 1;

  if v_admin_user_id is null then
    raise exception 'Active admin account required';
  end if;

  select *
    into v_product
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if v_product.review_status <> 'pending_review' then
    raise exception 'Only products pending review can be decided';
  end if;

  v_decision := p_decision::public.product_review_status;
  v_before := to_jsonb(v_product);

  update public.products
     set review_status = v_decision,
         is_published = (v_decision = 'approved'),
         updated_at = now()
   where id = p_product_id
   returning to_jsonb(products) into v_after;

  insert into public.product_review_decisions (
    product_id,
    admin_user_id,
    outcome,
    reason,
    before_data,
    after_data,
    idempotency_key
  ) values (
    p_product_id,
    v_admin_user_id,
    v_decision,
    v_reason,
    v_before,
    v_after,
    p_idempotency_key
  );

  insert into public.audit_logs (
    actor_profile_id,
    provider_id,
    entity_table,
    entity_id,
    action,
    old_data,
    new_data
  ) values (
    auth.uid(),
    v_product.provider_id,
    'products',
    p_product_id::text,
    'product_review_' || p_decision,
    v_before,
    jsonb_build_object('review_status', v_decision, 'reason', v_reason)
  );

  insert into public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  ) values (
    'product',
    p_product_id,
    'provider.product_' || p_decision,
    jsonb_build_object(
      'provider_id', v_product.provider_id,
      'product_name', v_product.name,
      'reason', v_reason
    ),
    'product-review-decision:' || p_product_id || ':' || p_idempotency_key
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'product_id', p_product_id,
    'review_status', v_decision,
    'is_published', (v_decision = 'approved'),
    'replayed', false
  );
end
$$;

revoke execute on function public.review_product(uuid, text, text, text)
  from public, anon;
grant execute on function public.review_product(uuid, text, text, text)
  to authenticated;

commit;
