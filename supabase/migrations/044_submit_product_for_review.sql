begin;

create or replace function public.submit_product_for_review(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_product
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if not public.is_provider_member(v_product.provider_id) and not public.is_admin() then
    raise exception 'Product provider membership required';
  end if;

  if v_product.review_status not in ('draft', 'needs_changes') then
    raise exception 'Product cannot be submitted from its current status';
  end if;

  if not exists (
    select 1 from public.product_images image where image.product_id = p_product_id
  ) then
    raise exception 'At least one product image is required';
  end if;

  update public.products
     set review_status = 'pending_review',
         is_published = false,
         updated_at = now()
   where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'review_status', 'pending_review'
  );
end
$$;

revoke execute on function public.submit_product_for_review(uuid)
  from public, anon;
grant execute on function public.submit_product_for_review(uuid)
  to authenticated;

commit;
