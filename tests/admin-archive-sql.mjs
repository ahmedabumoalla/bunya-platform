// Isolated PostgreSQL snapshot/activation integration; never connects to Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.query || ''); process.exit(1); });
const db = new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actors=['7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'];
const owner='8b9f3886-e1b8-4816-9fbb-d425b0753255', customer=id(4);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async(actor=null,role='postgres',headers={})=>{
  await db.exec(`reset role; set local role ${role}`);
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.headers',$2,true)",[JSON.stringify({sub:actor,role}),JSON.stringify(headers)]);
};
async function denied(body){await db.exec('savepoint denied');try{await assert.rejects(body,error=>error.code==='42501');}finally{await db.exec('rollback to savepoint denied');}}
let passed=0;
async function test(name,body){await db.exec('begin');try{await body();passed++;console.log(`PASS ${name}`);}finally{await db.exec('rollback');}}
const base=readFileSync('supabase/migrations/001_bunya_production_schema.sql','utf8');
const originalFunction=name=>{const found=base.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];assert.ok(found,name);return found;};
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
create schema auth;create schema storage;create schema private;create schema realtime;
create table realtime.subscription(id bigint primary key,claims jsonb);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,last_sign_in_at timestamptz,created_at timestamptz,updated_at timestamptz,phone text,aud text,role text,encrypted_password text,raw_app_meta_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid);
create table profiles(id uuid primary key references auth.users,role text,is_active boolean default true,must_change_password boolean default false,full_name text,email text,password_changed_at timestamptz,temporary_password_expires_at timestamptz,updated_at timestamptz);
create table provider_drivers(id uuid primary key,must_change_password boolean,status text,updated_at timestamptz);
create table provider_driver_accounts(id uuid primary key,driver_id uuid,auth_user_id uuid);
create table audit_logs(id uuid primary key default gen_random_uuid(),actor_profile_id uuid,entity_table text,entity_id uuid,action text,new_data jsonb);
create table user_roles(profile_id uuid references profiles,role text,is_primary boolean default true,revoked_at timestamptz,primary key(profile_id,role));
create table admin_roles(id uuid primary key,role_key text,name_ar text);
create table admin_users(id uuid primary key,profile_id uuid unique references profiles,role_id uuid references admin_roles,is_active boolean default true);
create table admin_permissions(id uuid primary key,permission_key text);
create table admin_role_permissions(role_id uuid references admin_roles,permission_id uuid references admin_permissions,primary key(role_id,permission_id));
create table items(id uuid primary key,owner_id uuid references profiles,title text,amount numeric,metadata jsonb);
create table item_parts(item_id uuid references items,part integer,label text,primary key(item_id,part));
create table notifications(id uuid primary key,profile_id uuid references profiles,title text,read_at timestamptz,expires_at timestamptz);
create table push_subscriptions(id uuid primary key,profile_id uuid references profiles,token text,active boolean);
create table contractor_profiles(id uuid primary key,profile_id uuid references profiles,display_name text);
create table contractor_conversations(id uuid primary key,title text);
create table outbox_events(id uuid primary key,event_type text,payload jsonb);
create table onboarding_password_fingerprints(profile_id uuid primary key,password_fingerprint text);
create table managed_quote_delivery_codes(id uuid primary key,code_ciphertext text);
create table join_application_revision_tokens(id uuid primary key,token_hash text);
create table provider_upload_batches(id uuid primary key,token_hash text);
create table admin_impersonation_sessions(id uuid primary key,actor_profile_id uuid,target_profile_id uuid,actor_auth_session_id uuid,target_auth_session_id uuid,expires_at timestamptz,ended_at timestamptz);
create table pending_quote_drafts(token_hash text primary key,payload jsonb);
create table phone_verification_challenges(id uuid primary key,code_hash text);
create table storage.objects(id uuid primary key,bucket_id text,name text,metadata jsonb,updated_at timestamptz);
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,aud,role,encrypted_password,raw_app_meta_data)
values('${actors[0]}','one@example.invalid',now(),now(),now(),'authenticated','authenticated','never-copy-password','{"secret":"never-copy"}'),('${actors[1]}','two@example.invalid',now(),now(),now(),'authenticated','authenticated','never-copy-password','{}'),('${owner}','owner@example.invalid',now(),now(),now(),'authenticated','authenticated','never-copy-password','{}'),('${customer}','customer@example.invalid',now(),now(),now(),'authenticated','authenticated','never-copy-password','{}');
insert into profiles(id,role,full_name,email) select id,case when id='${customer}' then 'customer' else 'admin' end,email,email from auth.users;
insert into user_roles(profile_id,role) select id,role from profiles;
insert into admin_roles values('${id(10)}','super_admin','Administrator');
insert into admin_users select id,id,'${id(10)}',true from profiles where role='admin';
insert into admin_permissions values('${id(11)}','profiles.read'),('${id(12)}','finance.manage'),('${id(13)}','roles.manage'),('${id(14)}','admins.manage'),('${id(15)}','audit.read'),('${id(16)}','projects.manage');
insert into items values('${id(21)}','${customer}','Original item',10,'{"label":"retained","access_token":"never-copy","nested":{"password":"never-copy","safe":true}}');
insert into item_parts values('${id(21)}',1,'Original part');
insert into notifications values('${id(31)}','${actors[0]}','Original notification',null,null),('${id(32)}','${actors[1]}','Other original',null,null);
insert into push_subscriptions values('${id(41)}','${actors[0]}','never-copy-push-token',true),('${id(42)}','${actors[1]}','never-copy-push-token',true);
insert into contractor_profiles values('${id(51)}','${customer}','Original contractor');
insert into contractor_conversations values('${id(52)}','Original conversation');
insert into outbox_events values('${id(61)}','original.event','{"body":"password embedded in text"}');
insert into onboarding_password_fingerprints values('${customer}','never-copy');
insert into managed_quote_delivery_codes values('${id(62)}','never-copy');
insert into join_application_revision_tokens values('${id(63)}','never-copy');
insert into provider_upload_batches values('${id(64)}','never-copy');
insert into pending_quote_drafts values('never-copy','{}');
insert into phone_verification_challenges values('${id(65)}','never-copy');
insert into auth.sessions values('${id(71)}','${owner}');
insert into storage.objects values('${id(81)}','documents','original.pdf','{"size":5}',now());
insert into realtime.subscription values(1,jsonb_build_object('sub','${actors[0]}')), (2,jsonb_build_object('sub','${actors[1]}')), (3,jsonb_build_object('sub','${owner}'));
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant select on storage.objects to authenticated;
`);
await db.exec(originalFunction('is_admin'));await db.exec(originalFunction('admin_has_permission'));
for(const table of ['profiles','user_roles','admin_users','admin_roles','admin_permissions','admin_role_permissions','items','item_parts','notifications','push_subscriptions','contractor_profiles','contractor_conversations','outbox_events','onboarding_password_fingerprints','managed_quote_delivery_codes','join_application_revision_tokens','provider_upload_batches','admin_impersonation_sessions']){
  await db.exec(`alter table public.${table} enable row level security`);
  if(!['profiles','user_roles','admin_users'].includes(table))await db.exec(`create policy original_read on public.${table} for all to authenticated using(public.is_admin()) with check(public.is_admin())`);
}
for(const name of ['profiles_select_own_or_admin','profiles_update_own_or_admin','user_roles_own_read','user_roles_admin_manage','admin_users_read','admin_users_super_manage']){
  const initial=base.match(new RegExp(`create policy ${name} on [^;]+;`))?.[0];assert.ok(initial,name);
  await db.exec([initial,...[...base.matchAll(new RegExp(`alter policy ${name} on [^;]+;`,'g'))].map(m=>m[0])].join('\n'));
}
await db.exec(`drop policy original_read on notifications;create policy original_read on notifications for all to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
alter table storage.objects enable row level security;create policy original_read on storage.objects for select to authenticated using(public.is_admin());
create function public.admin_attention_counts() returns jsonb language sql stable security invoker as $$select jsonb_build_object('items',(select count(*) from public.items),'notifications',(select count(*) from public.notifications))$$;
create function public.admin_provider_financial_summary() returns table(total numeric,company_name text) language sql stable security invoker as $$select sum(amount),'Original company'::text from public.items$$;
create function public.contractor_directory_cards() returns table(id uuid,display_name text) language sql stable security invoker as $$select id,display_name from public.contractor_profiles$$;
create function public.contractor_chat_summary(p_id uuid) returns jsonb language sql stable security invoker as $$select to_jsonb(c) from public.contractor_conversations c where id=p_id$$;
`);
await db.exec(readFileSync('supabase/migrations/098_restrict_admin_directory.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/101_admin_frozen_archive.sql','utf8'));
for(const [file,name] of [['100_delegated_onboarding_access.sql','impersonation_participants_allowed'],['083_super_admin_impersonation.sql','validate_admin_impersonation']]){
  const source=readFileSync(`supabase/migrations/${file}`,'utf8');
  const definition=source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];assert.ok(definition,name);await db.exec(definition);
}
const onboardingSql=readFileSync('supabase/migrations/089_onboarding_temporary_password_24_hours.sql','utf8');
await db.exec(onboardingSql.match(/create or replace function public\.complete_temporary_password_change\([\s\S]*?\$\$;/)[0]);
await db.exec('revoke all on function public.complete_temporary_password_change() from public,anon;grant execute on function public.complete_temporary_password_change() to authenticated');
const apiSafeUpdates=readFileSync('supabase/migrations/102_admin_archive_api_safe_updates.sql','utf8');
await db.exec(apiSafeUpdates);
await db.exec(readFileSync('supabase/migrations/103_admin_archive_password_lifecycle.sql','utf8'));
await db.exec("alter role authenticator set pgrst.db_schemas='admin_archive, graphql_public, public';alter role authenticator set pgrst.db_pre_request='public.guard_admin_archive_request'");
await db.exec(readFileSync('supabase/migrations/104_admin_archive_schema_order.sql','utf8'));
// PGlite has no managed safeupdate preload; require its essential predicate rule
// on every DML statement in the replacement control functions as well.
for(const statement of apiSafeUpdates.matchAll(/\b(?:update|delete from)\s+(?:private|public|realtime)\.[a-z_]+\b[^;]*;/g))assert.match(statement[0],/\bwhere\b/i);
await test('schema configuration preserves first input occurrence and repairs default without activation or hook changes',async()=>{
  const config=()=>scalar("select rolconfig from pg_roles where rolname='authenticator'");
  const repaired=await config();
  assert.ok(repaired.includes('pgrst.db_schemas=public, graphql_public, admin_archive'));
  assert.ok(repaired.includes('pgrst.db_pre_request=public.guard_admin_archive_request'));
  assert.equal(await scalar('select api_ready or active from private.admin_archive_state'),false);
  assert.equal(await scalar('select previous_pre_request from private.admin_archive_state'),null);
  await scalar('select public.configure_admin_archive_api($1,$2)',[' public, graphql_public,public, ,graphql_public ',null]);
  assert.ok((await config()).includes('pgrst.db_schemas=public, graphql_public, admin_archive'));
  await scalar('select public.configure_admin_archive_api($1,$2)',['graphql_public,public,graphql_public',null]);
  assert.ok((await config()).includes('pgrst.db_schemas=graphql_public, public, admin_archive'));
  await scalar('select public.configure_admin_archive_api($1,$2)',['public,admin_archive,graphql_public,admin_archive',null]);
  assert.ok((await config()).includes('pgrst.db_schemas=public, admin_archive, graphql_public'));
  assert.equal(await scalar('select active from private.admin_archive_state'),false);
});
await test('schema repair refuses an unrecognized inventory rather than dropping exposed schemas',async()=>{
  await db.exec("alter role authenticator set pgrst.db_schemas='public, graphql_public, admin_archive, another_app'");
  await assert.rejects(()=>db.exec(readFileSync('supabase/migrations/104_admin_archive_schema_order.sql','utf8')),/Unexpected exposed schema inventory/);
});
await test('setup is inert until explicit capture/files/config activation',async()=>{
  await as(actors[0],'authenticated');assert.equal((await scalar('select public.admin_archive_status()')).active,false);
  assert.equal(await scalar('select count(*)::int from items'),1);
  await as(null,'service_role');await denied(()=>scalar('select public.activate_admin_archive(now())'));
});
await db.exec(readFileSync('scripts/capture-admin-archive.sql','utf8'));
const cutoff=await scalar('select captured_at from private.admin_archive_state');
await test('capture includes original state and excludes secrets without activation',async()=>{
  assert.equal(await scalar('select active from private.admin_archive_state'),false);
  assert.equal(await scalar('select title from admin_archive.items'),'Original item');
  assert.deepEqual(await scalar('select metadata from admin_archive.items'),{label:'retained',nested:{safe:true}});
  assert.deepEqual(await scalar('select payload from admin_archive.outbox_events'),{});
  for(const table of ['onboarding_password_fingerprints','managed_quote_delivery_codes','join_application_revision_tokens','provider_upload_batches','admin_impersonation_sessions','pending_quote_drafts','phone_verification_challenges','push_subscriptions'])assert.equal(await scalar(`select count(*)::int from admin_archive.${table}`),0);
  const authColumns=await rows("select column_name from information_schema.columns where table_schema='admin_archive' and table_name='safe_auth_users'");
  assert.ok(!authColumns.some(c=>/password|metadata|token/.test(c.column_name)));
  assert.equal(await scalar("select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='admin_archive' and c.contype='f' and c.confrelid in(select oid from pg_class where relnamespace='public'::regnamespace)"),0,'archive joins never reference public');
});
await test('activation requires exact complete verified files and API configuration',async()=>{
  await as(null,'service_role');await denied(()=>scalar('select public.activate_admin_archive($1)',[cutoff]));
  await assert.rejects(()=>scalar('select public.admin_archive_mark_files_ready($1,$2)',[cutoff,[]]),/incomplete/);
});
await db.query('select public.configure_admin_archive_api($1,$2)',['public, graphql_public',null]);
const fileManifest=[{object_id:id(81),bucket_id:'admin-archive',name:'documents/original.pdf',sha256:'a'.repeat(64)}];
for(const [name,setup,manifest] of [
  ['requires content checksum','',fileManifest.map(entry=>({object_id:entry.object_id,bucket_id:entry.bucket_id,name:entry.name}))],
  ['requires destination object','',fileManifest],
  ['rejects destination size mismatch',`insert into storage.objects values('${id(82)}','admin-archive','documents/original.pdf','{"size":6}',now())`,fileManifest],
  ['rejects changed source',`insert into storage.objects values('${id(82)}','admin-archive','documents/original.pdf','{"size":5}',now());update storage.objects set updated_at=updated_at+interval '1 second' where id='${id(81)}'`,fileManifest],
])await test(`file readiness ${name}`,async()=>{if(setup)await db.exec(setup);await assert.rejects(()=>db.query('select public.admin_archive_mark_files_ready($1,$2)',[cutoff,manifest]));});
await db.exec(`insert into storage.objects values('${id(82)}','admin-archive','documents/original.pdf','{"size":5}',now())`);
await db.query('select public.admin_archive_mark_files_ready($1,$2)',[cutoff,[{object_id:id(81),bucket_id:'admin-archive',name:'documents/original.pdf',sha256:'a'.repeat(64)}]]);
await db.query('select public.activate_admin_archive($1)',[cutoff]);
// Insert/update/delete AFTER capture: archived joins, aggregates and notifications must not drift.
await db.exec(`update items set title='Changed live item',amount=999;insert into items values('${id(22)}','${customer}','New live item',50,'{}');update item_parts set label='Changed live part';update contractor_conversations set title='Changed live conversation';update notifications set title='Changed live notification';insert into notifications values('${id(33)}','${actors[0]}','New forbidden notification',null,null);update storage.objects set metadata='{"size":999}';`);
for(const actor of actors)await test(`frozen actor ${actor.slice(0,8)} keeps old rows/joins/RPCs and loses all live business data`,async()=>{
  await as(actor,'authenticated');const status=await scalar('select public.admin_archive_status()');assert.equal(status.active,true);assert.equal(status.eligible,true);
  assert.equal(await scalar('select count(*)::int from public.items'),0);
  assert.equal(await scalar('select count(*)::int from public.profiles'),1);
  assert.equal(await scalar('select count(*)::int from admin_archive.profiles'),2,'own profile and customer, existing098 excludes otheradmins');
  assert.equal(await scalar('select title from admin_archive.items'),'Original item');
  assert.equal(await scalar('select label from admin_archive.item_parts join admin_archive.items on item_id=items.id'),'Original part');
  assert.deepEqual(await scalar('select admin_archive.admin_attention_counts()'),{items:1,notifications:1});
  assert.deepEqual(await scalar('select admin_archive.admin_provider_financial_summary()'),[{total:10,company_name:'Original company'}]);
  assert.equal((await scalar('select admin_archive.contractor_chat_summary($1)',[id(52)])).title,'Original conversation');
  assert.equal(await scalar("select admin_archive.admin_has_permission('profiles.read')"),true);
  assert.equal(await scalar("select admin_archive.admin_has_permission('audit.read')"),false);
  assert.equal(await scalar('select count(*)::int from admin_archive.notifications'),1);
  assert.equal(await scalar('select count(*)::int from storage.objects'),0);
  await denied(()=>db.exec("update admin_archive.items set title='write'"));
  assert.deepEqual(await rows("update profiles set full_name='write' returning id"),[]);
});
await test('ordinary users cannot query another actor archive; forged actor header is ignored',async()=>{
  await as(customer,'authenticated',{'x-bunya-archive-actor':actors[0]});
  assert.equal(await scalar('select count(*)::int from admin_archive.items'),0);
  await denied(()=>scalar('select admin_archive.admin_attention_counts()'));
});
await test('trusted service API retains only captured safe data with explicit actor context',async()=>{
  await as(null,'service_role',{'x-bunya-archive-actor':actors[0]});
  assert.equal(await scalar('select title from admin_archive.items'),'Original item');
  assert.deepEqual(await scalar('select admin_archive.admin_provider_financial_summary()'),[{total:10,company_name:'Original company'}]);
  assert.equal((await scalar('select public.admin_archive_actor_status($1)',[actors[0]])).eligible,true);
  assert.deepEqual(await scalar('select public.admin_archive_storage_location($1,$2,$3)',[actors[0],'documents','original.pdf']),{bucket_id:'admin-archive',name:'documents/original.pdf'});
  await denied(()=>db.exec("insert into admin_archive.items(id,title) values(gen_random_uuid(),'write')"));
});
await test('new notifications suppressed, push recipients disabled, delegation retained',async()=>{
  assert.equal(await scalar(`select count(*)::int from notifications where id='${id(33)}'`),0);
  assert.equal(await scalar('select count(*)::int from push_subscriptions where active'),0);
  assert.equal(await scalar('select count(*)::int from admin_users where is_active'),1);
  assert.equal(await scalar('select private.admin_impersonation_target_allowed($1,$2,$3)',[owner,id(71),actors[0]]),true);
});
await test('frozen Realtime subscriptions are removed and cannot be recreated, including DELETE subscriptions',async()=>{
  assert.equal(await scalar('select count(*)::int from realtime.subscription'),1);
  for(const actor of actors)assert.deepEqual(await rows('insert into realtime.subscription(id,claims) values(9,jsonb_build_object(\'sub\',$1::text)) returning id',[actor]),[]);
  assert.equal((await rows('insert into realtime.subscription(id,claims) values(10,jsonb_build_object(\'sub\',$1::text)) returning id',[customer])).length,1);
  assert.deepEqual(await rows('update realtime.subscription set claims=jsonb_build_object(\'sub\',$1::text) where id=10 returning id',[actors[0]]),[]);
  assert.equal(await scalar('select count(*)::int from realtime.subscription where id=10'),0,'JWT switch must not retain previous actor subscription');
});
await test('pre-request blocks all live RPCs/GraphQL/business paths but permits archive and identity',async()=>{
  for(const [path,method,profile,allowed] of [['/rpc/new_definer','POST','public',false],['/rpc/graphql','POST','graphql_public',false],['/items','GET','public',false],['/profiles','PATCH','public',false],['/items','GET','admin_archive',true],['/rpc/admin_attention_counts','POST','admin_archive',true],['/rpc/admin_archive_status','POST','public',true],['/profiles','GET','public',true]]){
    await as(actors[0],'authenticated',{'accept-profile':profile,'content-profile':profile});await db.query("select set_config('request.path',$1,true),set_config('request.method',$2,true)",[path,method]);
    if(allowed)await scalar('select public.guard_admin_archive_request()');else await denied(()=>scalar('select public.guard_admin_archive_request()'));
  }
  for(const method of ['POST','GET']){
    await as(actors[0],'authenticated',method==='POST'?{'accept-profile':'admin_archive','content-profile':'public'}:{'accept-profile':'public','content-profile':'admin_archive'});
    await db.query("select set_config('request.path','/rpc/new_definer',true),set_config('request.method',$1,true)",[method]);
    await denied(()=>scalar('select public.guard_admin_archive_request()'));
  }
  await as(null,'anon');await scalar('select public.guard_admin_archive_request()');
});
await test('profile suspension closes archive access without restoring live visibility',async()=>{
  await db.query('update profiles set is_active=false where id=$1',[actors[0]]);await as(actors[0],'authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false);
  assert.equal(await scalar('select count(*)::int from admin_archive.items'),0);assert.equal(await scalar('select count(*)::int from public.items'),0);
});
await test('live forced password reset blocks normal archive sessions but permits an exact valid owner delegation',async()=>{
  await db.query('update profiles set must_change_password=true where id=$1',[actors[0]]);
  await as(actors[0],'authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false);
  assert.equal(await scalar('select count(*)::int from admin_archive.items'),0);
  await denied(()=>scalar('select admin_archive.admin_attention_counts()'));
  await as(null,'service_role');
  assert.equal((await scalar('select public.admin_archive_actor_status($1)',[actors[0]])).requires_password_change,true);
  await as();
  await db.query('insert into auth.sessions values($1,$2)',[id(91),actors[0]]);
  await db.query('insert into admin_impersonation_sessions values($1,$2,$3,$4,$5,now()+interval \'15 minutes\',null)',[id(92),owner,actors[0],id(71),id(91)]);
  await as(actors[0],'authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false,'grant does not authorize an unrelated session');
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actors[0],role:'authenticated',session_id:id(91)})]);
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,true);
  assert.equal(await scalar('select count(*)::int from admin_archive.items'),1);
  assert.equal((await scalar('select admin_archive.admin_attention_counts()')).items,1);
  await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[owner]);await db.exec('set local role authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false,'revoked operator closes delegated access');
  await db.exec('reset role');await db.query('update profiles set is_active=true where id=$1',[owner]);
  await db.query("update admin_impersonation_sessions set expires_at=now()-interval '1 second' where id=$1",[id(92)]);await db.exec('set local role authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false,'expired delegation closes access');
  await db.exec('reset role');await db.query("update admin_impersonation_sessions set expires_at=now()+interval '15 minutes' where id=$1",[id(92)]);await db.exec('set local role authenticated');
  await db.exec('reset role');await db.query('update admin_impersonation_sessions set ended_at=now() where id=$1',[id(92)]);await db.exec('set local role authenticated');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false);
  assert.equal(await scalar('select count(*)::int from admin_archive.items'),0);
});
await test('ordinary frozen account completes its own live password lifecycle without granting live business access',async()=>{
  await db.query('update profiles set must_change_password=true where id=$1',[actors[0]]);
  await as(actors[0],'authenticated',{'content-profile':'public','accept-profile':'public'});
  await db.query("select set_config('request.path','/profiles',true),set_config('request.method','GET',true)");
  await scalar('select public.guard_admin_archive_request()');
  const live=await rows('select id,must_change_password from public.profiles');
  assert.deepEqual(live,[{id:actors[0],must_change_password:true}]);
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,false);
  await db.query("select set_config('request.path','/rpc/complete_temporary_password_change',true),set_config('request.method','POST',true)");
  await scalar('select public.guard_admin_archive_request()');await scalar('select public.complete_temporary_password_change()');
  assert.equal((await scalar('select public.admin_archive_status()')).eligible,true);
  assert.equal(await scalar('select must_change_password from public.profiles'),false);
  assert.equal(await scalar('select count(*)::int from public.items'),0);
  await db.query("select set_config('request.path','/rpc/new_business_mutation',true)");await denied(()=>scalar('select public.guard_admin_archive_request()'));
  await as();assert.equal(await scalar("select count(*)::int from audit_logs where action='temporary_password_changed'"),1);
});
await test('frozen delegated target cannot complete password lifecycle even with a valid grant',async()=>{
  await db.query('insert into auth.sessions values($1,$2)',[id(93),actors[0]]);
  await db.query('insert into admin_impersonation_sessions values($1,$2,$3,$4,$5,now()+interval \'15 minutes\',null)',[id(94),owner,actors[0],id(71),id(93)]);
  await as(actors[0],'authenticated',{'content-profile':'public'});
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.path','/rpc/complete_temporary_password_change',true),set_config('request.method','POST',true)",[JSON.stringify({sub:actors[0],role:'authenticated',session_id:id(93)})]);
  await denied(()=>scalar('select public.guard_admin_archive_request()'));
});
await db.close();console.log(`Admin archive SQL PASS: ${passed} groups.`);
