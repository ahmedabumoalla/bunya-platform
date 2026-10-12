// Isolated PostgreSQL integration tests, using the existing project schema and commission triggers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
process.on('uncaughtException', e => { console.error(e.message, e.where || '', e.query || ''); process.exit(1); });
const db = new PGlite();
const source = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g,'\n');
const base = source('001_bunya_production_schema.sql');
const m8 = source('008_support_settlements_notifications.sql');
const migration = source('092_contractor_sequential_project_search.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fn = (sql,name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
const scalar = async (sql,args=[]) => Object.values((await q(sql,args))[0])[0];
let passed=0;
async function test(name,body) { await db.exec('begin'); try {await body();passed++;console.log(`PASS ${name}`);} finally {await db.exec('rollback');} }
async function reject(body,pattern=/./) {await db.exec('savepoint bad');try {await assert.rejects(body,pattern);} finally {await db.exec('rollback to savepoint bad');}}
async function actor(n,role='authenticated') {await db.exec(`reset role;set local role ${role};select set_config('request.jwt.claim.sub','${n?id(n):''}',true);select set_config('request.jwt.claim.role','${role}',true)`);}
async function owner() {await db.exec('reset role');}
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
create table profiles(id uuid primary key,role text,is_active boolean default true);
create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
create table providers(id uuid primary key,status text);
create table provider_members(provider_id uuid,profile_id uuid,is_active boolean);
create table customer_profiles(profile_id uuid primary key references profiles);
create table user_roles(profile_id uuid references profiles,role text,revoked_at timestamptz);
create table contractor_applications(id uuid primary key);
create function public.is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and role='admin' and is_active)$$;
create function public.admin_has_permission(text) returns boolean language sql stable security definer as $$select public.is_admin()$$;
create table audit_logs(id uuid default gen_random_uuid(),actor_profile_id uuid,contractor_profile_id uuid,entity_table text,entity_id text,action text,old_data jsonb,new_data jsonb);
create table outbox_events(id uuid default gen_random_uuid(),aggregate_type text,aggregate_id uuid,event_type text,payload jsonb,idempotency_key text);
create unique index outbox_key on outbox_events(idempotency_key) where idempotency_key is not null;`);
for(const match of base.matchAll(/create type public\.[\s\S]*?;/g)) await db.exec(match[0]);
const tables=['contractor_profiles','contractor_profile_specialties','contractor_profile_regions','contractor_portfolio_items','contractor_services','contractor_service_regions','contractor_availability','project_requests','project_request_specialties','contractor_opportunities','contractor_opportunity_matches','contractor_proposals','contractor_proposal_stages','contractor_projects','contractor_project_milestones','contractor_project_updates','contractor_project_documents','contractor_reviews','contractor_review_replies','contractor_portfolio_media','contractor_bank_accounts','contractor_financial_transactions','contractor_settlement_requests'];
for(const table of tables) {
  await db.exec(base.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`))[0]);
  await db.exec(`alter table ${table} enable row level security`);
}
await db.exec(base.match(/alter table public\.project_requests\n  alter column estimated_budget_min[\s\S]*?;/)[0]);
await db.exec(`create function public.is_contractor_owner(uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from contractor_profiles where id=$1 and profile_id=auth.uid())$$;
create table contractor_workflow_idempotency(profile_id uuid references profiles,scope text,key text,entity_id uuid,created_at timestamptz default now(),primary key(profile_id,scope,key));
alter table contractor_services add column title text,add column review_status text default 'draft',add column review_notes text,add column is_active boolean default true,add column deleted_at timestamptz;
alter table contractor_portfolio_items add column review_status text default 'draft',add column review_notes text,add column deleted_at timestamptz;`);
for(const match of m8.matchAll(/alter table public\.(?:contractor_bank_accounts|contractor_financial_transactions|contractor_settlement_requests)[^;]+;/g)) await db.exec(match[0]);
await db.exec(m8.match(/create unique index if not exists contractor_settlement_idempotency_idx[^;]+;/)[0]);
await db.exec(fn(m8,'protect_contractor_financial_history'));
await db.exec(`create trigger contractor_financial_immutable before update or delete on contractor_financial_transactions for each row execute function protect_contractor_financial_history()`);
await db.exec(fn(m8,'request_contractor_settlement'));
await db.exec(fn(source('077_fix_proposal_acceptance_milestone_guard.sql'),'protect_contractor_milestone_fields'));
await db.exec(`create trigger milestone_guard before insert or update or delete on contractor_project_milestones for each row execute function protect_contractor_milestone_fields()`);
for(const match of base.matchAll(/create policy [^;]+;/g)) {
  const table=match[0].match(/ on public\.(\w+)/)?.[1];
  if(tables.includes(table)) await db.exec(match[0]);
}
await db.exec(`grant usage on schema public,auth to anon,authenticated,service_role;grant select,insert,update,delete on all tables in schema public to authenticated,service_role;grant select on all tables in schema public to anon;
alter table profiles enable row level security;create policy profiles_own on profiles for select to authenticated using(id=auth.uid());
alter table user_roles enable row level security;create policy roles_own on user_roles for select to authenticated using(profile_id=auth.uid());
insert into profiles(id,role) values('${id(1)}','customer'),('${id(2)}','customer'),('${id(9)}','admin');
insert into customer_profiles values('${id(1)}'),('${id(2)}');insert into user_roles(profile_id,role) values('${id(1)}','customer'),('${id(2)}','customer');`);
await db.exec(`insert into auth.users values('${id(1)}','966500000001',now()),('${id(2)}','+966500000002',now())`);
for(let n=10;n<18;n++) {
 await db.query(`insert into profiles(id,role,is_active) values($1,'contractor',$2)`,[id(n),n!==15]);
 await db.query('insert into contractor_applications values($1)',[id(n+100)]);
 await db.query(`insert into user_roles(profile_id,role,revoked_at) values($1,'contractor',case when $2 then now() end)`,[id(n),n===16]);
 await db.query(`insert into contractor_profiles(id,profile_id,application_id,display_name,commercial_name,phone,email,approval_status,average_rating,availability) values($1,$2,$3,$4,$4,'0500000000','fixture.invalid',$5,$6,$7)`,[id(n+200),id(n),id(n+100),`Contractor ${n}`,n===17?'pending':'approved',n===10?5:4,n===14?'busy':'available']);
 await db.query('insert into contractor_profile_regions values($1,$2)',[id(n+200),n===12?'Other city':'Riyadh']);
 await db.query('insert into contractor_profile_specialties(profile_id,specialty_name) values($1,$2)',[id(n+200),n===13?'Other service':'Build']);
}

