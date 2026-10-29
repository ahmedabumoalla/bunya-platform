import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema private;
create table public.profiles(id uuid primary key,is_active boolean default true,must_change_password boolean default false);
create table public.admin_users(profile_id uuid,role_id uuid,is_active boolean);
create table public.admin_roles(id uuid primary key,role_key text);
create table public.admin_permissions(id uuid primary key,permission_key text);
create table public.admin_role_permissions(role_id uuid,permission_id uuid);
create table public.user_roles(profile_id uuid,role text,revoked_at timestamptz);
create table public.customer_profiles(profile_id uuid);
create table auth.users(id uuid,phone_confirmed_at timestamptz);
create table public.managed_quote_requests(id uuid primary key,request_code text);
create table private.admin_archive_state(active boolean);
insert into private.admin_archive_state values(true);
grant usage on schema public,private to service_role;
grant all on all tables in schema public to service_role;`);
const managed = readFileSync('supabase/migrations/097_managed_admin_quotes.sql', 'utf8');
await db.exec(managed.match(/create or replace function public\.managed_quote_actor_allowed\([\s\S]*?grant execute on function public\.managed_quote_actor_allowed\(uuid,text\) to service_role;/)[0]);
const archive = readFileSync('supabase/migrations/101_admin_frozen_archive.sql', 'utf8');
await db.exec(archive.match(/create function private\.admin_archive_designated\([\s\S]*?\$\$;/)[0]);
await db.exec(archive.match(/create function private\.admin_archive_frozen\([\s\S]*?\$\$;/)[0]);
await db.exec(`grant execute on function private.admin_archive_frozen(uuid) to service_role;
insert into profiles(id,is_active,must_change_password) values('${id(1)}',true,false),('${id(2)}',true,false),('${id(3)}',false,false),('${id(4)}',true,true),('7f4152b6-63d2-49ec-866f-681a3308f670',true,false);
insert into admin_roles values('${id(10)}','super_admin');
insert into admin_users select id,'${id(10)}',true from profiles where id<>'${id(2)}';
insert into user_roles select id,'admin',null from profiles where id<>'${id(2)}';
insert into managed_quote_requests values('${id(20)}','BQ-REAL');`);
await db.exec(readFileSync('supabase/migrations/105_price_quotations.sql', 'utf8'));
const payload = {customer_phone:'+966500000001',policy_version:'exclusive-address-sales-v1',items:[{product_id:'brkz-real',product_name:'Real item',unit:'piece',sku:'SKU',quantity:2.125,unit_price:12.34,line_total:26.22,attributes:[],notes:''}],subtotal:26.22,delivery_fee:10,vat_rate:15,vat_amount:5.43,total:41.65,terms:'Terms'};
const create = (key = 30, actor = id(1), data = payload, fingerprint = 'a'.repeat(64)) => scalar('select public.price_quotation_create($1,$2,$3,$4)',[actor,id(key),fingerprint,data]);
const claim = (quote, token=50, actor=id(1)) => scalar('select public.price_quotation_claim_send($1,$2,$3)',[actor,quote,id(token)]);
const finish = (quote,status='submitted',token=50,provider='provider-id') => scalar('select public.price_quotation_finish_send($1,$2,$3,$4,$5,$6)',[id(1),quote,id(token),status,provider,null]);
let passed=0;
async function test(name, body) { await db.exec('begin;set local role service_role;');try {await body();passed++;console.log(`PASS ${name}`);}finally {await db.exec('rollback');} }
async function rejects(fn, expression=/./) {await db.exec('savepoint rejected');try {await assert.rejects(fn,expression);}finally {await db.exec('rollback to savepoint rejected');}}

await test('private table RLS and RPC privileges deny anon and authenticated mutations/reads',async()=>{
  await db.exec('reset role');
  for(const role of ['anon','authenticated']) {
    for(const table of ['price_quotations','price_quotation_events']) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),true);
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,`public.${table}`,privilege]),false);
    }
    for(const fn of ['price_quotation_create(uuid,uuid,text,jsonb)','price_quotation_claim_send(uuid,uuid,uuid)','price_quotation_finish_send(uuid,uuid,uuid,text,text,text)']) assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,`public.${fn}`,'EXECUTE']),false);
    await db.exec(`set local role ${role}`); await rejects(()=>create(),/permission denied/);await rejects(()=>db.query('select * from public.price_quotations'),/permission denied/); await db.exec('reset role');
  }
});
await test('standalone quote needs only phone, preserves exact totals and is idempotent',async()=>{
  const quote=await create();assert.equal(await create(),quote);
  const row=(await db.query('select * from public.price_quotations where id=$1',[quote])).rows[0];
  assert.equal(row.customer_name,'');assert.equal(row.source_request_id,null);assert.equal(Number(row.total),41.65);assert.match(row.quotation_code,/^QUO-\d{8}-[A-F0-9]{12}$/);
  assert.equal(await scalar('select count(*)::integer from public.price_quotation_events'),1);
  await rejects(()=>create(30,id(1),payload,'b'.repeat(64)),/Idempotency conflict/);
});
await test('linked request code is canonical and original request is unchanged',async()=>{
  const quote=await create(31,id(1),{...payload,source_request_id:id(20),source_request_code:'forged'});
  assert.equal(await scalar('select source_request_code from public.price_quotations where id=$1',[quote]),'BQ-REAL');
  assert.equal(await scalar('select request_code from managed_quote_requests where id=$1',[id(20)]),'BQ-REAL');
  await rejects(()=>create(32,id(1),{...payload,source_request_id:id(99)}),/Source request/);
});
await test('inactive, password-pending, non-admin and frozen actors are rejected',async()=>{
  for(const actor of [id(2),id(3),id(4),'7f4152b6-63d2-49ec-866f-681a3308f670']) await rejects(()=>create(30,actor),/Not authorized/);
});
await test('forged money, malformed item precision and invalid contact are rejected',async()=>{
  for(const data of [{...payload,subtotal:26.23},{...payload,vat_amount:1,total:37.22},{...payload,total:100},{...payload,customer_phone:'+15555555555'},{...payload,items:[]},{...payload,items:[{...payload.items[0],quantity:0}]},{...payload,items:[{...payload.items[0],unit_price:12.345}]}]) await rejects(()=>create(30,id(1),data));
});
await test('atomic send claim, wrong-token completion and successful replay prevention',async()=>{
  const quote=await create();assert.equal(await claim(quote),true);assert.equal(await claim(quote,51),false);
  assert.equal(await finish(quote,'submitted',51),false);assert.equal(await finish(quote),true);assert.equal(await finish(quote),false);assert.equal(await claim(quote,52),false);
  assert.equal(await scalar('select count(*)::integer from price_quotation_events where quotation_id=$1',[quote]),3);
});
await test('known rejection may retry, uncertain submission and stale sending never auto-retry',async()=>{
  const quote=await create();await claim(quote);await finish(quote,'failed',50,null);assert.equal(await claim(quote,51),true);await finish(quote,'uncertain',51,null);assert.equal(await claim(quote,52),false);
  const stale=await create(31);await claim(stale);await db.query("update price_quotations set send_started_at=now()-interval '1 day' where id=$1",[stale]);assert.equal(await claim(stale,52),false);
});
await test('permission revocation and expiry are rechecked at send time',async()=>{
  const quote=await create();await db.query('update profiles set is_active=false where id=$1',[id(1)]);await rejects(()=>claim(quote),/Not authorized/);await db.query('update profiles set is_active=true where id=$1',[id(1)]);
  const expired=await create(31,id(1),{...payload,valid_until:'2020-01-01T00:00:00Z'});assert.equal(await claim(expired),false);
});
await db.close();console.log(`Price quotation SQL: ${passed} groups passed.`);
