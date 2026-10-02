// Actual migration092 and existing PostgreSQL tables/policies; isolated, no live messages.
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
const tables=['contractor_profiles','contractor_profile_specialties','contractor_profile_regions','contractor_portfolio_items','contractor_services','contractor_service_regions','contractor_availability','project_requests','project_request_specialties','contractor_opportunities','contractor_opportunity_matches','contractor_proposals','contractor_proposal_stages','contractor_projects','contractor_project_milestones','contractor_portfolio_media','contractor_bank_accounts','contractor_financial_transactions','contractor_settlement_requests'];
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
// Existing open requests and submitted quotes survive migration without notifications.
await db.exec(`insert into project_requests(id,request_code,customer_profile_id,title,project_type,description,scope,city,region,estimated_budget_min,estimated_budget_max,expected_start_at,estimated_duration,proposal_deadline_at,customer_label,lifecycle_status) values('${id(90)}','legacy-request','${id(1)}','Legacy','Build','Description','Scope','Riyadh','Central',1,100,'2030-01-01','Month','2030-02-01','Customer','under_customer_review');
insert into project_request_specialties values('${id(90)}','Build');
insert into contractor_opportunities(id,project_request_id,contractor_profile_id,status,expires_at) values('${id(91)}','${id(90)}','${id(210)}','proposed','2030-02-01');
insert into contractor_proposals(id,proposal_code,opportunity_id,contractor_profile_id,amount,policy_accepted,status,submitted_at,valid_until) values('${id(92)}','legacy-proposal','${id(91)}','${id(210)}',100,true,'under_review',now(),'2030-02-01');`);
await db.exec(migration);
assert.equal(await scalar('select search_status from project_requests where id=$1',[id(90)]),'searching');
assert.equal(await scalar('select status from contractor_proposals where id=$1',[id(92)]),'under_review');
assert.equal(await scalar('select count(*)::int from outbox_events'),0);
await db.exec(`delete from project_requests where id='${id(90)}'`);
const requestPayload={title:'Build request',project_type:'Build',description:'A detailed project',scope:'Complete works',city:'Riyadh',region:'Central',budget_min:10,budget_max:1000,expected_start_at:'2030-01-01',estimated_duration:'One month',duration_value:1,duration_unit:'month'};
async function request(key='request-0001',payload={}) {await actor(1);return scalar('select submit_customer_project_request($1,$2,$3)',[{...requestPayload,...payload},['Build'],key]);}
async function state(r) {return scalar('select get_customer_project_search($1)',[r]);}
async function current(r) {await owner();return (await q('select * from contractor_opportunities where project_request_id=$1 and is_current',[r]))[0];}
async function propose(r,overrides={},key='proposal-001') {
 const op=await current(r);const user=Number(op.contractor_profile_id.slice(-12))-200;await actor(user);
 const payload={amount:1000,execution_duration:'One month',proposed_start_at:'2030-01-01',scope_details:'Scope detail',valid_until:'2030-02-01T12:00:00Z',policy_accepted:true,...overrides};
 return scalar('select save_contractor_proposal($1,$2,$3,true,$4)',[op.id,payload,[{name:'Completion',description:'Complete work',duration:'One month',value_percentage:100,expected_at:'2030-02-01'}],key]);
}
async function decide(p,decision='accepted',key='decision-001') {await actor(1);return scalar('select decide_contractor_proposal($1,$2,$3,$4)',[p,decision,'Customer decision',key]);}
async function tick(r) {await owner();await db.query('update project_requests set search_next_check_at=now() where id=$1',[r]);await actor(null,'service_role');return scalar('select process_contractor_searches(50)');}
async function earn(project,amount,key='earned-1',status='available') {await owner();return scalar(`insert into contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,transaction_type,financial_kind,amount,status,balance_after) select $2,contractor_profile_id,id,'milestone_payment','milestone_payment',$3,$4,0 from contractor_projects where id=$1 returning id`,[project,key,amount,status]);}

