import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.query || ''); process.exit(1); });

const db = new PGlite();
const base = readFileSync('supabase/migrations/001_bunya_production_schema.sql','utf8').replace(/\r\n/g,'\n');
const migration = readFileSync('supabase/migrations/097_managed_admin_quotes.sql','utf8');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const actor = async (number,role='service_role') => db.exec(`reset role; set local role ${role}; select set_config('request.jwt.claim.sub','${number?id(number):''}',true);`);
async function reject(body,expression=/./) { await db.exec('savepoint invalid'); try { await assert.rejects(body,expression); } finally { await db.exec('rollback to savepoint invalid'); } }
let passed = 0;
async function test(name,body) { await db.exec('begin'); try { await actor(0); await body(); passed++; console.log(`PASS ${name}`); } finally { await db.exec('rollback'); } }

// Identity services and unrelated old entrypoints are fixtures. The whole new
// migration, real permission helper and notification shapes execute in Postgres.
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function extensions.digest(text,text) returns bytea language sql immutable as $$select case when $2='sha256' then sha256(convert_to($1,'UTF8')) end$$;
create table auth.users(id uuid primary key,phone_confirmed_at timestamptz);
create table public.profiles(id uuid primary key,is_active boolean default true,must_change_password boolean default false);
create table public.customer_profiles(profile_id uuid primary key references profiles);
create table public.user_roles(profile_id uuid references profiles,role text,revoked_at timestamptz);
create table public.admin_roles(id uuid primary key,role_key text);
create table public.admin_permissions(id uuid primary key,permission_key text);
create table public.admin_role_permissions(role_id uuid,permission_id uuid);
create table public.admin_users(id uuid primary key,profile_id uuid unique,role_id uuid,is_active boolean default true);
create function public.submit_storefront_rfq(jsonb,jsonb,text) returns uuid language sql as $$select gen_random_uuid()$$;
create function public.submit_customer_rfq(jsonb,jsonb,text) returns uuid language sql as $$select gen_random_uuid()$$;
create function public.canonicalize_rfq_catalog_item(jsonb) returns jsonb language sql as $$select $1$$;
revoke all on function public.canonicalize_rfq_catalog_item(jsonb) from public,anon,authenticated;
grant execute on function public.submit_storefront_rfq(jsonb,jsonb,text),public.submit_customer_rfq(jsonb,jsonb,text) to authenticated;
`);
await db.exec(base.match(/create or replace function public\.admin_has_permission\([\s\S]*?\$\$;/)[0]);
for (const table of ['notifications','customer_notifications']) await db.exec(base.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`))[0]);
await db.exec(`create function public.admin_attention_counts() returns jsonb language plpgsql stable security invoker as $$begin if not public.admin_has_permission('sourcing.manage') then raise exception 'Not authorized';end if;return jsonb_build_object('existing',4);end$$;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant select on auth.users to service_role;
insert into profiles(id,is_active,must_change_password) values('${id(1)}',true,false),('${id(2)}',true,false),('${id(3)}',true,false),('${id(4)}',true,false),('${id(5)}',false,false),('${id(6)}',true,true),('${id(7)}',true,false),('${id(10)}',true,false),('${id(11)}',true,false),('${id(12)}',true,false);
insert into auth.users values('${id(1)}',now()),('${id(2)}',now()),('${id(5)}',now()),('${id(6)}',now()),('${id(7)}',null);
insert into customer_profiles values('${id(1)}'),('${id(2)}'),('${id(5)}'),('${id(6)}'),('${id(7)}');
insert into user_roles(profile_id,role) values('${id(1)}','customer'),('${id(2)}','customer'),('${id(3)}','provider'),('${id(4)}','driver'),('${id(5)}','customer'),('${id(6)}','customer'),('${id(7)}','customer'),('${id(10)}','admin'),('${id(11)}','admin'),('${id(12)}','admin');
insert into admin_roles values('${id(101)}','operations_admin'),('${id(102)}','support_admin'),('${id(103)}','super_admin');
insert into admin_permissions values('${id(201)}','sourcing.manage');insert into admin_role_permissions values('${id(101)}','${id(201)}');
insert into admin_users(id,profile_id,role_id) values('${id(301)}','${id(10)}','${id(101)}'),('${id(302)}','${id(11)}','${id(102)}'),('${id(303)}','${id(12)}','${id(103)}');`);
await db.exec(migration);

