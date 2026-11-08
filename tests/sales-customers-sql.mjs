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
// Exercise the forward migration against already persisted legacy snapshots.
await configure();const historicalQuote=await quote(98);const historicalInvoice=await issue(historicalQuote);
const historicalBefore=(await db.query('select to_jsonb(q) as quote,to_jsonb(i) as invoice from price_quotations q join price_invoices i on i.quotation_id=q.id where q.id=$1',[historicalQuote])).rows[0];
await db.exec('reset role');
await db.exec(readFileSync('supabase/migrations/109_price_quotation_inclusive_pricing.sql','utf8'));
const historicalAfter=(await db.query('select to_jsonb(q) as quote,to_jsonb(i) as invoice from price_quotations q join price_invoices i on i.quotation_id=q.id where q.id=$1',[historicalQuote])).rows[0];
for(const kind of ['quote','invoice']){assert.equal(historicalAfter[kind].pricing_basis,'exclusive');delete historicalAfter[kind].pricing_basis;assert.deepEqual(historicalAfter[kind],historicalBefore[kind]);}

const oldCustomer=await quote(97,{...quoteData,customer_phone:'+966500000002',customer_name:'Earlier name',customer_address:'Original address'});
await db.query("update price_quotations set created_at='2025-01-01' where id=$1",[oldCustomer]);
await quote(96,{...quoteData,customer_phone:'+966500000002',customer_name:'Latest name',customer_address:'',customer_tax_number:'300000000000003'});
const invoiceBefore110=(await db.query('select to_jsonb(i) as snapshot from price_invoices i where id=$1',[historicalInvoice])).rows[0].snapshot;
const quotesBefore110=(await db.query('select id,to_jsonb(q) as snapshot from price_quotations q order by id')).rows;
await db.exec(readFileSync('supabase/migrations/110_saved_sales_customers.sql','utf8'));
const savedContacts=(await db.query('select * from sales_customers order by customer_number')).rows;
assert.equal(savedContacts.length,2);
assert.equal(savedContacts[0].phone,'+966500000002');assert.equal(savedContacts[0].customer_number,'CUS-000001');
assert.equal(savedContacts[0].name,'Latest name');assert.equal(savedContacts[0].address,'Original address');assert.equal(savedContacts[0].tax_number,'300000000000003');
for(const prior of quotesBefore110){const after=(await db.query('select to_jsonb(q) as snapshot from price_quotations q where id=$1',[prior.id])).rows[0].snapshot;assert.ok(after.customer_id);assert.match(after.customer_number,/^CUS-[0-9]{6,}$/);delete after.customer_id;delete after.customer_number;assert.deepEqual(after,prior.snapshot,'Only customer metadata may change in historical quotation');}
const invoiceAfter110=(await db.query('select to_jsonb(i) as snapshot from price_invoices i where id=$1',[historicalInvoice])).rows[0].snapshot;
assert.equal(invoiceAfter110.customer_id,null);assert.equal(invoiceAfter110.customer_number,null);delete invoiceAfter110.customer_id;delete invoiceAfter110.customer_number;assert.deepEqual(invoiceAfter110,invoiceBefore110,'Issued financial snapshot is not rewritten');
let passed=1;console.log('PASS 110 backfill has deterministic customer numbers/latest nonblank details and preserves historical financial snapshots');
async function test(name,body){await db.exec('begin;set local role service_role;');try{await body();passed++;console.log(`PASS ${name}`);}finally{await db.exec('rollback');}}
async function rejects(body,pattern=/./){await db.exec('savepoint rejection');try{await assert.rejects(body,pattern);}finally{await db.exec('rollback to savepoint rejection');}}
const save=(data,actor=id(1),selected=null)=>scalar('select sales_customer_save($1,$2,$3)',[actor,data,selected]);
const search=(query='',actor=id(1),limit=20,offset=0)=>scalar('select sales_customer_search($1,$2,$3,$4)',[actor,query,limit,offset]);
const contact={phone:'0500000003',name:'Customer three',address:'Riyadh',tax_number:'300000000000003'};
await test('private customers deny client reads/writes/RPCs and unauthorized/frozen actors',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('reset role;set local role '+role);await rejects(()=>db.query('select * from sales_customers'),/permission denied/);await rejects(()=>save(contact),/permission denied/);await rejects(()=>search(),/permission denied/);await db.exec('reset role;set local role service_role');}
 await rejects(()=>save(contact,id(2)),/Not authorized/);await rejects(()=>search('',id(2)),/Not authorized/);
 await rejects(()=>save(contact,'7f4152b6-63d2-49ec-866f-681a3308f670'),/Not authorized/);
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='sales_customers'::regclass"),true);
});
await test('normalized phone reuses stable number and blank optional fields preserve saved details',async()=>{
 const key=await save(contact);const first=(await db.query('select * from sales_customers where id=$1',[key])).rows[0];
 assert.equal(first.phone,'+966500000003');assert.match(first.customer_number,/^CUS-[0-9]{6,}$/);
 const before=Number(await scalar("select count(*) from audit_logs where entity_table='sales_customers'"));
 assert.equal(await save({phone:'+966 50 000 0003',name:'',address:'',tax_number:''},id(1),key),key);
 assert.deepEqual((await db.query('select * from sales_customers where id=$1',[key])).rows[0],first);
 assert.equal(Number(await scalar("select count(*) from audit_logs where entity_table='sales_customers'")),before);
 assert.equal(await save({...contact,name:'Renamed'}),key);const second=(await db.query('select * from sales_customers where id=$1',[key])).rows[0];assert.equal(second.name,'Renamed');assert.equal(second.customer_number,first.customer_number);
 await rejects(()=>save({...contact,phone:'0500000004'},id(1),key),/does not match/);
 await rejects(()=>db.query("update sales_customers set phone='+966500000004' where id=$1",[key]),/permission denied/);
 await rejects(()=>db.query("update sales_customers set customer_number='CUS-999999' where id=$1",[key]),/permission denied/);
 for(const patch of [{phone:'x'},{name:5},{address:'x'.repeat(401)},{tax_number:'bad'},{phone:null},{address:'Bad'+String.fromCharCode(1)}])await rejects(()=>save({...contact,...patch}),/Invalid customer/);
 const multiline='First line'+String.fromCharCode(10)+'Second line'+String.fromCharCode(9)+'part';
 assert.equal(await save({...contact,address:multiline}),key);assert.equal((await db.query('select address from sales_customers where id=$1',[key])).rows[0].address,multiline,'Existing quotation address whitespace remains supported');
});
await test('bounded literal search matches name/mobile/code/tax, paginates and exposes no actor identifiers',async()=>{
 const key=await save(contact);const row=(await db.query('select * from sales_customers where id=$1',[key])).rows[0];
 for(const term of ['customer THREE','0500000003','+966500000003',row.customer_number,'300000000000003']){const result=await search(term);assert.ok(result.customers.some(c=>c.id===key));assert.ok(result.count>=1);assert.ok(result.customers.every(c=>!('created_by'in c)&&!('updated_by'in c)));}
 assert.equal((await search("%,phone.eq.+966500000003")).count,0,'Query punctuation is literal, never a filter language');
 const page=await search('',id(1),1,0),next=await search('',id(1),1,1);assert.equal(page.customers.length,1);assert.equal(page.count,next.count);assert.notEqual(page.customers[0].id,next.customers[0].id);
 for(const [q,l,o] of [['x'.repeat(101),20,0],['',51,0],['',20,-1]])await rejects(()=>search(q,id(1),l,o),/Invalid customer search/);
});
await test('quote/contact creation is atomic, replay stable, selected-ID mismatch refused and both money bases preserved',async()=>{
 const q=await quote(70,{...quoteData,customer_phone:'+966500000003',customer_name:contact.name,customer_address:contact.address});
 const row=(await db.query('select * from price_quotations where id=$1',[q])).rows[0];assert.ok(row.customer_id);assert.match(row.customer_number,/^CUS-/);assert.equal(Number(row.total),41.65);
 const before=await scalar('select count(*) from sales_customers');assert.equal(await quote(70,{...quoteData,customer_phone:'+966500000003',customer_name:contact.name,customer_address:contact.address}),q);assert.equal(await scalar('select count(*) from sales_customers'),before);
 const q2=await quote(71,{...quoteData,customer_id:row.customer_id,customer_phone:'+966500000003',pricing_basis:'inclusive',vat_amount:4.72,total:36.22});const second=(await db.query('select * from price_quotations where id=$1',[q2])).rows[0];assert.equal(second.customer_id,row.customer_id);assert.equal(second.customer_number,row.customer_number);assert.equal(Number(second.total),36.22);
 await rejects(()=>quote(72,{...quoteData,customer_id:row.customer_id,customer_phone:'+966500000004'}),/does not match/);
 await rejects(()=>quote(73,{...quoteData,customer_phone:'+966500000005',customer_name:'Atomic failure',policy_version:null}),/null value/);
 assert.equal(Number(await scalar("select count(*) from sales_customers where phone='+966500000005'")),0,'Failed quotation must not leave a contact');
});
await test('invoice snapshots actual buyer contact, preserves quote details and handles anonymous cash buyer',async()=>{
 await configure();const q=await quote(80,{...quoteData,customer_name:'Original quote client'});
 const same=await issue(q);const original=(await db.query('select * from price_invoices where id=$1',[same])).rows[0];assert.ok(original.customer_id);assert.equal(original.customer_number,(await db.query('select customer_number from price_quotations where id=$1',[q])).rows[0].customer_number);
 const snapshot=JSON.stringify(original);await save({phone:input.buyer.phone,name:'Later contact edit'});assert.equal(JSON.stringify((await db.query('select * from price_invoices where id=$1',[same])).rows[0]),snapshot);
 const otherQuote=await quote(81);const other=await issue(otherQuote,{...input,buyer:{...input.buyer,phone:'+966500000006',name:'Other buyer'}});const otherRow=(await db.query('select * from price_invoices where id=$1',[other])).rows[0];assert.notEqual(otherRow.customer_id,original.customer_id);assert.equal((await db.query('select phone from sales_customers where id=$1',[otherRow.customer_id])).rows[0].phone,'+966500000006');
 const cashQuote=await quote(82);const cash=await issue(cashQuote,{...input,invoice_type:'simplified',buyer:{name:'Cash buyer',phone:'',address:'',vat_number:''}});const cashRow=(await db.query('select * from price_invoices where id=$1',[cash])).rows[0];assert.equal(cashRow.customer_id,null);assert.equal(cashRow.customer_number,null);
 await db.exec('reset role');await rejects(()=>db.query("update price_invoices set customer_number='CUS-999999' where id=$1",[same]),/immutable/);
});
await db.close();console.log(`Sales customers SQL PASS: ${passed} groups.`);