await test('Riyadh business days skip Friday and Saturday',async()=>{
 assert.equal(await scalar(`select contractor_response_deadline('2026-10-01T09:00:00Z')::text`),'2026-10-05 09:00:00+00');
 assert.equal(await scalar(`select contractor_response_deadline('2026-10-04T09:00:00Z')::text`),'2026-10-06 09:00:00+00');
});
await test('one free approved matching invitation; idempotent request; ignores legacy cutoff',async()=>{
 const r=await request('request-0001',{proposal_deadline_at:'2000-01-01'});assert.equal(await request(),r);
 const op=await current(r);assert.equal(op.contractor_profile_id,id(210));
 assert.equal(await scalar('select count(*)::int from contractor_opportunities where project_request_id=$1',[r]),1);
 await actor(10);assert.equal((await q('select * from get_contractor_opportunities()')).length,1);
 await actor(1);assert.equal((await state(r)).status,'awaiting_contractor');
 assert.deepEqual(await tick(r),{processed:1,failed:0});
 assert.equal((await current(r)).id,op.id);
});
await test('timeout advances once, then exhaustion; stopped search blocks worker and resumes',async()=>{
 const r=await request();let op=await current(r);await db.query("update contractor_opportunities set expires_at=now()-interval '1 second' where id=$1",[op.id]);
 assert.deepEqual(await tick(r),{processed:1,failed:0});op=await current(r);assert.equal(op.contractor_profile_id,id(211));
 await actor(1);await db.query('select stop_project_contractor_search($1,$2)',[r,'stop-key-001']);
 await actor(11);await reject(()=>db.query('select save_contractor_proposal($1,$2,$3,true,$4)',[op.id,{},[],'stopped-001']),/not awaiting/);
 await actor(null,'service_role');assert.deepEqual(await scalar('select process_contractor_searches(50)'),{processed:0,failed:0});
 await actor(1);assert.equal((await scalar('select resume_project_contractor_search($1,$2)',[r,'resume-001'])).status,'awaiting_contractor');
 op=await current(r);await db.query("update contractor_opportunities set expires_at=now()-interval '1 second' where id=$1",[op.id]);await tick(r);await actor(1);assert.equal((await state(r)).status,'exhausted');
 await owner();await db.query("update contractor_profiles set availability='available' where id=$1",[id(214)]);
 await actor(1);assert.equal((await scalar('select resume_project_contractor_search($1,$2)',[r,'resume-new1'])).status,'awaiting_contractor');
 assert.equal((await current(r)).contractor_profile_id,id(214));
});
await test('submitted quote waits; customer inner join visible only to project owner; rejection advances',async()=>{
 const r=await request();const p=await propose(r);assert.deepEqual(await tick(r),{processed:1,failed:0});
 await actor(1);assert.equal((await state(r)).active_proposal_id,p);
 assert.equal((await q('select p.id from contractor_proposals p join contractor_opportunities o on o.id=p.opportunity_id where o.project_request_id=$1',[r])).length,1);
 await actor(2);assert.equal((await q('select p.id from contractor_proposals p join contractor_opportunities o on o.id=p.opportunity_id where o.project_request_id=$1',[r])).length,0);
 await reject(()=>db.query('select get_customer_project_search($1)',[r]),/authorized|not found|owner required/i);
 await decide(p,'rejected');assert.equal((await current(r)).contractor_profile_id,id(211));
 await decide(p,'rejected');assert.equal((await current(r)).contractor_profile_id,id(211));
});
await test('NULL/infinite validity and NaN amounts rejected atomically',async()=>{
 const r=await request();
 for(const values of [{valid_until:null},{valid_until:'infinity'},{amount:'NaN'},{amount:0}]) await reject(()=>propose(r,values),/validity|finite positive/);
 await owner();assert.equal(await scalar('select count(*)::int from contractor_proposals'),0);
});
await test('direct DML cannot bypass proposal/search commands; private worker grants',async()=>{
 const r=await request();const op=await current(r);await actor(1);
 await reject(()=>db.query("update project_requests set search_status='awarded' where id=$1",[r]),/authorized command/);
 await reject(()=>db.query('select process_contractor_searches(50)'),/permission denied/);
 await reject(()=>db.query('select advance_contractor_project_search($1)',[r]),/permission denied/);
 await actor(10);await reject(()=>db.query("update contractor_opportunities set status='proposed' where id=$1",[op.id]),/authorized command/);
 const p=await propose(r);await actor(1);await reject(()=>db.query("update contractor_proposals set status='accepted' where id=$1",[p]),/authorized command/);
});
await test('acceptance idempotent, real project/stages, immutable5% snapshot; no paid cash on award',async()=>{
 const r=await request();const p=await propose(r);const project=await decide(p);assert.equal(await decide(p),project);
 await owner();assert.equal(await scalar('select count(*)::int from contractor_projects'),1);
 assert.equal(await scalar('select count(*)::int from contractor_project_milestones'),1);
 assert.equal(Number(await scalar('select platform_commission_amount from contractor_projects where id=$1',[project])),50);
 assert.equal(await scalar("select count(*)::int from contractor_financial_transactions where status<>'pending'"),0);
 await reject(()=>db.query('update contractor_projects set platform_commission_rate=4 where id=$1',[project]),/immutable/);
 await actor(1);assert.equal((await state(r)).status,'awarded');
});
await test('100 earned creates5 fee and95 withdrawable; pending never charged; source replay unique',async()=>{
 const r=await request();const p=await propose(r);const project=await decide(p);
 await earn(project,100,'pending-1','pending');await earn(project,100);await owner();
 assert.equal(Number(await scalar("select sum(amount) from contractor_financial_transactions where financial_kind='commission'")),5);
 const bank=await scalar(`insert into contractor_bank_accounts(contractor_profile_id,bank_name,account_name,iban_encrypted,iban_last4) values($1,'Bank','Owner','fixture','0000') returning id`,[id(210)]);
 await actor(10);await reject(()=>db.query('select request_contractor_settlement(96,$1,null,$2)',[bank,'settle-0001']),/Insufficient/);
 assert.ok(await scalar('select request_contractor_settlement(95,$1,null,$2)',[bank,'settle-0002']));
 await owner();await reject(()=>db.query("insert into contractor_financial_transactions select gen_random_uuid(),'duplicate',contractor_profile_id,project_id,milestone_id,transaction_type,amount,status,balance_after,occurred_at,financial_kind,reference,metadata,commission_source_transaction_id from contractor_financial_transactions where financial_kind='commission'"),/unique/);
});
await test('cumulative rounding, project fee cap, immutable ledger and mismatched contractor rejection',async()=>{
 const r=await request();const project=await decide(await propose(r,{amount:1}));
 await earn(project,0.10,'earn-1');await earn(project,0.10,'earn-2');await earn(project,100,'earn-3');
 assert.equal(Number(await scalar("select sum(amount) from contractor_financial_transactions where financial_kind='commission'")),0.05);
 assert.equal(await scalar("select count(*)::int from contractor_financial_transactions where financial_kind='commission'"),2);
 await reject(()=>db.query("update contractor_financial_transactions set status='available'"),/immutable/);
 await reject(()=>earn(project,'NaN','earn-nan'),/finite/);
 await reject(()=>db.query(`insert into contractor_financial_transactions(transaction_code,contractor_profile_id,project_id,transaction_type,financial_kind,amount,status,balance_after) values('wrong',$1,$2,'advance','advance',100,'available',0)`,[id(211),project]),/must match/);
});
await test('public approved content is free; suspended and unreviewed content remains private',async()=>{
 await owner();
 for(const n of [10,15,17]) {
   await db.query(`insert into contractor_services(contractor_profile_id,name,title,primary_specialty,description,pricing_method,estimated_duration,status,review_status) values($1,'Build','Build','Build','Description','inspection','One month','active','approved')`,[id(n+200)]);
   const portfolio=await scalar(`insert into contractor_portfolio_items(profile_id,title,is_visible,is_approved,review_status) values($1,'Work',true,true,'approved') returning id`,[id(n+200)]);
   await db.query(`insert into contractor_portfolio_media(portfolio_item_id,storage_path,file_name,mime_type,size_bytes) values($1,$2,'Photo','image/jpeg',100)`,[portfolio,`private/${n}.jpg`]);
 }
 await db.exec(`insert into contractor_portfolio_items(profile_id,title,is_visible,is_approved,review_status) values('${id(210)}','Unreviewed',true,false,'pending_review')`);
 await actor(null,'anon');
 assert.equal(await scalar('select count(*)::int from contractor_services'),1);
 assert.equal(await scalar('select count(*)::int from contractor_portfolio_items'),1);
 assert.equal(await scalar('select count(*)::int from contractor_portfolio_media'),1);
 assert.equal(await scalar('select count(*)::int from contractor_profile_specialties where profile_id=$1',[id(210)]),1);
 assert.equal(await scalar('select count(*)::int from contractor_profile_regions where profile_id=$1',[id(215)]),0);
 assert.equal(await scalar('select count(*)::int from profiles'),0);
});
await test('active roles and verified identity enforced; current professionals need no second OTP',async()=>{
 await owner();await db.exec(`update auth.users set phone_confirmed_at=null where id='${id(1)}'`);
 await reject(()=>request(),/Verified customer/);
 await owner();await db.exec(`insert into user_roles(profile_id,role) values('${id(10)}','customer');insert into customer_profiles values('${id(10)}')`);
 await actor(10);const r=await scalar('select submit_customer_project_request($1,$2,$3)',[requestPayload,['Build'],'self-check-1']);
 const op=await current(r);assert.equal(op.contractor_profile_id,id(211));
 await db.exec(`update user_roles set revoked_at=now() where profile_id='${id(10)}' and role='contractor'`);
 await actor(10);await reject(()=>db.query('select submit_customer_project_request($1,$2,$3)',[requestPayload,['Build'],'self-check-2']),/Verified customer/);
 await owner();await db.exec(`update profiles set is_active=false where id='${id(2)}'`);await actor(2);
 await reject(()=>db.query('select submit_customer_project_request($1,$2,$3)',[requestPayload,['Build'],'inactive-01']),/Verified customer/);
});
await test('stop blocks current quote acceptance; resume restores live quote; expiry advances',async()=>{
 const r=await request();const p=await propose(r);await actor(1);
 await db.query('select stop_project_contractor_search($1,$2)',[r,'stop-quote1']);
 await reject(()=>decide(p),/currently reviewable/);
 assert.equal((await scalar('select resume_project_contractor_search($1,$2)',[r,'resumequote'])).status,'awaiting_customer');
 await owner();await db.query("update contractor_proposals set submitted_at=now()-interval '2 days',valid_until=now()-interval '1 day' where id=$1",[p]);
 await reject(()=>decide(p),/currently reviewable/);
 await tick(r);assert.equal((await current(r)).contractor_profile_id,id(211));
});
await test('needs changes refreshes same invitation; revision submission and replay preserve one proposal',async()=>{
 const r=await request();const p=await propose(r);await decide(p,'needs_changes');
 let op=await current(r);assert.equal(op.invitation_round,2);assert.equal(op.contractor_profile_id,id(210));
 const revised=await propose(r,{amount:900},'revised-0001');assert.equal(revised,p);
 await actor(10);assert.equal(await scalar('select save_contractor_proposal($1,$2,$3,true,$4)',[op.id,{amount:1},[],'revised-0001']),p);
 await owner();assert.equal(await scalar('select count(*)::int from contractor_proposals'),1);
 assert.equal(Number(await scalar('select amount from contractor_proposals where id=$1',[p])),900);
});
await test('legacy parallel quote adoption preserves all history, notifies only current, ignores Infinity',async()=>{
 const r=await request();const p=await propose(r);await owner();
 const op2=await scalar(`insert into contractor_opportunities(project_request_id,contractor_profile_id,status,expires_at) values($1,$2,'proposed','2030-02-01') returning id`,[r,id(211)]);
 const p2=await scalar(`insert into contractor_proposals(proposal_code,opportunity_id,contractor_profile_id,amount,policy_accepted,status,submitted_at,valid_until) values('legacy-quote',$1,$2,200,true,'under_review',now(),'2030-02-01') returning id`,[op2,id(211)]);
 await decide(p,'rejected');await actor(1);assert.equal((await state(r)).active_proposal_id,p2);
 await owner();assert.equal(await scalar('select count(*)::int from contractor_proposals'),2);
 assert.equal(await scalar("select count(*)::int from outbox_events where idempotency_key=$1",['proposal-current:'+p2]),1);
 await db.query("update contractor_proposals set valid_until='infinity' where id=$1",[p2]);await tick(r);await actor(1);assert.equal((await state(r)).status,'exhausted');
});
await test('historical project snapshots remain NULL and no retrospective fee is created',async()=>{
 const r=await request();const p=await propose(r);await owner();
 const project=await scalar(`insert into contractor_projects(project_code,accepted_proposal_id,contractor_profile_id,customer_profile_id,name,customer_label,project_value,start_at,expected_end_at,scope) values('legacy',$1,$2,$3,'Legacy','Customer',1000,'2030-01-01','2030-02-01','Scope') returning id`,[p,id(210),id(1)]);
 await earn(project,100);
 assert.equal(await scalar("select count(*)::int from contractor_financial_transactions where financial_kind='commission'"),0);
 await reject(()=>db.query(`insert into contractor_projects(project_code,accepted_proposal_id,contractor_profile_id,customer_profile_id,name,customer_label,project_value,start_at,expected_end_at,scope,platform_commission_rate) values('partial',$1,$2,$3,'Partial','Customer',1000,'2030-01-01','2030-02-01','Scope',5)`,[p,id(210),id(1)]),/commission_shape/);
});
await test('account-only legacy earnings remain untouched; authenticated contractor cannot manufacture cash',async()=>{
 await owner();await db.exec('alter table contractor_financial_transactions alter column project_id drop not null');
 await db.query(`insert into contractor_financial_transactions(transaction_code,contractor_profile_id,transaction_type,financial_kind,amount,status,balance_after) values('account-credit',$1,'advance','advance',100,'available',100)`,[id(210)]);
 assert.equal(await scalar("select count(*)::int from contractor_financial_transactions where financial_kind='commission'"),0);
 await actor(10);await reject(()=>db.query(`insert into contractor_financial_transactions(transaction_code,contractor_profile_id,transaction_type,financial_kind,amount,status,balance_after) values('forged-credit',$1,'advance','advance',100,'available',100)`,[id(210)]),/row-level security/);
});
console.log(`${passed} contractor search SQL scenarios passed`);
await db.close();