await db.exec(migration);
await db.exec(`alter function public.is_admin() set search_path=public,pg_temp;alter function public.admin_has_permission(text) set search_path=public,pg_temp;`);
await db.exec(`alter table profiles add column must_change_password boolean not null default false, add column full_name text; update profiles set full_name='Fixture customer';`);
await db.exec(source('094_contractor_platform_conversations.sql'));
await db.exec(source('095_restrict_conversation_helpers.sql'));
let keyIndex=900;
const chat = (action, conversation=null, payload={}, key=id(++keyIndex)) => scalar('select contractor_chat_command($1,$2,$3,$4)',[action,conversation,payload,key]);
async function openChat() {await actor(1);return (await chat('open',null,{contractor_id:id(210)})).id;}
async function sendQuote(c) {await actor(10);return (await chat('quote',c,{body:'Complete building works with warranty',amount:1000,duration_days:30,start_at:'2030-01-01',valid_days:7,terms_accepted:true})).id;}
async function release(c,m) {await actor(9);return chat('release',c,{message_id:m,review_confirmed:true});}

await test('contact variants are caught; ordinary scope remains reviewable', async()=> {
 await actor(1);
 for(const text of ['050225205','+9665024698','٠٥٠٢٢٥٢٠٥','０５０２２５２０５','0 5 0 2 2 5 2 0 5','صفر خمسة صفر','صفر خمسه صفر اثنين اثنين خمسه اثنين صفر خمسه','zero five zero two two five two zero five','a@example.com','a at gmail dot com','سنابي user','انستقرام foo','https://example.com','0\u200b5\u200d0\u200b225205']) {
  assert.equal(await scalar('select contractor_contact_detected($1)',[text]),true,text);
 }
 assert.equal(await scalar('select contractor_contact_detected($1)',['تنفيذ أعمال السباكة خلال أسبوع']),false);
});
await test('directory has safe labels; contact tables deny visitor access',async()=>{
 await actor(null,'anon');
 assert.equal(await scalar('select count(*)::int from contractor_profiles'),0);
 const cards=await q('select * from contractor_directory_cards()');assert.ok(cards.length);
 assert.ok(cards.every(c=>!('phone' in c)&&!('email' in c)));
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_profiles'),0);
 await actor(10);assert.equal(await scalar('select count(*)::int from contractor_profiles'),1);
});
await test('open is authenticated, verified, idempotent and excludes self',async()=>{
 await actor(null,'anon');await reject(()=>chat('open',null,{contractor_id:id(210)}));
 const c=await openChat();assert.equal(await openChat(),c);
 await actor(2);await reject(()=>chat('send',c,{body:'Secret'}));
 await actor(10);await reject(()=>chat('open',null,{contractor_id:id(210)}));
 await actor(1);await reject(()=>db.query('update contractor_conversations set customer_id=$1 where id=$2',[id(2),c]));
});
await test('pending and blocked text never reach the other participant or originals endpoint',async()=>{
 const c=await openChat();await actor(10);
 const blocked=await chat('send',c,{body:'رقمي 050225205'});
 assert.equal(blocked.moderation,'blocked');
 const pending=await chat('send',c,{body:'تنفيذ أعمال السباكة خلال أسبوع'});
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_chat_messages'),0);
 assert.equal(await scalar('select count(*)::int from contractor_chat_originals'),0);
 await reject(()=>chat('release',c,{message_id:pending.id,review_confirmed:true}));
 await actor(9);assert.equal(await scalar('select count(*)::int from contractor_chat_originals'),2);
 await reject(()=>chat('release',c,{message_id:blocked.id,review_confirmed:true}));
 await reject(()=>chat('release',c,{message_id:pending.id,body:'foo@example.com',review_confirmed:true}));
 await release(c,pending.id);await actor(1);
 assert.equal(await scalar('select count(*)::int from contractor_chat_messages'),1);
 assert.equal(await scalar('select body from contractor_chat_messages'),'تنفيذ أعمال السباكة خلال أسبوع');
 await reject(()=>db.query('delete from contractor_chat_messages'));
 await actor(2);assert.equal(await scalar('select count(*)::int from contractor_conversations'),0);
 assert.equal(await scalar('select count(*)::int from contractor_chat_messages'),0);
 await reject(()=>scalar('select contractor_chat_summary($1)',[c]));
});
await test('split or unrecognized contact text stays pending until contextual human review',async()=>{
 const c=await openChat();await actor(10);
 for(const body of ['صفر','خمسة','صفر','my handle','unusual obfuscation']) assert.equal((await chat('send',c,{body})).moderation,'pending');
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_chat_messages'),0);
});
await test('rate limit and receipt replay do not create duplicate messages',async()=>{
 const c=await openChat();await actor(10);const key=id(800);
 const first=await chat('send',c,{body:'Scope'},key);assert.deepEqual(await chat('send',c,{body:'Scope'},key),first);
 await reject(()=>chat('send',c,{body:'Different'},key));
 for(let i=1;i<10;i++) await chat('send',c,{body:'Scope detail'});
 await reject(()=>chat('send',c,{body:'Too many'}),/Rate limit/);
});
await test('quote approval creates real project and immutable 5% agreement, no fictitious payment',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await actor(1);
 assert.equal(await scalar('select count(*)::int from contractor_chat_quotes'),0);
 await reject(()=>chat('accept_quote',c,{quote_id:quote,terms_accepted:true}));
 await release(c,quote);await actor(10);await reject(()=>chat('accept_quote',c,{quote_id:quote,terms_accepted:true}));
 await actor(1);await reject(()=>chat('accept_quote',c,{quote_id:quote}));
 const key=id(801);const result=await chat('accept_quote',c,{quote_id:quote,terms_accepted:true},key);
 assert.ok(result.project_id);assert.deepEqual(await chat('accept_quote',c,{quote_id:quote,terms_accepted:true},key),result);
 await reject(()=>chat('accept_quote',c,{quote_id:quote,terms_accepted:true}));
 const summary=await scalar('select contractor_chat_summary($1)',[c]);assert.equal(Number(summary.paid),0);assert.equal(Number(summary.quote.commission_amount),50);
 await owner();const project=(await q('select * from contractor_projects where id=$1',[result.project_id]))[0];
 assert.equal(Number(project.platform_commission_rate),5);assert.equal(Number(project.platform_commission_amount),50);
 assert.equal(await scalar("select count(*)::int from contractor_financial_transactions where status='available'"),0);
});
await test('verified receipts accrue fees once; payment, completion and dispute gates enforced',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);
 await chat('accept_quote',c,{quote_id:quote,terms_accepted:true});
 await reject(()=>chat('record_payment',c,{amount:1000,reference:'bank-fixture',payment_confirmed:true}));
 await actor(10);await chat('request_completion',c);await actor(1);await reject(()=>chat('confirm_completion',c),/Full payment/);
 await chat('dispute',c);await actor(9);await reject(()=>chat('record_payment',c,{amount:1000,reference:'bank-fixture',payment_confirmed:true}));
 await chat('resolve_dispute',c);await reject(()=>chat('record_payment',c,{amount:1000,reference:'bank-fixture'}));
 const key=id(802);await chat('record_payment',c,{amount:400,reference:'bank-fixture-1',payment_confirmed:true},key);
 await chat('record_payment',c,{amount:400,reference:'bank-fixture-1',payment_confirmed:true},key);
 await reject(()=>chat('record_payment',c,{amount:400,reference:'bank-fixture-1',payment_confirmed:true}));
 await reject(()=>chat('record_payment',c,{amount:700,reference:'bank-fixture-2',payment_confirmed:true}));
 await chat('record_payment',c,{amount:600,reference:'bank-fixture-2',payment_confirmed:true});
 await owner();assert.equal(Number(await scalar("select sum(amount) from contractor_financial_transactions where financial_kind='commission'")),50);
 await actor(10);await chat('request_completion',c);await actor(1);await chat('confirm_completion',c);
 assert.equal(await scalar('select status from contractor_conversations where id=$1',[c]),'completed');
 await reject(()=>chat('send',c,{body:'After archive'}));
});
await test('expired, rejected and revised quotes cannot be accepted; one accepted quote wins',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);
 await chat('request_changes',c,{quote_id:quote});await reject(()=>chat('accept_quote',c,{quote_id:quote,terms_accepted:true}));
 const next=await sendQuote(c);await release(c,next);await owner();await db.query("update contractor_chat_quotes set valid_until=now()-interval '1 second' where id=$1",[next]);
 await actor(1);await reject(()=>chat('accept_quote',c,{quote_id:next,terms_accepted:true}));
});
await test('suspended identities lose conversation and command access',async()=>{
 const c=await openChat();await owner();await db.query('update profiles set is_active=false where id=$1',[id(1)]);
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_conversations'),0);await reject(()=>chat('send',c,{body:'Denied'}));
});
await test('online checkout is service-only, reserves once and credits the ledger exactly once',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);await chat('accept_quote',c,{quote_id:quote,terms_accepted:true});
 await reject(()=>scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)]));
 await actor(null,'service_role');
 const p=await scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)]);
 const again=await scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)]);assert.equal(again.id,p.id);assert.equal(again.created,false);
 await db.query("update contractor_chat_payments set expires_at=now()-interval '1 minute' where id=$1",[p.id]);
 assert.equal((await scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)])).id,p.id,'expiry alone cannot open a second payable session');
 await db.query("update contractor_chat_payments set gateway_order_id='1234',session_secret='test-only' where id=$1",[p.id]);
 await reject(()=>scalar('select apply_contractor_chat_payment($1,$2,$3,$4,$5)',[p.id,'5678','9999',1000,'succeeded']));
 await reject(()=>scalar('select apply_contractor_chat_payment($1,$2,$3,$4,$5)',[p.id,'5678','1234',999,'succeeded']));
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_chat_originals'),0);
 await reject(()=>q('select session_secret from contractor_chat_payments'));
 await actor(9);await reject(()=>chat('record_payment',c,{amount:1000,reference:'bank-online-race',payment_confirmed:true}),/Online payment/);
 await actor(null,'service_role');
 const apply=()=>scalar('select apply_contractor_chat_payment($1,$2,$3,$4,$5)',[p.id,'5678','1234',1000,'succeeded']);
 assert.equal((await apply()).status,'succeeded');assert.equal((await apply()).status,'succeeded');
 await owner();assert.equal(Number(await scalar("select sum(amount) from contractor_financial_transactions where financial_kind='commission'")),50);
 await actor(1);assert.equal(Number((await scalar('select contractor_chat_summary($1)',[c])).paid),1000);
});
await test('refund signals hold the conversation and do not erase payment history',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);await chat('accept_quote',c,{quote_id:quote,terms_accepted:true});
 await actor(null,'service_role');const p=await scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)]);
 await db.query("update contractor_chat_payments set gateway_order_id='1234' where id=$1",[p.id]);
 await scalar('select apply_contractor_chat_payment($1,$2,$3,$4,$5)',[p.id,'5678','1234',1000,'succeeded']);
 await scalar('select apply_contractor_chat_payment($1,$2,$3,$4,$5)',[p.id,'5678','1234',1000,'refunded']);
 await actor(1);const summary=await scalar('select contractor_chat_summary($1)',[c]);assert.equal(summary.payment_review,true);
 assert.equal(await scalar('select status from contractor_conversations where id=$1',[c]),'disputed');
 await actor(9);await reject(()=>chat('record_payment',c,{amount:1000,reference:'after-refund',payment_confirmed:true}));
 await owner();assert.equal(Number(await scalar("select sum(amount) from contractor_financial_transactions where financial_kind='commission'")),50);
});
await test('bank setup is finance-only, validated, private; transfer notices never credit funds',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);await chat('accept_quote',c,{quote_id:quote,terms_accepted:true});
 await reject(()=>scalar('select configure_contractor_collection_account($1,$2,$3)',['Bank','Bunya','SA0380000000608010167519']));
 await actor(9);await reject(()=>scalar('select configure_contractor_collection_account($1,$2,$3)',['Bank','Bunya','SA0000000000000000000000']));
 await scalar('select configure_contractor_collection_account($1,$2,$3)',['Bank','Bunya','SA0380000000608010167519']);
 await actor(1);assert.ok((await scalar('select contractor_chat_summary($1)',[c])).bank);
 const claim=await chat('transfer_notice',c,{amount:1000,reference:'bank-notice-fixture'});
 assert.equal(Number((await scalar('select contractor_chat_summary($1)',[c])).paid),0);
 await actor(10);assert.equal(await scalar('select count(*)::int from contractor_chat_transfers'),0);
 assert.equal((await scalar('select contractor_chat_summary($1)',[c])).bank,null);
 await actor(null,'service_role');await reject(()=>scalar('select reserve_contractor_chat_payment($1,$2)',[c,id(1)]),/Transfer requires review/);
 await actor(9);await chat('record_payment',c,{transfer_id:claim.id,payment_confirmed:true});
 await reject(()=>chat('record_payment',c,{transfer_id:claim.id,payment_confirmed:true}));
 await actor(1);assert.equal(Number((await scalar('select contractor_chat_summary($1)',[c])).paid),1000);
});
await test('archived conversations stay immutable and a later deal receives a new archive number',async()=>{
 const c=await openChat();await actor(10);const m=await chat('send',c,{body:'Pending scope'});
 await actor(9);await chat('close',c);await reject(()=>chat('release',c,{message_id:m.id,review_confirmed:true}),/closed/);
 const next=await openChat();assert.notEqual(next,c);
 await actor(1);assert.equal(await scalar('select count(*)::int from contractor_conversations'),2);
});
await test('linked project writes cannot bypass the moderated chat',async()=>{
 const c=await openChat();const quote=await sendQuote(c);await release(c,quote);await actor(1);
 const result=await chat('accept_quote',c,{quote_id:quote,terms_accepted:true});
 await actor(10);
 await reject(()=>db.query('update contractor_projects set notes=$1 where id=$2',['phone hidden in project notes',result.project_id]));
 await reject(()=>db.query("update contractor_projects set status='completed' where id=$1",[result.project_id]));
});
console.log(`Contractor conversation SQL: ${passed} integration groups passed.`);
await db.close();
