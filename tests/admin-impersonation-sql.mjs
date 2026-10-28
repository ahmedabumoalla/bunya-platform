// Isolated PostgreSQL regression: no Supabase connection or production writes.
// Run: node tests/admin-impersonation-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = '8b9f3886-e1b8-4816-9fbb-d425b0753255', target = uid(2), other = uid(3), adminTarget = uid(4), otherSuper = uid(5);
const actorSession = uid(11), targetSession = uid(12), otherSession = uid(13);
const restrictedOperators = ['7f4152b6-63d2-49ec-866f-681a3308f670', 'd5b7d59e-3a22-4d59-8096-d546c9bd8c4e'];
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
create table public.admin_permissions(id uuid primary key,permission_key text not null);
create table public.admin_role_permissions(role_id uuid references admin_roles,permission_id uuid references admin_permissions);
create table public.admin_users(id uuid primary key,profile_id uuid references public.profiles,role_id uuid references public.admin_roles,is_active boolean not null default true);
create table public.audit_logs(id bigint generated always as identity primary key,actor_profile_id uuid references public.profiles,entity_table text not null,entity_id text not null,action text not null,old_data jsonb,new_data jsonb,occurred_at timestamptz not null default now(),reason text,sensitivity text not null default 'normal' check(sensitivity in ('normal','sensitive','critical')));
create table public.existing_audited(id uuid primary key,profile_id uuid references public.profiles,note text);
create table public.previously_unaudited(id uuid primary key,profile_id uuid references public.profiles,note text);
create table public.partially_audited(id uuid primary key,profile_id uuid references public.profiles,note text);
insert into profiles(id,role) values('${actor}','admin'),('${target}','customer'),('${other}','customer'),('${adminTarget}','admin'),('${otherSuper}','admin'),('${restrictedOperators[0]}','admin'),('${restrictedOperators[1]}','admin');
insert into user_roles(profile_id,role) select id,role from profiles;
insert into admin_roles values('${uid(31)}','super_admin'),('${uid(32)}','support_admin');
insert into admin_users values('${uid(41)}','${actor}','${uid(31)}',true),('${uid(42)}','${adminTarget}','${uid(32)}',true),('${uid(43)}','${otherSuper}','${uid(31)}',true),('${uid(46)}','${restrictedOperators[0]}','${uid(31)}',true),('${uid(47)}','${restrictedOperators[1]}','${uid(31)}',true);
insert into auth.sessions values('${actorSession}','${actor}'),('${targetSession}','${target}'),('${otherSession}','${other}'),('${uid(14)}','${adminTarget}'),('${uid(15)}','${otherSuper}'),('${uid(16)}','${restrictedOperators[0]}'),('${uid(17)}','${restrictedOperators[1]}');
`);
// Exercise the actual pre-existing production audit trigger, not a test substitute.
const original = await readFile(new URL('../supabase/migrations/001_bunya_production_schema.sql', import.meta.url), 'utf8');
// Capability RPC must work as the real authenticated role under the existing
// identity policies, including directory restriction098, not merely as postgres.
for (const name of ['is_admin', 'admin_has_permission']) {
  const sql = original.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
  assert.ok(sql);
  await db.exec(sql);
}
for (const table of ['profiles', 'user_roles', 'admin_roles', 'admin_users']) await db.exec(`alter table public.${table} enable row level security`);
for (const name of ['profiles_select_own_or_admin', 'profiles_update_own_or_admin', 'user_roles_own_read', 'user_roles_admin_manage', 'admin_users_read', 'admin_users_super_manage', 'admin_roles_read', 'admin_roles_super_manage']) {
  const initial = original.match(new RegExp(`create policy ${name} on [^;]+;`))?.[0];
  assert.ok(initial);
  const alterations = [...original.matchAll(new RegExp(`alter policy ${name} on [^;]+;`, 'g'))].map(match => match[0]);
  await db.exec([initial, ...alterations].join('\n'));
}
await db.exec('grant usage on schema public,auth to authenticated; grant select on profiles,user_roles,admin_roles,admin_users to authenticated');
const existingAudit = original.match(/create or replace function public\.audit_sensitive_row\(\)[\s\S]*?\n\$\$;/)?.[0];
assert.ok(existingAudit);
await db.exec(existingAudit);
const immutableAudit = original.match(/create or replace function public\.prevent_audit_mutation\(\)[\s\S]*?\$\$;/)?.[0];
assert.ok(immutableAudit);
await db.exec(immutableAudit);
await db.exec('create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.prevent_audit_mutation()');
await db.exec('create trigger existing_audit after insert or update or delete on public.existing_audited for each row execute function public.audit_sensitive_row()');
await db.exec('create trigger partial_audit after insert or update on public.partially_audited for each row execute function public.audit_sensitive_row()');
await db.exec(await readFile(new URL('../supabase/migrations/083_super_admin_impersonation.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/098_restrict_admin_directory.sql', import.meta.url), 'utf8'));
// Represents modules created after the original delegation migration.
await db.exec('create table public.later_module(id uuid primary key,profile_id uuid references public.profiles,note text)');
const exclusiveMigration = await readFile(new URL('../supabase/migrations/099_exclusive_owner_impersonation.sql', import.meta.url), 'utf8');
await test('migration099 immediately invalidates existing grants from another super administrator', async () => {
  await db.exec(startSql(grant, otherSuper, target, uid(15), targetSession));
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${otherSuper}','${uid(15)}')`), true);
  await db.exec(exclusiveMigration);
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${otherSuper}','${uid(15)}')`), false);
  await claims();
  await denied(`insert into later_module values('${uid(61)}','${target}','blocked old grant')`);
});
await db.exec(exclusiveMigration);

