// Isolated PostgreSQL regression: no live credentials, Auth calls, or database writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = '8b9f3886-e1b8-4816-9fbb-d425b0753255';
const expired = id(2), pending = id(3), customer = id(4), administrator = id(5), otherSuper = id(6);
const actorSession = id(11), targetSession = id(12), pendingSession = id(13), customerSession = id(14), adminSession = id(15), otherSession = id(16);
const grant = id(21), nonce = 'a'.repeat(64), hash = createHash('sha256').update(nonce).digest('hex');
const prefix = 'bunya-maintenance/';
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const role = async name => db.exec(`reset role; set local role ${name}`);
const claims = async (sub = null, session = null, jwtRole = 'authenticated') => db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub, session_id: session, role: jwtRole })]);
const event = (target = expired, session = targetSession, method = 'otp', exp = Math.floor(Date.now() / 1000) + 3600) => ({
  user_id: target, authentication_method: method,
  claims: { sub: target, session_id: session, role: 'authenticated', exp, iat: Math.floor(Date.now() / 1000), aud: 'authenticated', iss: 'fixture', aal: 'aal1', email: 'fixture@example.invalid', phone: '', is_anonymous: false, user_metadata: { ordinary: true } },
});
const prepare = async (target = expired, requestId = grant, operator = actor, session = actorSession, nonceHash = hash) => {
  await role('service_role');
  return scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)', [requestId, operator, session, target, nonceHash]);
};
const hook = async (input = event()) => {
  await role('supabase_auth_admin');
  return scalar('select public.onboarding_access_token_hook($1)', [input]);
};
async function denied(body, code = '42501') {
  await db.exec('savepoint denied_operation');
  try { await assert.rejects(body, error => error.code === code); }
  finally { await db.exec('rollback to savepoint denied_operation'); }
}
let passed = 0;
async function test(name, body) {
  await db.exec('begin');
  try { await claims(); await body(); passed++; console.log(`PASS ${name}`); }
  finally { await db.exec('rollback'); }
}
const migration = number => readFileSync(`supabase/migrations/${number}`, 'utf8');
const base = migration('001_bunya_production_schema.sql');
const functionSql = (source, name) => {
  const sql = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
  assert.ok(sql, name);
  return sql;
};

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
create schema auth; create schema private;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table auth.sessions(id uuid primary key,user_id uuid not null,user_agent text);
create table auth.users(id uuid primary key,encrypted_password text);
create table profiles(id uuid primary key,role text not null,is_active boolean default true,must_change_password boolean default false,temporary_password_expires_at timestamptz,temporary_password_issued_at timestamptz,password_changed_at timestamptz);
create table user_roles(profile_id uuid references profiles,role text,is_primary boolean default true,revoked_at timestamptz);
create table admin_roles(id uuid primary key,role_key text);
create table admin_users(id uuid primary key,profile_id uuid references profiles,role_id uuid references admin_roles,is_active boolean default true);
create table audit_logs(id bigint generated always as identity primary key,actor_profile_id uuid references profiles,entity_table text not null,entity_id text not null,action text not null,old_data jsonb,new_data jsonb,occurred_at timestamptz default now(),reason text,sensitivity text default 'normal');
create table example_operation(id uuid primary key,note text);
insert into profiles(id,role,must_change_password,temporary_password_expires_at,temporary_password_issued_at) values
('${actor}','admin',false,null,null),('${expired}','provider',true,now()-interval '1 hour',now()-interval '25 hours'),
('${pending}','contractor',true,now()+interval '10 minutes',now()-interval '23 hours 50 minutes'),
('${customer}','customer',false,null,null),('${administrator}','admin',true,null,null),('${otherSuper}','admin',false,null,null);
insert into user_roles(profile_id,role) select id,role from profiles;
insert into auth.users select id,'unchanged-password-fingerprint-fixture' from profiles;
insert into admin_roles values('${id(31)}','super_admin');
insert into admin_users values('${id(41)}','${actor}','${id(31)}',true),('${id(45)}','${administrator}','${id(31)}',true),('${id(46)}','${otherSuper}','${id(31)}',true);
insert into auth.sessions values('${actorSession}','${actor}','original-browser'),('${targetSession}','${expired}','${prefix}${nonce}'),('${pendingSession}','${pending}','${prefix}${nonce}'),('${customerSession}','${customer}','${prefix}${nonce}'),('${adminSession}','${administrator}','${prefix}${nonce}'),('${otherSession}','${otherSuper}','other-browser'),('${id(22)}','${expired}','${prefix}${nonce}'),('${id(23)}','${expired}','ordinary-browser');
grant usage on schema public to authenticated,anon,service_role,supabase_auth_admin;
grant select(id,role,must_change_password,temporary_password_expires_at) on profiles to supabase_auth_admin;
alter table profiles enable row level security;
create policy profiles_auth_onboarding_hook_select on profiles for select to supabase_auth_admin using(true);
`);
await db.exec(functionSql(base, 'audit_sensitive_row'));
await db.exec(functionSql(base, 'prevent_audit_mutation'));
await db.exec('create trigger audit_logs_immutable before update or delete on audit_logs for each row execute function public.prevent_audit_mutation()');
await db.exec(migration('083_super_admin_impersonation.sql'));
await db.exec(migration('099_exclusive_owner_impersonation.sql'));
const originalHook = functionSql(migration('089_onboarding_temporary_password_24_hours.sql'), 'onboarding_access_token_hook');
await db.exec(originalHook);
await db.exec('revoke all on function public.onboarding_access_token_hook(jsonb) from public,anon,authenticated,service_role; grant execute on function public.onboarding_access_token_hook(jsonb) to supabase_auth_admin');
const normalInputs = [event(expired,id(23),'password'), event(expired,id(23),'token_refresh'), event(pending,pendingSession,'password'), event(customer,customerSession,'password')];
const previousNormal = [];
for (const input of normalInputs) previousNormal.push(await scalar('select public.onboarding_access_token_hook($1)', [input]));
await db.exec(migration('100_delegated_onboarding_access.sql'));

await test('normal onboarding login and refresh behavior matches original089 exactly', async () => {
  for (const [index, input] of normalInputs.entries()) assert.deepEqual(await hook(input), previousNormal[index]);
});
await test('service-only preparation, private requests, and Auth-only hook permissions', async () => {
  for (const caller of ['anon','authenticated']) {
    for (const operation of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(await scalar(`select has_table_privilege('${caller}','private.admin_impersonation_mint_requests','${operation}')`), false);
    for (const signature of ['public.prepare_admin_impersonation(uuid,uuid,uuid,uuid,text)','public.cancel_admin_impersonation_prepare(uuid)','public.onboarding_access_token_hook(jsonb)','private.consume_admin_impersonation_mint(jsonb)','private.admin_impersonation_target_allowed(uuid,uuid,uuid)']) assert.equal(await scalar(`select has_function_privilege('${caller}','${signature}','EXECUTE')`), false);
  }
  for (const operation of ['SELECT','DELETE']) assert.equal(await scalar(`select has_table_privilege('service_role','private.admin_impersonation_mint_requests','${operation}')`), true);
  for (const operation of ['INSERT','UPDATE']) assert.equal(await scalar(`select has_table_privilege('service_role','private.admin_impersonation_mint_requests','${operation}')`), false);
  assert.equal(await scalar("select has_table_privilege('supabase_auth_admin','private.admin_impersonation_mint_requests','SELECT')"), false, 'Auth consumes via narrow private function only');
  assert.equal(await scalar("select has_function_privilege('service_role','private.consume_admin_impersonation_mint(jsonb)','EXECUTE')"), false);
  assert.equal(await scalar("select has_function_privilege('supabase_auth_admin','private.consume_admin_impersonation_mint(jsonb)','EXECUTE')"), true);
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.admin_impersonation_mint_requests'::regclass"), true);
  await role('authenticated');
  await denied(() => scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)', [grant,actor,actorSession,expired,hash]));
  await role('anon');
  await denied(() => scalar('select public.onboarding_access_token_hook($1)', [event()]));
});
for (const [name, target, session] of [['expired provider',expired,targetSession],['pending contractor',pending,pendingSession],['pending admin',administrator,adminSession],['normal customer',customer,customerSession]]) {
  await test(`one-use authorization opens ${name} without changing password metadata`, async () => {
    const before = await rows('select * from profiles order by id');
    const passwords = await rows('select * from auth.users order by id');
    await prepare(target);
    const input = event(target,session);
    const result = await hook(input);
    assert.ok(result.claims && !result.error);
    assert.deepEqual({ ...result.claims, exp: input.claims.exp }, input.claims, 'all other token claims unchanged');
    assert.ok(result.claims.exp <= Math.floor(Date.now()/1000)+900);
    assert.ok(result.claims.exp > Math.floor(Date.now()/1000)+850);
    await role('postgres');
    assert.deepEqual(await rows('select * from profiles order by id'), before);
    assert.deepEqual(await rows('select * from auth.users order by id'), passwords);
    const bound = (await rows('select * from admin_impersonation_sessions where id=$1',[grant]))[0];
    assert.equal(bound.actor_profile_id,actor);
    assert.equal(bound.target_profile_id,target);
    assert.equal(bound.target_auth_session_id,session);
    assert.equal(bound.reason,'دخول إداري بالنيابة');
    assert.equal(Math.floor(new Date(bound.expires_at).getTime()/1000),result.claims.exp);
    assert.equal(await scalar('select public.validate_admin_impersonation($1,$2,$3)',[grant,actor,actorSession]),true);
    const audit = (await rows("select * from audit_logs where action='maintenance_started'"))[0];
    assert.equal(audit.actor_profile_id,target); assert.equal(audit.delegated_by_profile_id,actor); assert.equal(audit.impersonation_session_id,grant);
    const request = (await rows('select * from private.admin_impersonation_mint_requests where id=$1',[grant]))[0];
    assert.equal(request.nonce_hash,hash); assert.equal(request.consumed_session_id,session);
    assert.equal(JSON.stringify(request).includes(nonce),false,'raw nonce never stored in private request');
  });
}
await test('initial token expiration is never extended', async () => {
  await prepare(); const input=event(expired,targetSession,'magiclink',Math.floor(Date.now()/1000)+120);
  assert.equal((await hook(input)).claims.exp,input.claims.exp);
});
await test('nonce absence, arbitrary nonce, and editable metadata cannot bypass expiration', async () => {
  await prepare();
  assert.equal((await hook(event(expired,id(23)))).error.http_code,403);
  await role('postgres'); await db.exec(`update auth.sessions set user_agent='${prefix}${'b'.repeat(64)}' where id='${targetSession}'`);
  const input=event(); input.claims.user_metadata={nonce,maintenance:true};
  assert.equal((await hook(input)).error.http_code,403);
  await role('postgres'); assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),0);
});
await test('ordinary login stays blocked while a pending authorization exists', async () => {
  await prepare();
  for (const method of ['password','token_refresh','oauth']) assert.equal((await hook(event(expired,id(23),method))).error.http_code,403);
  await role('postgres'); assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),0);
});
await test('password and refresh methods cannot consume even the exact nonce', async () => {
  await prepare();
  for (const method of ['password','token_refresh']) assert.equal((await hook(event(expired,targetSession,method))).error.http_code,403);
  await role('postgres'); assert.equal(await scalar('select consumed_at is null from private.admin_impersonation_mint_requests where id=$1',[grant]),true);
});
await test('expired mint authorization fails closed', async () => {
  await prepare(); await role('postgres');
  await db.exec(`update private.admin_impersonation_mint_requests set created_at=now()-interval '3 minutes',expires_at=now()-interval '2 minutes' where id='${grant}'`);
  await role('supabase_auth_admin'); await denied(() => scalar('select public.onboarding_access_token_hook($1)',[event()]));
});
await test('expired preparation can be replaced without widening the original deadline', async () => {
  await prepare(); await role('postgres');
  await db.exec(`update private.admin_impersonation_mint_requests set created_at=now()-interval '3 minutes',expires_at=now()-interval '2 minutes' where id='${grant}'`);
  await prepare(expired,id(25));
  assert.equal(await scalar('select count(*)::int from private.admin_impersonation_mint_requests'),1);
  assert.equal(await scalar('select id from private.admin_impersonation_mint_requests'),id(25));
  assert.equal(await scalar('select extract(epoch from expires_at-created_at)::int from private.admin_impersonation_mint_requests'),90);
  assert.ok((await hook()).claims);
});
await test('invalid token expiry cannot consume preparation or create a grant', async () => {
  await prepare(); await role('supabase_auth_admin');
  await denied(()=>scalar('select public.onboarding_access_token_hook($1)',[event(expired,targetSession,'otp',Math.floor(Date.now()/1000)-1)]));
  await role('postgres');
  assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),0);
  assert.equal(await scalar('select consumed_at is null from private.admin_impersonation_mint_requests where id=$1',[grant]),true);
});
await test('nonce cannot be used for a different target or mismatched session', async () => {
  await prepare(); await role('supabase_auth_admin');
  await denied(() => scalar('select public.onboarding_access_token_hook($1)',[event(customer,customerSession)]));
  assert.equal((await hook(event(expired,customerSession))).error.http_code,403);
});
await test('consumed nonce cannot mint a second session or refresh its existing session', async () => {
  await prepare(); await hook();
  for (const input of [event(expired,id(22)),event(),event(expired,targetSession,'token_refresh')]) {
    await role('supabase_auth_admin'); await denied(() => scalar('select public.onboarding_access_token_hook($1)',[input]));
  }
  await role('postgres'); assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),1);
});
await test('maintenance session cannot refresh even after password requirement clears', async () => {
  await prepare(); await hook(); await role('postgres');
  await db.exec(`update profiles set must_change_password=false where id='${expired}'`);
  await role('supabase_auth_admin'); await denied(() => scalar('select public.onboarding_access_token_hook($1)',[event(expired,targetSession,'token_refresh')]));
});
for (const [name, mutation] of [
  ['operator suspended',`update profiles set is_active=false where id='${actor}'`],
  ['operator password change required',`update profiles set must_change_password=true where id='${actor}'`],
  ['operator role revoked',`update user_roles set revoked_at=now() where profile_id='${actor}'`],
  ['operator membership disabled',`update admin_users set is_active=false where profile_id='${actor}'`],
  ['operator session revoked',`delete from auth.sessions where id='${actorSession}'`],
  ['target suspended',`update profiles set is_active=false where id='${expired}'`],
  ['target primary role revoked',`update user_roles set revoked_at=now() where profile_id='${expired}'`],
]) {
  await test(`prepare rejects ${name}`,async()=>{
    await db.exec(mutation); await role('service_role');
    await denied(()=>scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)',[grant,actor,actorSession,expired,hash]));
  });
  await test(`hook rechecks ${name} after preparation`,async()=>{
    await prepare(); await role('postgres'); await db.exec(mutation); await role('supabase_auth_admin');
    await denied(()=>scalar('select public.onboarding_access_token_hook($1)',[event()]));
    await role('postgres'); assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),0);
  });
}
await test('other super administrator, self-target, and mismatched original session are rejected',async()=>{
  await role('service_role');
  for (const args of [[grant,otherSuper,otherSession,expired,hash],[grant,actor,actorSession,actor,hash],[grant,actor,otherSession,expired,hash]]) await denied(()=>scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)',args));
});
await test('parallel preparations and nested grants are rejected',async()=>{
  await prepare(); await role('service_role');
  await denied(()=>scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)',[id(24),actor,actorSession,pending,'c'.repeat(64)]));
  await hook(); await role('service_role');
  await denied(()=>scalar('select public.prepare_admin_impersonation($1,$2,$3,$4,$5)',[id(24),actor,actorSession,pending,'c'.repeat(64)]));
});
await test('cancellation removes only preparation; bound grant and audit remain authoritative',async()=>{
  await prepare(); await hook(); await role('service_role');
  await scalar('select public.cancel_admin_impersonation_prepare($1)',[grant]);
  assert.equal(await scalar('select count(*)::int from private.admin_impersonation_mint_requests'),0);
  assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),1);
  await role('postgres'); assert.equal(await scalar("select count(*)::int from audit_logs where action='maintenance_started'"),1);
});
await test('cancelled pending request no longer bypasses ordinary token hook',async()=>{
  await prepare(); await scalar('select public.cancel_admin_impersonation_prepare($1)',[grant]);
  assert.equal((await hook()).error.http_code,403);
});
await test('grant and nonce consumption roll back atomically with failed Auth transaction',async()=>{
  await prepare(); await role('postgres'); await db.exec('savepoint auth_issuance');
  await hook(); await db.exec('rollback to savepoint auth_issuance'); await role('postgres');
  assert.equal(await scalar('select count(*)::int from admin_impersonation_sessions'),0);
  assert.equal(await scalar('select consumed_at is null from private.admin_impersonation_mint_requests where id=$1',[grant]),true);
  assert.equal(await scalar("select count(*)::int from audit_logs where action='maintenance_started'"),0);
  assert.ok((await hook()).claims);
});
await test('pending-password target mutations retain delegated provenance and expiry enforcement',async()=>{
  await prepare(); await hook(); await role('postgres'); await claims(expired,targetSession);
  await db.exec(`insert into example_operation values('${id(51)}','inspection'); update example_operation set note='maintenance' where id='${id(51)}'`);
  const audit=await rows("select * from audit_logs where entity_table='example_operation'");
  assert.equal(audit.length,2);
  for(const row of audit){assert.equal(row.actor_profile_id,expired);assert.equal(row.delegated_by_profile_id,actor);assert.equal(row.impersonation_session_id,grant);}
  await claims(); await db.exec(`update admin_impersonation_sessions set ended_at=statement_timestamp() where id='${grant}'`);
  await claims(expired,targetSession); await denied(()=>db.exec(`delete from example_operation where id='${id(51)}'`));
});
await db.close();
console.log(`Admin onboarding impersonation SQL PASS: ${passed} groups.`);
