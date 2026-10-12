begin;

-- One snapshot for the administration shell. INVOKER retains every table's RLS;
-- permission checks also prevent exposing an unrelated department's counters.
create or replace function public.admin_attention_counts()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_counts jsonb:='{}'::jsonb; v_routes text[]; v_item record; v_count bigint;
 v_reviews boolean:=public.admin_has_permission('reviews.manage');
 v_operations boolean:=public.admin_has_permission('operations.manage');
 v_sourcing boolean:=public.admin_has_permission('sourcing.manage');
 v_orders boolean:=public.admin_has_permission('orders.manage');
 v_deliveries boolean:=public.admin_has_permission('deliveries.manage');
 v_projects boolean:=public.admin_has_permission('projects.manage');
 v_finance boolean:=public.admin_has_permission('finance.manage');
begin
 if auth.uid() is null or not public.is_admin() or not exists(
   select 1 from public.profiles where id=auth.uid() and is_active and not must_change_password
 ) then raise exception 'Not authorized';end if;

 for v_item in select * from (values
  ('/admin',null),('/admin/conversations','projects.manage'),
  ('/admin/operations','operations.manage'),('/admin/alerts','operations.manage'),
  ('/admin/users','profiles.read'),('/admin/join-requests/providers','reviews.manage'),('/admin/join-requests/contractors','reviews.manage'),
  ('/admin/drivers','deliveries.manage'),('/admin/admins','admins.manage'),
  ('/admin/catalog','sourcing.manage'),('/admin/products/review','reviews.manage'),('/admin/products/changes','reviews.manage'),('/admin/pricing','sourcing.manage'),('/admin/sourcing','sourcing.manage'),('/admin/bunya-quotes','sourcing.manage'),
  ('/admin/quote-requests','orders.manage'),('/admin/orders','orders.manage'),('/admin/deliveries','deliveries.manage'),('/admin/delivery-monitoring','deliveries.manage'),('/admin/delivery-codes','deliveries.manage'),
  ('/admin/contractor-services','reviews.manage'),('/admin/contractor-portfolio','reviews.manage'),('/admin/project-requests','projects.manage'),('/admin/contractor-opportunities','projects.manage'),
  ('/admin/contractor-proposals','projects.manage'),('/admin/contractor-projects','projects.manage'),('/admin/project-comments','reviews.manage'),('/admin/contractor-documents','reviews.manage'),('/admin/reviews','reviews.manage'),
  ('/admin/finance','finance.manage'),('/admin/settlements/providers','finance.manage'),('/admin/settlements/contractors','finance.manage'),('/admin/invoices','finance.manage'),
  ('/admin/notifications',null),('/admin/support','support.manage'),('/admin/policies','policies.manage'),('/admin/audit','audit.read'),('/admin/settings','settings.manage')
 ) as destinations(href,permission) loop
   v_counts:=v_counts||jsonb_build_object(v_item.href,case when v_item.permission is null or public.admin_has_permission(v_item.permission) then 0 else null end);
 end loop;
 select array_agg(key) into v_routes from jsonb_object_keys(v_counts) as keys(key);

 -- Sections without an action queue use new, unexpired notifications for THIS admin.
 -- Longest path wins: e.g. a product review notification never increments /admin.
 for v_item in
  select route.href,count(*) as total
  from public.notifications n
  cross join lateral (select split_part(split_part(regexp_replace(coalesce(n.action_url,''),'^https://(www[.])?buniahksa[.]com/','/'),'?',1),'#',1) as path) url
  cross join lateral (select href from unnest(v_routes) as routes(href) where url.path=href or starts_with(url.path,href||'/') order by length(href) desc limit 1) route
  where n.profile_id=auth.uid() and n.read_at is null and (n.expires_at is null or n.expires_at>now())
  group by route.href
 loop
   if v_counts->v_item.href<>'null'::jsonb then v_counts:=v_counts||jsonb_build_object(v_item.href,v_item.total);end if;
 end loop;
 select count(*) into v_count from public.notifications where profile_id=auth.uid() and read_at is null and (expires_at is null or expires_at>now());
 v_counts:=v_counts||jsonb_build_object('/admin/notifications',v_count);

 -- Queue counts replace their notification count, so the same event is not counted twice.
 if v_reviews then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/join-requests/providers',(select count(*) from public.provider_applications where status='pending'),
    '/admin/join-requests/contractors',(select count(*) from public.contractor_applications where status='pending'),
    '/admin/products/review',(select count(*) from public.products where review_status='pending_review'),
    '/admin/products/changes',(select count(*) from public.product_change_requests where status='pending'),
    '/admin/contractor-services',(select count(*) from public.contractor_services where review_status='pending_review' and deleted_at is null),
    '/admin/contractor-portfolio',(select count(*) from public.contractor_portfolio_items where review_status='pending_review' and deleted_at is null),
    '/admin/project-comments',(select count(*) from public.contractor_project_comments where status='pending_admin_review'),
    '/admin/contractor-documents',(select count(*) from public.contractor_documents where status='pending_review' and is_current)
   );
 end if;
 if v_operations then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/operations',(select count(*) from public.outbox_events where status in('failed','dead_letter')),
    '/admin/alerts',(select count(*) from public.admin_alerts where status in('open','in_progress','reopened','blocked','failed'))
   );
 end if;
 if v_sourcing then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/pricing',(select count(*) from public.provider_product_prices where freshness_status in('expired','needs_confirmation')),
    '/admin/sourcing',(select count(*) from public.internal_sourcing_requests where stage in('received','comparing_prices','verifying_availability','verifying_delivery','building_quote')),
    '/admin/bunya-quotes',(select count(*) from public.bunya_customer_quotes where status in('preparing','ready'))
   );
 end if;
 if v_orders then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/quote-requests',(select count(*) from public.quote_requests where status in('submitted','sourcing','verifying')),
    '/admin/orders',(select count(*) from public.orders where status='confirmed')
   );
 end if;
 if v_deliveries then
   select count(*) into v_count from public.provider_delivery_assignments where status='failed_delivery' or (expected_at<now() and status<>'delivered');
   v_counts:=v_counts||jsonb_build_object('/admin/deliveries',v_count,'/admin/delivery-monitoring',v_count);
 end if;
 if v_projects then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/project-requests',(select count(*) from public.project_requests where lifecycle_status='pending_admin_review'),
    '/admin/contractor-projects',(select count(*) from public.contractor_projects where status in('paused','delayed')),
    '/admin/conversations',(select count(*) from public.contractor_conversations c where c.status='disputed'
      or exists(select 1 from public.contractor_chat_messages m where m.conversation_id=c.id and m.moderation in('pending','blocked') and m.reviewed_at is null)
      or (v_finance and exists(select 1 from public.contractor_chat_transfers t where t.conversation_id=c.id and t.status='pending')))
   );
 end if;
 if v_finance then
   v_counts:=v_counts||jsonb_build_object(
    '/admin/settlements/providers',(select count(*) from public.settlement_requests where status in('pending_review','approved','transferring')),
    '/admin/settlements/contractors',(select count(*) from public.contractor_settlement_requests where workflow_status in('requested','under_review','approved','processing'))
   );
   -- Bank claims live in Conversations, whose decision requires both project and finance access.
   v_counts:=v_counts||jsonb_build_object('/admin/finance',(v_counts->>'/admin/settlements/providers')::bigint+(v_counts->>'/admin/settlements/contractors')::bigint);
 end if;
 if public.admin_has_permission('support.manage') then
   v_counts:=v_counts||jsonb_build_object('/admin/support',(select count(*) from public.support_tickets where status in('open','in_progress')));
 end if;
 return v_counts;
end $$;
revoke all on function public.admin_attention_counts() from public,anon,authenticated,service_role;
grant execute on function public.admin_attention_counts() to authenticated;

commit;
