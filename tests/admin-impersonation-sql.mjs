// Isolated PostgreSQL regression: no Supabase connection or production writes.
// Run: node tests/admin-impersonation-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uid(1), target = uid(2), other = uid(3), adminTarget = uid(4);
const actorSession = uid(11), targetSession = uid(12), otherSession = uid(13);
const grant = uid(21);
let passed = 0;
async function test(name, fn) {
  await db.exec('begin');
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  finally { await db.exec('rollback'); }
}
async function claims(sub = target, session = targetSession, role = 'authenticated', header = null) {
  await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.headers',$2,false)", [JSON.stringify({ sub, session_id: session, role }), JSON.stringify(header ? { 'x-bunya-impersonation': header } : {})]);
}
async function value(sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
async function denied(sql) { await assert.rejects(db.exec(sql), e => e.code === '42501' || e.code === '23514'); }
function startSql(id = grant, a = actor, t = target, as = actorSession, ts = targetSession) {
  return `insert into public.admin_impersonation_sessions(id,actor_profile_id,actor_auth_session_id,target_profile_id,target_auth_session_id,reason,expires_at) values('${id}','${a}','${as}','${t}','${ts}','Maintenance repair',now()+interval '15 minutes')`;
}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create table auth.sessions(id uuid primary key,user_id uuid not null);
create table public.profiles(id uuid primary key,is_active boolean not null default true,must_change_password boolean not null default false,role text not null);
create table public.user_roles(profile_id uuid references public.profiles,role text not null,is_primary boolean not null default true,revoked_at timestamptz);
create table public.admin_roles(id uuid primary key,role_key text not null);
create table public.admin_users(id uuid primary key,profile_id uuid references public.profiles,role_id uuid references public.admin_roles,is_active boolean not null default true);
create table public.audit_logs(id bigint generated always as identity primary key,actor_profile_id uuid references public.profiles,entity_table text not null,entity_id text not null,action text not null,old_data jsonb,new_data jsonb,occurred_at timestamptz not null default now(),reason text,sensitivity text not null default 'normal' check(sensitivity in ('normal','sensitive','critical')));
create table public.existing_audited(id uuid primary key,profile_id uuid references public.profiles,note text);
create table public.previously_unaudited(id uuid primary key,profile_id uuid references public.profiles,note text);
create table public.partially_audited(id uuid primary key,profile_id uuid references public.profiles,note text);
insert into profiles(id,role) values('${actor}','admin'),('${target}','customer'),('${other}','customer'),('${adminTarget}','admin');
insert into user_roles(profile_id,role) select id,role from profiles;
insert into admin_roles values('${uid(31)}','super_admin'),('${uid(32)}','support_admin');
insert into admin_users values('${uid(41)}','${actor}','${uid(31)}',true),('${uid(42)}','${adminTarget}','${uid(32)}',true);
insert into auth.sessions values('${actorSession}','${actor}'),('${targetSession}','${target}'),('${otherSession}','${other}'),('${uid(14)}','${adminTarget}');
`);
// Exercise the actual pre-existing production audit trigger, not a test substitute.
const original = await readFile(new URL('../supabase/migrations/001_bunya_production_schema.sql', import.meta.url), 'utf8');
const existingAudit = original.match(/create or replace function public\.audit_sensitive_row\(\)[\s\S]*?\n\$\$;/)?.[0];
assert.ok(existingAudit);
await db.exec(existingAudit);
await db.exec('create trigger existing_audit after insert or update or delete on public.existing_audited for each row execute function public.audit_sensitive_row()');
await db.exec('create trigger partial_audit after insert or update on public.partially_audited for each row execute function public.audit_sensitive_row()');
await db.exec(await readFile(new URL('../supabase/migrations/083_super_admin_impersonation.sql', import.meta.url), 'utf8'));

await test('only service role has table access and validation RPC access', async () => {
  for (const role of ['anon','authenticated']) {
    for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(await value(`select has_table_privilege('${role}','public.admin_impersonation_sessions','${privilege}')`),false);
    const functions = await db.query("select oid::regprocedure::text as name from pg_proc where pronamespace='public'::regnamespace and proname like '%impersonation%' or proname='audit_delegated_change'");
    for (const fn of functions.rows) assert.equal(await value(`select has_function_privilege('${role}','${fn.name}','EXECUTE')`),false,fn.name);
  }
  assert.equal(await value("select has_table_privilege('service_role','public.admin_impersonation_sessions','DELETE')"), false);
  assert.equal(await value("select has_function_privilege('service_role','public.validate_admin_impersonation(uuid,uuid,uuid)','EXECUTE')"), true);
  assert.equal(await value("select relrowsecurity from pg_class where oid='public.admin_impersonation_sessions'::regclass"), true);
});
await test('active super admin can start and lifecycle audit retains both identities', async () => {
  await db.exec(startSql());
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),true);
  const row = (await db.query("select * from audit_logs where action='maintenance_started'")).rows[0];
  assert.equal(row.actor_profile_id,target); assert.equal(row.delegated_by_profile_id,actor); assert.equal(row.impersonation_session_id,grant);
});
for (const [name, mutation] of [
  ['inactive operator',`update profiles set is_active=false where id='${actor}'`],
  ['operator requires password reset',`update profiles set must_change_password=true where id='${actor}'`],
  ['inactive admin membership',`update admin_users set is_active=false where profile_id='${actor}'`],
  ['revoked admin role',`update user_roles set revoked_at=now() where profile_id='${actor}'`],
  ['non-super operator',`update admin_users set role_id='${uid(32)}' where profile_id='${actor}'`],
  ['inactive target',`update profiles set is_active=false where id='${target}'`],
  ['password reset target',`update profiles set must_change_password=true where id='${target}'`],
  ['revoked target role',`update user_roles set revoked_at=now() where profile_id='${target}'`],
  ['target lacks primary role',`update user_roles set is_primary=false where profile_id='${target}'`],
  ['target with secondary admin role',`insert into user_roles values('${target}','admin',false,null)`],
]) await test(`rejects ${name}`, async () => { await db.exec(mutation); await denied(startSql()); });
await test('rejects an admin target', async () => { await denied(startSql(grant,actor,adminTarget,actorSession,uid(14))); });
await test('rejects self delegation', async () => { await denied(startSql(grant,actor,actor,actorSession,actorSession)); });
await test('rejects mismatched actor session owner', async () => { await denied(startSql(grant,actor,target,otherSession,targetSession)); });
await test('rejects mismatched target session owner', async () => { await denied(startSql(grant,actor,target,actorSession,otherSession)); });
await test('rejects missing actor auth session', async () => { await db.exec(`delete from auth.sessions where id='${actorSession}'`); await denied(startSql()); });
await test('rejects nested grants for same operator', async () => { await db.exec(startSql()); await denied(startSql(uid(22),actor,other,actorSession,otherSession)); });
await test('reason and maximum lifetime enforced', async () => { await denied(startSql().replace("'Maintenance repair'","'short'")); });
await test('maximum lifetime enforced', async () => { await denied(startSql().replace('15 minutes','17 minutes')); });
await test('grant is immutable', async () => { await db.exec(startSql()); await denied(`update admin_impersonation_sessions set reason='Different reason' where id='${grant}'`); });
await test('wrong actor cannot validate grant', async () => { await db.exec(startSql()); assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${other}','${actorSession}')`),false); });
await test('wrong actor session cannot validate grant', async () => { await db.exec(startSql()); assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${otherSession}')`),false); });
await test('delegated existing audit uses target and preserves actual operator', async () => {
  await db.exec(startSql()); await claims();
  await db.exec(`insert into existing_audited values('${uid(51)}','${target}','repair')`);
  const row = (await db.query("select * from audit_logs where entity_table='existing_audited'")).rows[0];
  assert.equal(row.actor_profile_id,target); assert.equal(row.delegated_by_profile_id,actor); assert.equal(row.impersonation_session_id,grant);
  assert.equal(row.reason,'Maintenance repair'); assert.equal(row.new_data.note,'repair');
  assert.equal(await value("select count(*)::int from audit_logs where entity_table='existing_audited'"),1);
});
await test('delegated previously unaudited changes get payload-free provenance', async () => {
  await db.exec(startSql()); await claims(); await db.exec(`insert into previously_unaudited values('${uid(52)}','${target}','private text')`);
  const row = (await db.query("select * from audit_logs where entity_table='previously_unaudited'")).rows[0];
  assert.equal(row.actor_profile_id,target); assert.equal(row.delegated_by_profile_id,actor); assert.equal(row.new_data,null); assert.equal(row.old_data,null);
});
await test('spoofed maintenance identity rejected', async () => { await db.exec(startSql()); await claims(other,targetSession); await denied(`insert into previously_unaudited values('${uid(52)}','${other}','spoof')`); });
await test('authenticated client cannot use service attribution header', async () => {
  await db.exec(startSql()); await claims(other,otherSession,'authenticated',grant); await db.exec(`insert into existing_audited values('${uid(53)}','${other}','normal')`);
  const row = (await db.query("select * from audit_logs where entity_table='existing_audited'")).rows[0];
  assert.equal(row.actor_profile_id,other); assert.equal(row.delegated_by_profile_id,null);
});
await test('service header preserves actual maintenance provenance', async () => {
  await db.exec(startSql()); await claims(null,null,'service_role',grant); await db.exec(`insert into previously_unaudited values('${uid(53)}','${target}','repair')`);
  const row = (await db.query("select * from audit_logs where entity_table='previously_unaudited'")).rows[0];
  assert.equal(row.actor_profile_id,target); assert.equal(row.delegated_by_profile_id,actor);
});
await test('service-mediated update retains old/new audit and delegation identities', async () => {
  await db.exec(`insert into existing_audited values('${uid(56)}','${target}','before')`);
  await db.exec(startSql()); await claims(null,null,'service_role',grant);
  await db.exec(`update existing_audited set note='after' where id='${uid(56)}'`);
  const row = (await db.query("select * from audit_logs where entity_table='existing_audited' and action='update'")).rows[0];
  assert.equal(row.actor_profile_id,target); assert.equal(row.delegated_by_profile_id,actor); assert.equal(row.impersonation_session_id,grant);
  assert.equal(row.old_data.note,'before'); assert.equal(row.new_data.note,'after');
});
await test('unknown service maintenance header is rejected', async () => { await claims(null,null,'service_role',uid(99)); await denied(`insert into previously_unaudited values('${uid(53)}','${target}','repair')`); });
await test('ending grant invalidates validation and prevents writes', async () => {
  await db.exec(startSql()); await db.exec(`update admin_impersonation_sessions set ended_at=now() where id='${grant}'`);
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),false);
  assert.equal(await value("select count(*)::int from audit_logs where action='maintenance_ended'"),1);
  await claims(); await denied(`insert into previously_unaudited values('${uid(53)}','${target}','repair')`);
});
await test('ended grant cannot be reopened', async () => { await db.exec(startSql()); await db.exec(`update admin_impersonation_sessions set ended_at=now() where id='${grant}'`); await denied(`update admin_impersonation_sessions set ended_at=null where id='${grant}'`); });
await test('expired grant cannot validate or write', async () => {
  await db.exec(startSql().replace('reason,expires_at','reason,created_at,expires_at').replace("'Maintenance repair',now()+interval '15 minutes'","'Maintenance repair',now()-interval '16 minutes',now()-interval '1 minute'"));
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),false);
  await claims(); await denied(`insert into previously_unaudited values('${uid(53)}','${target}','repair')`);
});
await test('revoked actor session invalidates existing grant', async () => { await db.exec(startSql()); await db.exec(`delete from auth.sessions where id='${actorSession}'`); assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),false); });
await test('revoked target session invalidates existing grant', async () => { await db.exec(startSql()); await db.exec(`delete from auth.sessions where id='${targetSession}'`); assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),false); });
await test('role revocation immediately invalidates existing grant', async () => { await db.exec(startSql()); await db.exec(`update admin_users set is_active=false where profile_id='${actor}'`); assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`),false); });
await test('normal user writes and original audit remain unchanged', async () => {
  await claims(other,otherSession); await db.exec(`insert into existing_audited values('${uid(54)}','${other}','normal'); insert into previously_unaudited values('${uid(55)}','${other}','normal')`);
  const rows = (await db.query('select * from audit_logs')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].actor_profile_id,other); assert.equal(rows[0].delegated_by_profile_id,null); assert.equal(rows[0].new_data.note,'normal');
});
await test('ordinary JWT without session id is null-safe', async () => {
  await claims(other,null); await db.exec(`insert into existing_audited values('${uid(57)}','${other}','normal'); insert into previously_unaudited values('${uid(58)}','${other}','normal')`);
  const rows = (await db.query('select * from audit_logs')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].actor_profile_id,other); assert.equal(rows[0].delegated_by_profile_id,null);
});
await test('delegated delete supplements tables audited only on insert/update', async () => {
  await db.exec(`insert into partially_audited values('${uid(59)}','${target}','before')`);
  await db.exec(startSql()); await claims(); await db.exec(`delete from partially_audited where id='${uid(59)}'`);
  const rows = (await db.query("select * from audit_logs where entity_table='partially_audited' and action='delete'")).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].actor_profile_id,target); assert.equal(rows[0].delegated_by_profile_id,actor); assert.equal(rows[0].impersonation_session_id,grant);
});
await test('expired delegation cannot delete from partially audited tables', async () => {
  await db.exec(`insert into partially_audited values('${uid(59)}','${target}','before')`);
  await db.exec(startSql()); await db.exec(`update admin_impersonation_sessions set ended_at=now() where id='${grant}'`);
  await claims(); await denied(`delete from partially_audited where id='${uid(59)}'`);
});
console.log(`Passed ${passed} isolated migration security checks.`);
await db.close();
