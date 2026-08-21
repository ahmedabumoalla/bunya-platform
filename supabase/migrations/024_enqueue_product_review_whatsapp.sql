begin;

create or replace function public.enqueue_product_review_whatsapp()
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

  select company_name
    into v_provider_name
    from public.providers
   where id = new.provider_id;

  insert into public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    'product',
    new.id,
    'admin.product_pending_review',
    jsonb_build_object(
      'provider_id', new.provider_id,
      'provider_name', v_provider_name,
      'product_name', new.name
    ),
    'product-review-whatsapp:' || new.id
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists products_enqueue_review_whatsapp on public.products;
create trigger products_enqueue_review_whatsapp
after insert or update of review_status on public.products
for each row execute function public.enqueue_product_review_whatsapp();

insert into public.outbox_events (
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  idempotency_key
)
select
  'product',
  product.id,
  'admin.product_pending_review',
  jsonb_build_object(
    'provider_id', product.provider_id,
    'provider_name', provider.company_name,
    'product_name', product.name
  ),
  'product-review-whatsapp:' || product.id
from public.products product
left join public.providers provider on provider.id = product.provider_id
where product.review_status = 'pending_review'
on conflict (idempotency_key) where idempotency_key is not null do nothing;

revoke execute on function public.enqueue_product_review_whatsapp() from public, anon, authenticated;

commit;