await test('only service role has table access and validation RPC access', async () => {
  for (const role of ['anon','authenticated']) {
    for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(await value(`select has_table_privilege('${role}','public.admin_impersonation_sessions','${privilege}')`),false);
    const functions = await db.query("select oid::regprocedure::text as name from pg_proc where pronamespace='public'::regnamespace and proname like '%impersonation%' or proname='audit_delegated_change'");
    for (const fn of functions.rows) assert.equal(await value(`select has_function_privilege('${role}','${fn.name}','EXECUTE')`),false,fn.name);
  }
  assert.equal(await value("select has_table_privilege('service_role','public.admin_impersonation_sessions','DELETE')"), false);
  assert.equal(await value("select has_function_privilege('service_role','public.validate_admin_impersonation(uuid,uuid,uuid)','EXECUTE')"), true);
  assert.equal(await value("select relrowsecurity from pg_class where oid='public.admin_impersonation_sessions'::regclass"), true);
  assert.equal(await value("select has_function_privilege('authenticated','public.admin_can_impersonate()','EXECUTE')"), true);
  assert.equal(await value("select has_function_privilege('anon','public.admin_can_impersonate()','EXECUTE')"), false);
});
await test('only Ahmed has the initiation capability regardless of another super-admin role', async () => {
  await db.exec('set local role authenticated');
  await claims(actor, actorSession);
  assert.equal(await value('select public.admin_can_impersonate()'), true);
  for (const profile of [otherSuper, adminTarget, target, other]) {
    await claims(profile, profile === otherSuper ? uid(15) : targetSession);
    assert.equal(await value('select public.admin_can_impersonate()'), false);
  }
});
await test('capability respects suspension and password-reset guards under authenticated RLS', async () => {
  await db.exec(`update profiles set must_change_password=true where id='${actor}'`);
  await db.exec('set local role authenticated');
  await claims(actor, actorSession);
  assert.equal(await value('select public.admin_can_impersonate()'), false);
  await db.exec('reset role');
  await db.exec(`update profiles set must_change_password=false,is_active=false where id='${actor}'`);
  await db.exec('set local role authenticated');
  assert.equal(await value('select public.admin_can_impersonate()'), false);
});
await test('anonymous caller cannot invoke maintenance capability', async () => {
  await db.exec('set local role anon');
  await denied('select public.admin_can_impersonate()');
});
await test('another super administrator cannot start delegation', async () => {
  await denied(startSql(grant, otherSuper, target, uid(15), targetSession));
});
await test('active Ahmed account can start and lifecycle audit retains both identities', async () => {
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
]) await test(`rejects ${name}`, async () => { await db.exec(mutation); await denied(startSql()); });
for (const role of ['customer', 'provider', 'contractor', 'driver', 'admin']) {
  await test(`Ahmed can delegate to a ready ${role} target`, async () => {
    await db.exec(`update profiles set role='${role}' where id='${target}'; update user_roles set role='${role}' where profile_id='${target}'`);
    if (role === 'admin') await db.exec(`insert into admin_users values('${uid(44)}','${target}','${uid(32)}',true)`);
    await db.exec(startSql());
    assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), true);
  });
}
await test('allows an existing administrator target', async () => {
  await db.exec(startSql(grant,actor,adminTarget,actorSession,uid(14)));
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), true);
});
await test('allows another super administrator as target but never as operator', async () => {
  await db.exec(startSql(grant,actor,otherSuper,actorSession,uid(15)));
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), true);
  await claims(otherSuper,uid(15));
  assert.equal(await value('select public.admin_can_impersonate()'), false);
});
for (const [index, restrictedTarget] of restrictedOperators.entries()) {
  await test(`impersonated restricted administrator ${index + 1} retains migration098 boundaries`, async () => {
    await db.exec(startSql(grant,actor,restrictedTarget,actorSession,uid(16 + index)));
    assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), true);
    await claims(restrictedTarget,uid(16 + index));
    await db.exec('set local role authenticated');
    assert.equal(await value('select public.admin_can_impersonate()'), false);
    assert.equal(await value('select public.admin_can_view_administrators()'), false);
    for (const permission of ['roles.manage','admins.manage','audit.read']) assert.equal(await value(`select public.admin_has_permission('${permission}')`), false);
    assert.equal(await value("select public.admin_has_permission('orders.manage')"), true);
    assert.equal(await value(`select count(*)::int from profiles where id='${actor}'`), 0, 'original Ahmed privileges cannot reveal his profile through target RLS');
    assert.equal(await value(`select count(*)::int from profiles where id='${restrictedTarget}'`), 1, 'own identity remains readable');
    assert.equal(await value('select count(*)::int from admin_users'), 1);
  });
}
await test('allows a target with a secondary admin role', async () => {
  await db.exec(`insert into user_roles values('${target}','admin',false,null); insert into admin_users values('${uid(44)}','${target}','${uid(32)}',true)`);
  await db.exec(startSql());
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), true);
});
await test('rejects primary administrator target with inactive membership', async () => {
  await db.exec(`update admin_users set is_active=false where profile_id='${adminTarget}'`);
  await denied(startSql(grant,actor,adminTarget,actorSession,uid(14)));
});
await test('rejects primary administrator target without membership', async () => {
  await db.exec(`delete from admin_users where profile_id='${adminTarget}'`);
  await denied(startSql(grant,actor,adminTarget,actorSession,uid(14)));
});
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
for (const table of ['existing_audited', 'previously_unaudited', 'partially_audited', 'later_module']) {
  for (const transport of ['target session', 'service header']) {
    await test(`administrator ${transport} preserves one audit per insert/update/delete on ${table}`, async () => {
      await db.exec(startSql(grant,actor,adminTarget,actorSession,uid(14)));
      if (transport === 'service header') await claims(null,null,'service_role',grant);
      else await claims(adminTarget,uid(14));
      await db.exec(`insert into ${table} values('${uid(62)}','${adminTarget}','private before'); update ${table} set note='private after' where id='${uid(62)}'; delete from ${table} where id='${uid(62)}'`);
      const rows = (await db.query(`select * from audit_logs where entity_table='${table}' order by id`)).rows;
      assert.deepEqual(rows.map(row => row.action), ['insert', 'update', 'delete']);
      for (const row of rows) {
        assert.equal(row.actor_profile_id, adminTarget);
        assert.equal(row.delegated_by_profile_id, actor);
        assert.equal(row.impersonation_session_id, grant);
        assert.equal(row.reason, 'Maintenance repair');
        if (table === 'later_module' || table === 'previously_unaudited' || (table === 'partially_audited' && row.action === 'delete')) {
          assert.equal(row.new_data, null);
          assert.equal(row.old_data, null);
        }
      }
    });
  }
}
await test('migration099 audit coverage is idempotent and creates no duplicate events', async () => {
  await db.exec(exclusiveMigration);
  await db.exec(startSql()); await claims();
  await db.exec(`insert into later_module values('${uid(63)}','${target}','private')`);
  assert.equal(await value("select count(*)::int from audit_logs where entity_table='later_module'"), 1);
});
for (const command of ['update audit_logs set delegated_by_profile_id=null', 'delete from audit_logs']) {
  await test(`maintenance provenance remains immutable: ${command.split(' ')[0]}`, async () => {
    await db.exec(startSql());
    await assert.rejects(db.exec(command), /Audit records are immutable/);
  });
}
await test('admin target membership revocation immediately invalidates the grant', async () => {
  await db.exec(startSql(grant,actor,adminTarget,actorSession,uid(14)));
  await db.exec(`update admin_users set is_active=false where profile_id='${adminTarget}'`);
  assert.equal(await value(`select public.validate_admin_impersonation('${grant}','${actor}','${actorSession}')`), false);
  await claims(adminTarget,uid(14));
  await denied(`insert into later_module values('${uid(64)}','${adminTarget}','blocked')`);
});
console.log(`Passed ${passed} isolated migration security checks.`);
await db.close();
