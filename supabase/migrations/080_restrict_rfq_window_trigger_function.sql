begin;

-- Trigger execution does not require callers to hold EXECUTE on the trigger
-- function. Prevent authenticated clients from invoking this SECURITY DEFINER
-- maintenance function directly.
revoke execute on function public.set_rfq_customer_window_message()
  from public, anon, authenticated;
grant execute on function public.set_rfq_customer_window_message()
  to service_role;

commit;
