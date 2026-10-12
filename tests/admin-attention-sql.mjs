import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const migration=readFileSync('supabase/migrations/096_admin_attention_counts.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const counts=async()=> (await query('select public.admin_attention_counts() as counts'))[0].counts;
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,is_active boolean default true,must_change_password boolean default false,admin boolean default false);
create table permissions(profile_id uuid,key text);
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and admin and is_active)$$;
create function public.admin_has_permission(text) returns boolean language sql stable security definer set search_path='' as $$select public.is_admin() and exists(select 1 from public.permissions where profile_id=auth.uid() and key in('*',$1))$$;
insert into profiles values('${id(1)}',true,false,true),('${id(2)}',true,false,true),('${id(3)}',true,false,false);
insert into permissions values('${id(1)}','*'),('${id(2)}','reviews.manage');
grant usage on schema public,auth to authenticated;grant select on profiles to authenticated;`);
const tables={
 notifications:'profile_id uuid,action_url text,read_at timestamptz,expires_at timestamptz',
 provider_applications:'status text',contractor_applications:'status text',products:'review_status text',product_change_requests:'status text',
 contractor_services:'review_status text,deleted_at timestamptz',contractor_portfolio_items:'review_status text,deleted_at timestamptz',contractor_project_comments:'status text',contractor_documents:'status text,is_current boolean',
 outbox_events:'status text',admin_alerts:'status text',provider_product_prices:'freshness_status text',internal_sourcing_requests:'stage text',bunya_customer_quotes:'status text',
 quote_requests:'status text',orders:'status text',provider_delivery_assignments:'status text,expected_at timestamptz',project_requests:'lifecycle_status text',contractor_projects:'status text',
 contractor_conversations:'id uuid,status text',contractor_chat_messages:'conversation_id uuid,moderation text,reviewed_at timestamptz',contractor_chat_transfers:'conversation_id uuid,status text',
 settlement_requests:'status text',contractor_settlement_requests:'workflow_status text',support_tickets:'status text',
};
for(const [table,columns] of Object.entries(tables))await db.exec(`create table public.${table}(${columns},visible boolean default true);alter table public.${table} enable row level security;create policy fixture_read on public.${table} for select to authenticated using(public.is_admin() and visible);grant select on public.${table} to authenticated;`);
await db.exec(migration);
await db.exec(`insert into provider_applications(status) values('pending'),('approved'),('needs_changes');insert into provider_applications(status,visible) values('pending',false);
insert into contractor_applications(status) values('pending');insert into products(review_status) values('pending_review'),('approved');insert into product_change_requests(status) values('pending'),('approved');
insert into contractor_services(review_status,deleted_at) values('pending_review',null),('pending_review',now());insert into contractor_portfolio_items(review_status) values('pending_review');
insert into contractor_documents(status,is_current) values('pending_review',true),('pending_review',false);insert into contractor_project_comments(status) values('pending_admin_review'),('approved');
insert into outbox_events(status) values('failed'),('dead_letter'),('sent');insert into admin_alerts(status) values('open'),('reopened'),('resolved');
insert into provider_product_prices(freshness_status) values('expired'),('needs_confirmation'),('fresh');insert into internal_sourcing_requests(stage) values('received'),('sent_to_customer');insert into bunya_customer_quotes(status) values('preparing'),('customer_review');
insert into quote_requests(status) values('submitted'),('sourcing'),('draft');insert into orders(status) values('confirmed'),('completed');
insert into provider_delivery_assignments(status,expected_at) values('in_transit',now()-interval '1 hour'),('failed_delivery',null),('delivered',now()-interval '1 hour'),('in_transit',now()+interval '1 hour');
insert into project_requests(lifecycle_status) values('pending_admin_review'),('receiving_proposals');insert into contractor_projects(status) values('delayed'),('completed');
insert into settlement_requests(status) values('pending_review'),('approved'),('paid');insert into contractor_settlement_requests(workflow_status) values('processing'),('paid');insert into support_tickets(status) values('open'),('in_progress'),('closed');
insert into contractor_conversations(id,status) values('${id(10)}','open'),('${id(11)}','disputed'),('${id(12)}','completed');
insert into contractor_chat_messages(conversation_id,moderation) values('${id(10)}','pending'),('${id(10)}','blocked'),('${id(12)}','released');insert into contractor_chat_transfers(conversation_id,status) values('${id(10)}','pending');
insert into notifications(profile_id,action_url,read_at,expires_at) values('${id(1)}','/admin/users/abc?tab=profile',null,null),('${id(1)}','https://www.buniahksa.com/admin/catalog?id=x',null,null),('${id(1)}','/admin/products/review/abc',null,null),('${id(1)}','https://evil.invalid/admin/users',null,null),('${id(2)}','/admin/users',null,null),('${id(1)}','/admin/users',now(),null),('${id(1)}','/admin/users',null,now()-interval '1 minute');`);
const actor=async n=>{await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id(n)}',false)`);};
await actor(1);let result=await counts();
const expected={'/admin/join-requests/providers':1,'/admin/join-requests/contractors':1,'/admin/products/review':1,'/admin/products/changes':1,'/admin/contractor-services':1,'/admin/contractor-portfolio':1,'/admin/contractor-documents':1,'/admin/project-comments':1,'/admin/operations':2,'/admin/alerts':2,'/admin/pricing':2,'/admin/sourcing':1,'/admin/bunya-quotes':1,'/admin/quote-requests':2,'/admin/orders':1,'/admin/deliveries':2,'/admin/delivery-monitoring':2,'/admin/project-requests':1,'/admin/contractor-projects':1,'/admin/conversations':2,'/admin/settlements/providers':2,'/admin/settlements/contractors':1,'/admin/finance':3,'/admin/support':2,'/admin/notifications':4,'/admin/users':1,'/admin/catalog':1,'/admin':0};
for(const [route,count] of Object.entries(expected))assert.equal(result[route],count,route);
const navPaths=[...readFileSync('src/lib/admin/navigation.ts','utf8').matchAll(/"(\/admin[^"]*)"/g)].map(m=>m[1]);assert.deepEqual(Object.keys(result).sort(),navPaths.sort(),'all sidebar entries covered');
await actor(2);result=await counts();assert.equal(result['/admin/join-requests/providers'],1);assert.equal(result['/admin/finance'],null);assert.equal(result['/admin/conversations'],null);assert.equal(result['/admin/users'],null);assert.equal(result['/admin/notifications'],1);
await actor(3);await assert.rejects(counts,/Not authorized/);
await db.exec(`reset role;update profiles set must_change_password=true where id='${id(1)}'`);await actor(1);await assert.rejects(counts,/Not authorized/);
await db.exec('reset role;set role anon');await assert.rejects(counts,/permission denied/);
await db.exec(`reset role;update profiles set must_change_password=false where id='${id(1)}';update provider_applications set status='approved';update notifications set read_at=now() where profile_id='${id(1)}';update contractor_chat_messages set moderation='rejected',reviewed_at=now();update contractor_chat_transfers set status='confirmed';update contractor_conversations set status='completed';`);
await actor(1);result=await counts();assert.equal(result['/admin/join-requests/providers'],0);assert.equal(result['/admin/notifications'],0);assert.equal(result['/admin/conversations'],0);
assert.equal((await query("select prosecdef from pg_proc where proname='admin_attention_counts'"))[0].prosecdef,false);
await db.close();console.log('PASS admin attention SQL: all 38 destinations, actual queue states, distinct threads, RLS, departmental permissions, own unexpired notifications/longest path, no double count, authorization and clearing after resolution. Isolated fixtures only.');
