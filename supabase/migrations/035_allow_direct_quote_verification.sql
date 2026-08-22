begin;

create or replace function public.validate_quote_request_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('submitted','cancelled')) or
    (old.status = 'submitted' and new.status in ('sourcing','verifying','rejected','cancelled')) or
    (old.status = 'sourcing' and new.status in ('verifying','expired','cancelled')) or
    (old.status = 'verifying' and new.status in ('quote_ready','rejected','expired','cancelled')) or
    (old.status = 'quote_ready' and new.status in ('customer_review','accepted','rejected','expired','cancelled')) or
    (old.status = 'customer_review' and new.status in ('accepted','rejected','expired','cancelled'))
  ) then raise exception 'Invalid quote request status transition: % -> %', old.status, new.status; end if;
  return new;
end;
$$;

commit;
