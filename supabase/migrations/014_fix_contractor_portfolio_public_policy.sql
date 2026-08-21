begin;

drop policy if exists contractor_portfolio_public_read on public.contractor_portfolio_items;
create policy contractor_portfolio_public_read
on public.contractor_portfolio_items
for select
to anon, authenticated
using (
  deleted_at is null
  and (
    (
      is_visible
      and review_status = 'approved'
      and is_approved
      and exists (
        select 1
        from public.contractor_profiles profile
        where profile.id = contractor_portfolio_items.profile_id
          and profile.approval_status = 'approved'
          and profile.subscription_active
          and profile.directory_visible
      )
    )
    or public.is_contractor_owner(contractor_portfolio_items.profile_id)
    or public.is_admin()
  )
);

commit;