const details = { recipientName:'Customer', locationHint:'Site', mapsUrl:'https://maps.google.com/maps', desiredReceiptAt:new Date(Date.now()+86400000).toISOString() };
const items = [
  { id:'line-1',product_id:'brkz-64a8073e1e7c2530eb9b4016',product_name:'Rebar',category:'Steel',quantity:2.5,unit:'ton',sku:'A-1',attributes:[{label:'Size',value:'10mm'}],image_url:'/catalog/images/real.webp',notes:'' },
  { id:'line-2',product_id:'brkz-6501de79381ab8221f6a5623',product_name:'Block',category:'Blocks',quantity:3,unit:'piece',sku:'B-1',attributes:[],image_url:'/catalog/images/real2.webp',notes:'' },
];
let key=0;
const submit = (customer=1,payloadItems=items,token=`managed-key-${++key}`) => scalar('select public.managed_quote_submit($1,$2,$3,$4)',[id(customer),details,payloadItems,token]);
const command = (request,action,payload={},who=10) => scalar('select public.managed_quote_command($1,$2,$3,$4)',[id(who),request,action,payload]);
const pricing = revision => ({revision,pricing:items.map((item,index)=>({item_id:item.id,unit_price:index?5:12.34,offer_type:index?'rental':'sale',rental_duration_value:index?3:null,rental_duration_unit:index?'day':null,warranty:'12 months',delivery_duration:'2 days',notes:''})),delivery_fee:10,vat_rate:15,valid_until:new Date(Date.now()+86400000).toISOString(),expected_delivery_at:new Date(Date.now()+172800000).toISOString(),terms:'Customer acceptance; payment coordinated outside platform.'});
async function offered() { const request=await submit();await command(request,'publish_quote',pricing(0));return request; }
async function accepted() { const request=await offered();await command(request,'accept',{revision:1},1);return request; }
const salt='a'.repeat(48);
const hash=code=>createHash('sha256').update(`${salt}:${code}`).digest('hex');
const issue=(request,who=1,reissue=false,code='123456')=>scalar('select public.managed_quote_issue_code($1,$2,$3,$4,$5,$6)',[id(who),request,salt,hash(code),'v1:a:b:c',reissue]);
const confirm=(request,code='123456',who=10)=>scalar('select public.managed_quote_confirm_delivery($1,$2,$3)',[id(who),request,code]);

