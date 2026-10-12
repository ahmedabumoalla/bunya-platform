begin;
-- Supabase default privileges also grant anon explicitly, independently of PUBLIC.
-- Only authenticated RLS predicates need the membership helper.
revoke all on function public.contractor_chat_member(uuid) from public,anon,service_role;
grant execute on function public.contractor_chat_member(uuid) to authenticated;
revoke all on function public.contractor_safe_label(text,text) from public,anon,authenticated,service_role;
revoke all on function public.contractor_contact_detected(text) from public,anon,service_role;
grant execute on function public.contractor_contact_detected(text) to authenticated;
commit;
