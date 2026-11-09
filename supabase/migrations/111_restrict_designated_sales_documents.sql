begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Immutable account IDs keep this boundary independent of editable email/roles.
-- Ordinary platform permissions and live/archive state are deliberately preserved.
do $$ begin
  if (select count(*) from auth.users where (id,lower(email)) in (
    ('7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'farraamjad@gmail.com'),
    ('d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid,'hakimnaes@gmail.com')))<>2 then
    raise exception 'Designated sales-document identities do not match';
  end if;
end $$;

create function private.sales_documents_restricted(p_actor uuid)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(p_actor in (
    '7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,
    'd5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid),false)
$$;
revoke all on function private.sales_documents_restricted(uuid) from public,anon;
grant execute on function private.sales_documents_restricted(uuid) to authenticated,service_role;

create function private.sales_document_entity(p_entity text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(lower(p_entity)=any(array[
    'price_quotation','price_quotations','price_quotation_event','price_quotation_events',
    'price_invoice','price_invoices','price_invoice_settings','sales_customer','sales_customers',
    'invoice','invoices','invoice_item','invoice_items']),false)
$$;
revoke all on function private.sales_document_entity(text) from public,anon;
grant execute on function private.sales_document_entity(text) to authenticated,service_role;

-- Client grants stay revoked for new sales documents. Restrictive policies also
-- protect these relations if another migration ever adds a permissive policy.
do $$ declare relation text; signature regprocedure; definition text;
  old_guard constant text := 'if not public.managed_quote_actor_allowed(p_actor,''admin'')';
  new_guard constant text := 'if private.sales_documents_restricted(p_actor) or not public.managed_quote_actor_allowed(p_actor,''admin'')';
begin
  foreach relation in array array['price_quotations','price_quotation_events','price_invoices','price_invoice_settings','sales_customers','invoices','invoice_items'] loop
    execute format('create policy sales_document_account_boundary on public.%I as restrictive for all to authenticated using (not (select private.sales_documents_restricted(auth.uid()))) with check (not (select private.sales_documents_restricted(auth.uid())))',relation);
  end loop;
  -- Keep complete existing function bodies, grants, signatures and financial
  -- validations. Fail closed on unexpected source instead of silently skipping.
  foreach signature in array array[
    'public.price_quotation_create(uuid,uuid,text,jsonb)'::regprocedure,
    'public.price_quotation_claim_send(uuid,uuid,uuid)'::regprocedure,
    'public.price_quotation_finish_send(uuid,uuid,uuid,text,text,text)'::regprocedure,
    'public.price_quotation_issue_invoice(uuid,uuid,text,jsonb)'::regprocedure,
    'public.sales_customer_save(uuid,jsonb,uuid)'::regprocedure,
    'public.sales_customer_search(uuid,text,integer,integer)'::regprocedure] loop
    definition:=pg_get_functiondef(signature);
    if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then
      raise exception 'Unexpected authorization guard in %',signature;
    end if;
    execute replace(definition,old_guard,new_guard);
  end loop;
end $$;

-- Audit payloads include invoice numbers/totals. Preserve all unrelated audit.
create policy sales_document_audit_boundary on public.audit_logs
as restrictive for all to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or not private.sales_document_entity(entity_table))
with check (not (select private.sales_documents_restricted(auth.uid())) or not private.sales_document_entity(entity_table));

-- Generated sales PDFs are streamed by authenticated server routes. The legacy
-- private invoice bucket and registry must also deny listing/signing/downloading.
create policy sales_document_files_boundary on public.files
as restrictive for all to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or (bucket_id<>'invoice-documents' and not private.sales_document_entity(purpose)))
with check (not (select private.sales_documents_restricted(auth.uid())) or (bucket_id<>'invoice-documents' and not private.sales_document_entity(purpose)));
create policy sales_document_storage_boundary on storage.objects
as restrictive for all to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or bucket_id<>'invoice-documents')
with check (not (select private.sales_documents_restricted(auth.uid())) or bucket_id<>'invoice-documents');

-- Do not suppress unrelated notifications. These filters also cover direct
-- PostgREST/Realtime reads, independent of client navigation visibility.
create policy sales_document_notification_boundary on public.notifications
as restrictive for all to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or (
  not private.sales_document_entity(entity_type) and not private.sales_document_entity(type)
  and coalesce(action_url,'') !~* '(^|/)(price-quotations|invoices)(/|\?|$)'))
with check (not (select private.sales_documents_restricted(auth.uid())) or (
  not private.sales_document_entity(entity_type) and not private.sales_document_entity(type)
  and coalesce(action_url,'') !~* '(^|/)(price-quotations|invoices)(/|\?|$)'));
create policy sales_document_delivery_boundary on public.notification_deliveries
as restrictive for select to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or notification_id is null
  or exists(select 1 from public.notifications n where n.id=notification_id));
create policy sales_document_outbox_boundary on public.outbox_events
as restrictive for all to authenticated
using (not (select private.sales_documents_restricted(auth.uid())) or not private.sales_document_entity(aggregate_type))
with check (not (select private.sales_documents_restricted(auth.uid())) or not private.sales_document_entity(aggregate_type));

notify pgrst,'reload schema';
commit;
