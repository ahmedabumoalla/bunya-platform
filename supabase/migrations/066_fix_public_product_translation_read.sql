-- Anonymous catalog readers must not evaluate provider-only membership helpers.
drop policy if exists product_translations_public_read on public.product_translations;

create policy product_translations_public_read
on public.product_translations for select to anon, authenticated
using (
  exists (
    select 1 from public.products p
    where p.id=product_id and p.is_published
  )
);

create policy product_translations_owner_read
on public.product_translations for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.products p
    where p.id=product_id and public.is_provider_member(p.provider_id)
  )
);
