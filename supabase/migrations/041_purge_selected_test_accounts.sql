begin;

create temp table purge_users(id uuid primary key) on commit drop;
insert into purge_users(id) values
('64be5160-bce1-41c7-a8d7-e76328ccde78'),
('0bc85ba8-85de-4c0d-8289-b3d7728b749c'),
('2a7c7cfa-baa0-47fd-be6b-8431c862599a'),
('7d53e2cd-5ab6-4c5f-b73a-73ddc91e72eb'),
('4ac1753b-4c04-4f84-b7f6-f960db4f3cd7');

do $$
begin
  if exists (
    select 1 from auth.users u join purge_users p on p.id=u.id
    where lower(coalesce(u.email,'')) not in (
      'ceo.alsalem@gmail.com','ceo.gmsdata@gmail.com','ceo.zadi1@gmail.com',
      'cto.branda@gmail.com','seo.tahani1@gmail.com'
    )
  ) then raise exception 'Target user mismatch'; end if;
end $$;

create temp table purge_providers(id uuid primary key) on commit drop;
insert into purge_providers select id from public.providers
where owner_profile_id in(select id from purge_users);

create temp table purge_products(id uuid primary key) on commit drop;
insert into purge_products select id from public.products
where provider_id in(select id from purge_providers);

create temp table purge_requests(id uuid primary key) on commit drop;
insert into purge_requests select id from public.quote_requests
where requester_id in(select id from purge_users) on conflict do nothing;
insert into purge_requests select distinct request_id from public.quote_request_items
where product_id in(select id from purge_products) on conflict do nothing;

create temp table purge_quotes(id uuid primary key) on commit drop;
insert into purge_quotes select id from public.bunya_customer_quotes
where customer_request_id in(select id from purge_requests);

create temp table purge_orders(id uuid primary key) on commit drop;
insert into purge_orders select id from public.orders
where customer_profile_id in(select id from purge_users)
   or customer_quote_id in(select id from purge_quotes);

alter table public.notifications disable trigger user;
delete from public.notifications
where profile_id in(select id from purge_users)
   or actor_profile_id in(select id from purge_users);
alter table public.notifications enable trigger user;

alter table public.audit_logs disable trigger user;
delete from public.audit_logs
where actor_profile_id in(select id from purge_users)
   or (entity_table='products' and entity_id in(select id::text from purge_products))
   or (entity_table='quote_requests' and entity_id in(select id::text from purge_requests))
   or (entity_table='providers' and entity_id in(select id::text from purge_providers))
   or (entity_table='orders' and entity_id in(select id::text from purge_orders));
alter table public.audit_logs enable trigger user;

delete from public.provider_delivery_assignments
where provider_id in(select id from purge_providers)
   or order_id in(select id from purge_orders);

alter table public.financial_transactions disable trigger user;
delete from public.financial_transactions
where provider_id in(select id from purge_providers)
   or order_id in(select id from purge_orders);
alter table public.financial_transactions enable trigger user;

delete from public.internal_fulfillment_orders
where provider_id in(select id from purge_providers)
   or bunya_customer_quote_id in(select id from purge_quotes);

delete from public.selected_provider_items
where provider_id in(select id from purge_providers);

alter table public.payment_records disable trigger user;
delete from public.payment_records where customer_profile_id in(select id from purge_users);
alter table public.payment_records enable trigger user;

alter table public.invoices disable trigger user;
delete from public.invoices where customer_profile_id in(select id from purge_users);
alter table public.invoices enable trigger user;

delete from public.orders where id in(select id from purge_orders);
delete from public.quote_requests where id in(select id from purge_requests);

alter table public.product_review_decisions disable trigger user;
delete from public.product_review_decisions where product_id in(select id from purge_products);
alter table public.product_review_decisions enable trigger user;

alter table public.product_review_history disable trigger user;
delete from public.product_review_history where product_id in(select id from purge_products);
alter table public.product_review_history enable trigger user;

delete from public.products where id in(select id from purge_products);
delete from public.settlement_requests where provider_id in(select id from purge_providers);
delete from public.provider_bank_accounts where provider_id in(select id from purge_providers);
delete from public.providers where id in(select id from purge_providers);

delete from public.join_request_reviews
where request_id in(select id from public.provider_applications where applicant_profile_id in(select id from purge_users))
   or request_id in(select id from public.contractor_applications where applicant_profile_id in(select id from purge_users));

delete from public.account_onboarding_deliveries
where application_id in(select id from public.provider_applications where applicant_profile_id in(select id from purge_users))
   or application_id in(select id from public.contractor_applications where applicant_profile_id in(select id from purge_users));

delete from public.provider_applications
where applicant_profile_id in(select id from purge_users)
   or lower(email) in('ceo.alsalem@gmail.com','ceo.gmsdata@gmail.com','ceo.zadi1@gmail.com','cto.branda@gmail.com','seo.tahani1@gmail.com');
delete from public.contractor_applications
where applicant_profile_id in(select id from purge_users)
   or lower(email) in('ceo.alsalem@gmail.com','ceo.gmsdata@gmail.com','ceo.zadi1@gmail.com','cto.branda@gmail.com','seo.tahani1@gmail.com');

delete from public.support_tickets where opened_by in(select id from purge_users);
delete from public.files where owner_profile_id in(select id from purge_users);
delete from public.push_subscriptions where profile_id in(select id from purge_users);
delete from auth.users where id in(select id from purge_users);

commit;
