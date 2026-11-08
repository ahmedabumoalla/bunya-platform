import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema private;
create table profiles(id uuid primary key,is_active boolean default true,must_change_password boolean default false);
create table admin_users(profile_id uuid,role_id uuid,is_active boolean);
create table admin_roles(id uuid primary key,role_key text);
create table admin_permissions(id uuid primary key,permission_key text);
create table admin_role_permissions(role_id uuid,permission_id uuid);
create table user_roles(profile_id uuid,role text,revoked_at timestamptz);
create table customer_profiles(profile_id uuid);create table auth.users(id uuid,phone_confirmed_at timestamptz);
create table managed_quote_requests(id uuid primary key,request_code text);
create table private.admin_archive_state(active boolean);insert into private.admin_archive_state values(true);
create table audit_logs(actor_profile_id uuid,entity_table text,entity_id text,action text,new_data jsonb);
grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;`);
const managed=readFileSync('supabase/migrations/097_managed_admin_quotes.sql','utf8');
await db.exec(managed.match(/create or replace function public\.managed_quote_actor_allowed\([\s\S]*?grant execute on function public\.managed_quote_actor_allowed\(uuid,text\) to service_role;/)[0]);
const archive=readFileSync('supabase/migrations/101_admin_frozen_archive.sql','utf8');
for(const name of ['admin_archive_designated','admin_archive_frozen'])await db.exec(archive.match(new RegExp(`create function private\\.${name}\\([\\s\\S]*?\\$\\$;`))[0]);
await db.exec(`grant execute on function private.admin_archive_frozen(uuid) to service_role;
insert into profiles(id) values('${id(1)}'),('${id(2)}'),('${id(3)}'),('7f4152b6-63d2-49ec-866f-681a3308f670');
insert into admin_roles values('${id(10)}','super_admin'),('${id(11)}','sourcing');
insert into admin_users select id,'${id(10)}',true from profiles where id<>'${id(2)}';
update admin_users set role_id='${id(11)}' where profile_id='${id(3)}';
insert into user_roles select id,'admin',null from profiles where id<>'${id(2)}';
insert into admin_permissions values('${id(12)}','sourcing.manage');insert into admin_role_permissions values('${id(11)}','${id(12)}');`);
await db.exec(readFileSync('supabase/migrations/105_price_quotations.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/107_price_quotation_invoices.sql','utf8'));
const items=[{product_id:'brkz-real',product_name:'مواد بناء',unit:'قطعة',sku:'SKU',quantity:2.125,unit_price:12.34,line_total:26.22,attributes:[],notes:''}];
const quoteData={customer_phone:'+966500000001',policy_version:'exclusive-address-sales-v1',items,subtotal:26.22,delivery_fee:10,vat_rate:15,vat_amount:5.43,total:41.65};
const input={invoice_type:'standard',supply_date:'2026-11-08',buyer:{name:'مؤسسة العميل',phone:'+966500000001',address:'الرياض، حي المروج',vat_number:'300000000000003'},items};
const quote=async(key=20,data=quoteData)=>scalar('select price_quotation_create($1,$2,$3,$4)',[id(1),id(key),'a'.repeat(64),data]);
const issue=(q,data=input,actor=id(1),fingerprint='b'.repeat(64))=>scalar('select price_quotation_issue_invoice($1,$2,$3,$4)',[actor,q,fingerprint,data]);
const configure=async()=>{await db.exec(`reset role;update price_invoice_settings set phase='phase1',verified_at=now(),configured_by='${id(1)}' where singleton;set local role service_role;`);};
let passed=0;
async function test(name,body){await db.exec('begin;set local role service_role;');try{await body();passed++;console.log(`PASS ${name}`);}finally{await db.exec('rollback');}}
async function rejects(body,pattern=/./){await db.exec('savepoint rejection');try{await assert.rejects(body,pattern);}finally{await db.exec('rollback to savepoint rejection');}}
await test('unconfigured and Phase2 cannot issue; trusted role cannot alter company setup',async()=>{
 const q=await quote();await rejects(()=>issue(q),/Verified Phase 1/);
 await rejects(()=>db.exec("update price_invoice_settings set phase='phase1' where singleton"),/permission denied/);
 await db.exec("reset role;update price_invoice_settings set phase='phase2' where singleton;set local role service_role");await rejects(()=>issue(q),/Verified Phase 1/);
 assert.equal(await scalar('select count(*)::int from price_invoices'),0);
});
await test('standard invoice has exact saved totals, canonical source and stable replay result',async()=>{
 await configure();const q=await quote();const invoice=await issue(q);assert.equal(await issue(q),invoice);
 const row=(await db.query('select * from price_invoices where id=$1',[invoice])).rows[0];
 assert.match(row.invoice_number,/^INV-\d{8}-\d{6,}$/);assert.equal(Number(row.total),41.65);assert.equal(Number(row.vat_amount),5.43);assert.deepEqual(row.items,items);assert.equal(row.buyer.vat_number,input.buyer.vat_number);
 assert.equal(await scalar('select count(*)::int from audit_logs'),1);
 await rejects(()=>issue(q,input,id(1),'c'.repeat(64)),/different data/);
 await db.exec("reset role;update price_invoice_settings set seller=jsonb_set(seller,'{name}','\"Changed seller\"') where singleton;set local role service_role");
 assert.equal(await scalar("select seller->>'name' from price_invoices where id=$1",[invoice]),'شركة العنوان الحصري');
});
await test('simplified consumer invoice and presented brand fields preserve financial amounts',async()=>{
 await configure();const q=await quote();const data={...input,invoice_type:'simplified',buyer:{name:'',phone:'',address:'',vat_number:''},items:[{...items[0],product_name:'مواد',attributes:[]}]};
 const invoice=await issue(q,data);assert.equal(await scalar("select invoice_type from price_invoices where id=$1",[invoice]),'simplified');
 assert.equal(await scalar("select items->0->>'product_name' from price_invoices where id=$1",[invoice]),'مواد');
});
await test('invoice access, immutability, non-admin, frozen and missing finance permission gates',async()=>{
 await configure();const q=await quote();
 for(const actor of [id(2),id(3),'7f4152b6-63d2-49ec-866f-681a3308f670'])await rejects(()=>issue(q,input,actor),/Not authorized/);
 const invoice=await issue(q);
 for(const statement of ["update price_invoices set total=0",'delete from price_invoices','truncate price_invoices'])await rejects(()=>db.exec(statement),/permission denied/);
 await db.exec('reset role');await rejects(()=>db.query('update price_invoices set total=total where id=$1',[invoice]),/immutable/);
 for(const role of ['anon','authenticated']){await db.exec(`set local role ${role}`);await rejects(()=>issue(q),/permission denied/);await rejects(()=>db.exec('select * from price_invoices'),/permission denied/);await rejects(()=>db.exec('select * from price_invoice_settings'),/permission denied/);await db.exec('reset role');}
});
await test('invalid buyer, missing supply date, forged line totals and unsupported VAT fail',async()=>{
 await configure();const q=await quote();
 for(const data of [{...input,buyer:{...input.buyer,vat_number:''}},{...input,buyer:{...input.buyer,address:''}},{...input,supply_date:''},{...input,supply_date:'2026-02-30'},{...input,invoice_type:'simplified'},{...input,items:[{...items[0],quantity:1}]}])await rejects(()=>issue(q,data));
 const zero=await quote(21,{...quoteData,vat_rate:0,vat_amount:0,total:36.22});await rejects(()=>issue(zero),/standard-rate/);
 assert.equal(await scalar('select count(*)::int from price_invoices'),0);
});
await db.close();console.log(`Price invoice SQL PASS: ${passed} groups.`);