await test('service-only writes and retired supplier submission endpoints',async()=>{
  for (const name of ['managed_quote_submit(uuid,jsonb,jsonb,text)','managed_quote_command(uuid,uuid,text,jsonb)','managed_quote_issue_code(uuid,uuid,text,text,text,boolean)','managed_quote_confirm_delivery(uuid,uuid,text)']) {
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)',['authenticated',`public.${name}`,'EXECUTE']),false);
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)',['anon',`public.${name}`,'EXECUTE']),false);
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)',['service_role',`public.${name}`,'EXECUTE']),true);
  }
  for(const name of ['submit_storefront_rfq','submit_customer_rfq']) assert.equal(await scalar(`select has_function_privilege('authenticated','public.${name}(jsonb,jsonb,text)','EXECUTE')`),false);
  assert.equal(await scalar(`select has_function_privilege('service_role','public.canonicalize_rfq_catalog_item(jsonb)','EXECUTE')`),true);
  await actor(1,'authenticated');await reject(()=>submit(),/permission denied/);
});
await test('idempotent submission, actor/quantity/duplicate rejection, authorized admin alerts',async()=>{
  const request=await submit(1,items,'same-managed-key');
  assert.equal(await submit(1,items,'same-managed-key'),request);
  assert.equal(await scalar('select count(*)::int from managed_quote_requests'),1);
  assert.equal(await scalar('select count(*)::int from notifications'),2);
  assert.deepEqual((await query('select profile_id from notifications order by profile_id')).map(row=>row.profile_id),[id(10),id(12)]);
  await reject(()=>submit(1,[{...items[0],quantity:3}],'same-managed-key'),/Idempotency conflict/);
  for(const who of [3,4,5,6,7,10]) await reject(()=>submit(who),/Verified customer/);
  for(const quantity of [0,-1,0.0001,1000001]) await reject(()=>submit(1,[{...items[0],quantity}]),/quantity/);
  await reject(()=>submit(1,[items[0],items[0]]),/Duplicate item/);
});
await test('RLS hides drafts/code secrets from customers/providers/drivers; counters preserve old keys',async()=>{
  await submit();
  for(const who of [1,2,3,4,11]) {await actor(who,'authenticated');assert.equal(await scalar('select count(*)::int from managed_quote_requests'),0);await reject(()=>query('select * from managed_quote_delivery_codes'),/permission denied/);}
  await actor(10,'authenticated');assert.equal(await scalar('select count(*)::int from managed_quote_requests'),1);
  await reject(()=>query('select * from managed_quote_delivery_codes'),/permission denied/);
  await reject(()=>db.query(`update managed_quote_requests set status='accepted'`),/permission denied/);
  const counts=await scalar('select admin_attention_counts()');assert.equal(counts.existing,4);assert.equal(counts['/admin/managed-quotes'],1);
});
await test('pricing exact totals, complete lines, draft privacy and revision safety',async()=>{
  const request=await submit();
  let result=await command(request,'save_quote',pricing(0));
  assert.equal(result.status,'submitted');assert.equal(result.subtotal,45.85);assert.equal(result.vat_amount,8.38);assert.equal(result.total,64.23);assert.equal(result.pricing[0].unit,'ton');
  assert.equal(await scalar('select count(*)::int from customer_notifications'),0);
  await reject(()=>command(request,'publish_quote',pricing(0)),/Revision conflict/);
  await reject(()=>command(request,'publish_quote',{...pricing(1),pricing:[]}),/Price every/);
  await reject(()=>command(request,'publish_quote',{...pricing(1),pricing:[pricing(1).pricing[0],pricing(1).pricing[0]]}),/Price every/);
  const bad=pricing(1);bad.pricing[1].rental_duration_value=0;await reject(()=>command(request,'publish_quote',bad),/rental duration/i);
  await reject(()=>command(request,'publish_quote',pricing(1),11),/Not authorized/);
  result=await command(request,'publish_quote',pricing(1));assert.equal(result.status,'offered');assert.equal(result.revision,2);
  assert.equal(await scalar('select count(*)::int from customer_notifications'),1);
});
await test('decision ownership/expiry/revision, idempotent acceptance and immutable accepted quote',async()=>{
  const request=await offered();
  await reject(()=>command(request,'accept',{revision:1},2),/Request unavailable/);
  await reject(()=>command(request,'accept',{revision:0},1),/Revision conflict/);
  await reject(()=>command(request,'accept',{revision:1},10),/Not authorized/);
  const first=await command(request,'accept',{revision:1},1);assert.equal(first.status,'accepted');assert.ok(first.accepted_at);
  assert.equal((await command(request,'accept',{revision:1},1)).status,'accepted');
  assert.equal(await scalar(`select count(*)::int from managed_quote_events where action='accept'`),1);
  await reject(()=>command(request,'publish_quote',pricing(1)),/immutable/);
  await reject(()=>command(request,'cancel',{}),/Cannot cancel/);
  const other=await offered();await db.query(`update managed_quote_requests set valid_until=now()-interval '1 minute' where id=$1`,[other]);
  await reject(()=>command(other,'accept',{revision:1},1),/expired/);
});
await test('rejected quote repricing; invalid rental/unit/negative price/precision rejected',async()=>{
  const request=await offered();assert.equal((await command(request,'reject',{revision:1},1)).status,'rejected');
  assert.equal((await command(request,'reject',{revision:1},1)).status,'rejected');
  for(const changes of [{unit_price:-1},{unit_price:1.111},{offer_type:'unknown'},{unit:'تحددها الإدارة'},{unit:'kilogram'},{warranty:''}]) {
    const body=pricing(1);body.pricing[0]={...body.pricing[0],...changes};await reject(()=>command(request,'publish_quote',body));
  }
  const result=await command(request,'publish_quote',pricing(1));assert.equal(result.status,'offered');assert.equal(result.revision,2);
});
await test('idempotent owner initial code issue and audited admin-only reissue',async()=>{
  const request=await accepted();
  await reject(()=>issue(request,2),/Not authorized/);await reject(()=>issue(request,1,true),/Not authorized/);
  assert.equal((await issue(request)).issued,true);assert.equal((await issue(request,1,false,'654321')).issued,false);
  assert.equal(await scalar('select code_hash from managed_quote_delivery_codes where request_id=$1',[request]),hash('123456'));
  assert.equal((await issue(request,10,true,'654321')).issued,true);
  assert.equal(await scalar('select code_hash from managed_quote_delivery_codes where request_id=$1',[request]),hash('654321'));
  assert.equal(await scalar(`select count(*)::int from managed_quote_events where action='code_reissued'`),1);
});
await test('wrong attempt counters persist, lock requires reissue, expired codes cannot complete',async()=>{
  const request=await accepted();await issue(request);
  for(let index=0;index<5;index++) {const result=await confirm(request,'000000');assert.equal(result.ok,false);assert.equal(result.attempts_remaining,4-index);}
  assert.equal((await confirm(request)).status,'locked');assert.equal(await scalar('select attempts from managed_quote_delivery_codes where request_id=$1',[request]),5);
  await db.query(`update managed_quote_delivery_codes set locked_until=now()-interval '1 minute' where request_id=$1`,[request]);assert.equal((await confirm(request)).status,'locked');
  await issue(request,10,true);await db.query(`update managed_quote_delivery_codes set expires_at=now()-interval '1 minute' where request_id=$1`,[request]);assert.equal((await confirm(request)).status,'expired');
  assert.equal(await scalar('select status from managed_quote_requests where id=$1',[request]),'accepted');
});
await test('sourcing-admin-only successful receipt is atomic and idempotent; no raw code audit',async()=>{
  const request=await accepted();await issue(request);
  for(const who of [1,2,3,4,11]) await reject(()=>confirm(request,'123456',who),/Not authorized/);
  assert.equal((await confirm(request)).ok,true);assert.equal((await confirm(request)).ok,true);
  const row=(await query('select status,delivered_at from managed_quote_requests where id=$1',[request]))[0];assert.equal(row.status,'delivered');assert.ok(row.delivered_at);
  assert.equal(await scalar(`select count(*)::int from managed_quote_events where action='delivered'`),1);
  assert.ok(await scalar('select verified_at from managed_quote_delivery_codes where request_id=$1',[request]));
  assert.ok(!(await scalar('select jsonb_agg(metadata)::text from managed_quote_events')).includes('123456'));
  await reject(()=>issue(request,10,true),/Accepted quote required/);
});
await db.close();
console.log(`PASS ${passed} managed quote SQL groups (isolated PostgreSQL, no live records/messages).`);
