import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const actors=['7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'];
const owner='8b9f3886-e1b8-4816-9fbb-d425b0753255';
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const denied=async(sql,args=[])=>assert.rejects(()=>db.query(sql,args),error=>error.code==='42501');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema private;create schema storage;create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,is_active boolean default true,must_change_password boolean default false);
create table admin_users(profile_id uuid,role_id uuid,is_active boolean);
create table admin_roles(id uuid primary key,role_key text);
create table admin_permissions(id uuid primary key,permission_key text);
create table admin_role_permissions(role_id uuid,permission_id uuid);
create table user_roles(id uuid default gen_random_uuid(),profile_id uuid,role text,revoked_at timestamptz);
create table customer_profiles(profile_id uuid);create table auth.users(id uuid,email text,phone_confirmed_at timestamptz);
create table managed_quote_requests(id uuid primary key,request_code text);
create table private.admin_archive_state(singleton boolean default true,active boolean);insert into private.admin_archive_state(active) values(false);
create function private.admin_directory_restricted() returns boolean language sql stable as $$select false$$;
create function public.admin_has_permission(text) returns boolean language sql stable as $$select exists(select 1 from admin_users where profile_id=auth.uid() and is_active)$$;
create function public.admin_can_impersonate() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create table audit_logs(id uuid default gen_random_uuid(),actor_profile_id uuid,entity_table text,entity_id text,action text,new_data jsonb);
create table invoices(id uuid primary key default gen_random_uuid(),total numeric default 115);
create table invoice_items(id uuid primary key default gen_random_uuid(),invoice_id uuid references invoices(id),description text);
create table files(id uuid default gen_random_uuid(),bucket_id text,purpose text);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);
create table storage.buckets(id text,public boolean);insert into storage.buckets values('invoice-documents',false);
create table notifications(id uuid primary key default gen_random_uuid(),entity_type text,type text,action_url text);
create table notification_deliveries(id uuid default gen_random_uuid(),notification_id uuid references notifications(id));
create table outbox_events(id uuid default gen_random_uuid(),aggregate_type text);
grant usage on schema public,private,auth,storage to authenticated,service_role;
grant all on all tables in schema public,storage to service_role;
insert into auth.users(id,email) values('${actors[0]}','farraamjad@gmail.com'),('${actors[1]}','hakimnaes@gmail.com'),('${owner}','owner@example.test');
insert into profiles(id) select id from auth.users;
insert into admin_roles values('${owner}','super_admin');
insert into admin_users select id,'${owner}',true from profiles;
insert into user_roles(profile_id,role,revoked_at) select id,'admin',null from profiles;
grant select on profiles,admin_users,user_roles to authenticated;`);
const managed=readFileSync('supabase/migrations/097_managed_admin_quotes.sql','utf8');
await db.exec(managed.match(/create or replace function public\.managed_quote_actor_allowed\([\s\S]*?grant execute on function public\.managed_quote_actor_allowed\(uuid,text\) to service_role;/)[0]);
const archive=readFileSync('supabase/migrations/101_admin_frozen_archive.sql','utf8');
for(const name of ['admin_archive_designated','admin_archive_frozen'])await db.exec(archive.match(new RegExp(`create function private\\.${name}\\([\\s\\S]*?\\$\\$;`))[0]);
await db.exec('grant execute on function private.admin_archive_frozen(uuid) to service_role;');
for(const path of ['105_price_quotations','107_price_quotation_invoices','109_price_quotation_inclusive_pricing','110_saved_sales_customers'])await db.exec(readFileSync('supabase/migrations/'+path+'.sql','utf8'));
await db.exec(`update price_invoice_settings set phase='phase1',verified_at=now(),configured_by='${owner}';
insert into invoices(id) values('${owner}');insert into invoice_items(invoice_id,description) values('${owner}','private invoice line');
insert into files(bucket_id,purpose) values('invoice-documents','invoice'),('other','invoice'),('other','ordinary');
insert into storage.objects(bucket_id) values('invoice-documents'),('ordinary');
insert into audit_logs(entity_table,new_data) values('price_invoices','{"total":115}'),('sales_customers','{"customer_number":"CUS-000001"}'),('profiles','{}');
insert into notifications(id,entity_type,type,action_url) values('${owner}','invoice','document','/admin/invoices'),('${actors[0]}','ordinary','notice','https://www.buniahksa.com/admin/price-quotations/123'),('${actors[1]}','ordinary','notice','/admin/orders');
insert into notification_deliveries(notification_id) select id from notifications;
insert into outbox_events(aggregate_type) values('price_invoice'),('ordinary');`);
for(const table of ['invoices','invoice_items','files','audit_logs','notifications','notification_deliveries','outbox_events','storage.objects']){
  await db.exec(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated;create policy fixture_permissive on ${table} for all to authenticated using(true) with check(true);`);
}
const item={product_id:'real',product_name:'Material',unit:'piece',sku:'SKU',quantity:1,unit_price:115,line_total:115,attributes:[],notes:''};
const payload={customer_phone:'+966500000001',customer_name:'Saved client',policy_version:'exclusive-address-sales-v1',items:[item],subtotal:115,delivery_fee:0,vat_rate:15,vat_amount:15,total:115,pricing_basis:'inclusive'};
await db.exec('set role service_role');
const quote=await scalar('select price_quotation_create($1,$2,$3,$4)',[owner,owner,'a'.repeat(64),payload]);
await scalar('select price_quotation_issue_invoice($1,$2,$3,$4)',[owner,quote,'b'.repeat(64),{invoice_type:'simplified',supply_date:'2026-11-09',buyer:{name:'Saved client',phone:'+966500000001',address:'',vat_number:''},items:[item]}]);
await db.exec('reset role');
const snapshot=()=>db.query(`select jsonb_build_object('quotes',(select jsonb_agg(q) from price_quotations q),'invoices',(select jsonb_agg(i) from price_invoices i),'customers',(select jsonb_agg(c) from sales_customers c),'users',(select jsonb_agg(u) from profiles u),'roles',(select jsonb_agg(r) from admin_users r),'archive',(select jsonb_agg(a) from private.admin_archive_state a),'sequence',(select last_value from private.price_invoice_number_seq)) as state`);
const before=(await snapshot()).rows;
const migration=readFileSync('supabase/migrations/111_restrict_designated_sales_documents.sql','utf8');
if(process.env.SALES_DOCUMENT_LIVE_REHEARSAL_FILE){
  await db.exec(readFileSync(process.env.SALES_DOCUMENT_LIVE_REHEARSAL_FILE,'utf8'));
  assert.equal(await scalar("select to_regprocedure('private.sales_documents_restricted(uuid)')"),null,'Exact live rehearsal rolls back migration');
  assert.deepEqual((await snapshot()).rows,before,'Exact live rehearsal preserves snapshots');
}
await db.exec(migration);
for(const actor of actors){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
  for(const table of ['invoices','invoice_items'])assert.equal(await scalar(`select count(*) from ${table}`),0,actor+' '+table);
  assert.equal(await scalar('select count(*) from files'),1);assert.equal(await scalar('select count(*) from storage.objects'),1);
  assert.deepEqual((await db.query('select entity_table from audit_logs')).rows,[{entity_table:'profiles'}]);
  assert.equal(await scalar('select count(*) from notifications'),1);assert.equal(await scalar('select count(*) from notification_deliveries'),1);assert.equal(await scalar('select count(*) from outbox_events'),1);
  assert.equal(await scalar('select count(*) from profiles'),3);assert.equal(await scalar('select count(*) from admin_users where is_active'),3);
  assert.equal((await db.query('update invoices set total=999 returning id')).rows.length,0);
  await denied('insert into invoices(total) values(999)');
  for(const table of ['price_quotations','price_quotation_events','price_invoices','price_invoice_settings','sales_customers'])await denied(`select * from ${table}`);
  await denied('select public.sales_customer_search($1)',[owner]);
  await db.exec('reset role;set role service_role');
  for(const [sql,args] of [
    ['select price_quotation_create($1,null,null,null)',[actor]],
    ['select price_quotation_claim_send($1,null,null)',[actor]],
    ['select price_quotation_finish_send($1,null,null,null,null,null)',[actor]],
    ['select price_quotation_issue_invoice($1,null,null,null)',[actor]],
    ['select sales_customer_save($1,null)',[actor]],
    ['select sales_customer_search($1)',[actor]],
  ])await denied(sql,args);
  assert.equal(await scalar("select public.managed_quote_actor_allowed($1,'admin')",[actor]),true,'Unrelated sourcing authorization remains');
  assert.equal(await scalar('select private.admin_archive_frozen($1)',[actor]),false);
  await db.exec('reset role');
}
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
assert.equal(await scalar('select count(*) from invoices'),1);assert.equal(await scalar('select count(*) from files'),3);assert.equal(await scalar('select count(*) from notifications'),3);
await db.exec('reset role;set role service_role');assert.equal((await scalar('select sales_customer_search($1)',[owner])).count,1);
// An owner idempotent replay still works, without touching sequence/snapshots.
assert.equal(await scalar('select price_quotation_create($1,$2,$3,$4)',[owner,owner,'a'.repeat(64),payload]),quote);
await db.exec('reset role');assert.deepEqual((await snapshot()).rows,before);
// Transaction-local rollback preserves the pre-change function definitions.
const guarded=await scalar("select pg_get_functiondef('public.sales_customer_search(uuid,text,integer,integer)'::regprocedure)");
await db.exec('begin');await db.exec("drop policy sales_document_account_boundary on invoices");await db.exec('rollback');
assert.equal(await scalar("select count(*) from pg_policies where tablename='invoices' and policyname='sales_document_account_boundary'"),1);
assert.equal(await scalar("select pg_get_functiondef('public.sales_customer_search(uuid,text,integer,integer)'::regprocedure)"),guarded);
const evidence={at:new Date().toISOString(),runtime:process.version,migrationSha256:createHash('sha256').update(migration).digest('hex'),checks:['Both fixed IDs denied direct tables, invoice writes, private document RPCs and indirect audit/Storage/notifications','Other active platform membership/sourcing/archive state preserved','Owner reads, search and idempotent quote replay preserved','Financial snapshots and invoice sequence unchanged','Transaction rollback preserves policies and functions']};
writeFileSync('tmp/sales-document-access-sql-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await db.close();
