begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '021 requires public.is_admin() from migration 001';
  end if;
end
$$;

-- Public catalog RLS policies call is_admin() even for anonymous visitors.
-- Migration 009 revoked this permission from anon, causing public reads to fail.
grant execute on function public.is_admin() to anon;

commit;
