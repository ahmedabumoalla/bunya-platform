// Isolated PostgreSQL authorization regression; no Supabase connection or live writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const base = readFileSync('supabase/migrations/001_bunya_production_schema.sql', 'utf8');
const migration = readFileSync('supabase/migrations/098_restrict_admin_directory.sql', 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const restricted = ['7f4152b6-63d2-49ec-866f-681a3308f670', 'd5b7d59e-3a22-4d59-8096-d546c9bd8c4e'];
const owner = id(1), customer = id(2), provider = id(3), secondary = id(4), inactive = id(5), revoked = id(6), primaryOnly = id(7);
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const actor = async (profile, role = 'authenticated') => {
  await db.exec(`reset role; set local role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: profile, role })]);
};
async function denied(sql) {
  await db.exec('savepoint denied_operation');
  try { await assert.rejects(db.exec(sql), error => error.code === '42501'); }
  finally { await db.exec('rollback to savepoint denied_operation'); }
}
let passed = 0;
async function test(name, body) {
  await db.exec('begin');
  try { await body(); passed++; console.log(`PASS ${name}`); }
  finally { await db.exec('rollback'); }
}
const originalFunction = name => {
  const sql = base.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
  assert.ok(sql, `production function ${name} exists`);
  return sql;
};
const originalPolicy = name => {
  const initial = base.match(new RegExp(`create policy ${name} on [^;]+;`))?.[0];
  assert.ok(initial, `production policy ${name} exists`);
  const alterations = [...base.matchAll(new RegExp(`alter policy ${name} on [^;]+;`, 'g'))].map(match => match[0]);
  return [initial, ...alterations].join('\n');
};

// Only table scaffolding/auth identity are fixtures. Actual pre-existing helpers,
// permissive policies, field guard, and the complete new migration execute in SQL.
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table public.profiles(id uuid primary key,role text not null,is_active boolean not null default true,full_name text,email text);
create table public.user_roles(profile_id uuid references profiles,role text not null,is_primary boolean default true,revoked_at timestamptz,primary key(profile_id,role));
create table public.admin_roles(id uuid primary key,role_key text not null,name_ar text);
create table public.admin_permissions(id uuid primary key,permission_key text not null);
create table public.admin_role_permissions(role_id uuid references admin_roles,permission_id uuid references admin_permissions,primary key(role_id,permission_id));
create table public.admin_users(id uuid primary key,profile_id uuid unique references profiles,role_id uuid references admin_roles,is_active boolean not null default true);
create table public.audit_logs(id uuid primary key,new_data jsonb);
create table public.project_audit_logs(id uuid primary key);
grant usage on schema public,auth to anon,authenticated,service_role;
grant all on all tables in schema public to authenticated,service_role;
`);
await db.exec(originalFunction('is_admin'));
await db.exec(originalFunction('admin_has_permission'));
await db.exec(originalFunction('protect_profile_privileged_fields'));
await db.exec('create trigger profiles_protect_privileged_fields before update on public.profiles for each row execute function public.protect_profile_privileged_fields()');
for (const table of ['profiles', 'user_roles', 'admin_users', 'admin_roles', 'admin_permissions', 'admin_role_permissions', 'audit_logs', 'project_audit_logs']) {
  await db.exec(`alter table public.${table} enable row level security`);
}
for (const policy of ['profiles_select_own_or_admin', 'profiles_update_own_or_admin', 'user_roles_own_read', 'user_roles_admin_manage', 'admin_users_read', 'admin_users_super_manage', 'admin_roles_read', 'admin_roles_super_manage', 'admin_permissions_read', 'admin_permissions_super_manage', 'admin_role_permissions_read', 'admin_role_permissions_super_manage', 'audit_logs_admin_read', 'project_audit_logs_admin_select']) {
  await db.exec(originalPolicy(policy));
}
await db.exec(`
insert into profiles(id,role,email) values
('${restricted[0]}','admin','operator-a@example.invalid'),('${restricted[1]}','admin','operator-b@example.invalid'),
('${owner}','admin','owner@example.invalid'),('${customer}','customer','customer@example.invalid'),('${provider}','provider','provider@example.invalid'),
('${secondary}','customer','secondary@example.invalid'),('${inactive}','customer','inactive@example.invalid'),('${revoked}','customer','revoked@example.invalid'),('${primaryOnly}','admin','primary@example.invalid');
insert into user_roles(profile_id,role) select id,role from profiles;
insert into user_roles(profile_id,role,is_primary,revoked_at) values('${secondary}','admin',false,null),('${revoked}','admin',false,now());
insert into admin_roles(id,role_key,name_ar) values('${id(101)}','super_admin','Super administrator'),('${id(102)}','operations_admin','Operations');
insert into admin_permissions values('${id(201)}','profiles.read'),('${id(202)}','admins.manage');
insert into admin_role_permissions values('${id(102)}','${id(201)}');
insert into admin_users(id,profile_id,role_id,is_active) values
('${id(301)}','${restricted[0]}','${id(101)}',true),('${id(302)}','${restricted[1]}','${id(101)}',true),
('${id(303)}','${owner}','${id(101)}',true),('${id(304)}','${inactive}','${id(101)}',false);
insert into audit_logs values('${id(401)}','{"email":"private-admin@example.invalid"}');
insert into project_audit_logs values('${id(402)}');
`);
await db.exec(migration);

for (const [index, profile] of restricted.entries()) {
  await test(`restricted operator ${index + 1}: profile/role/admin lists and own identity`, async () => {
    await actor(profile);
    const expectedProfiles = [profile, customer, provider, revoked].sort();
    assert.deepEqual((await rows('select id from profiles order by id')).map(row => row.id), expectedProfiles);
    assert.deepEqual((await rows('select distinct profile_id from user_roles order by profile_id')).map(row => row.profile_id), expectedProfiles);
    assert.deepEqual((await rows('select profile_id from admin_users')).map(row => row.profile_id), [profile]);
    assert.equal(await scalar('select count(*)::int from profiles'), 4, 'counts cannot include hidden administrators');
    assert.equal(await scalar("select count(*)::int from user_roles where role='admin' and revoked_at is null"), 1, 'only own admin identity remains');
    assert.equal(await scalar('select public.is_admin()'), true, 'login and operational identity remain valid without recursion');
    assert.equal(await scalar('select public.admin_can_view_administrators()'), false);
    for (const target of [owner, secondary, inactive, primaryOnly, restricted[1 - index]]) {
      assert.equal(await scalar('select count(*)::int from profiles where id=$1', [target]), 0, 'direct target reads are also hidden');
    }
  });
  await test(`restricted operator ${index + 1}: management and audit denied, operations retained`, async () => {
    await actor(profile);
    for (const permission of ['roles.manage', 'admins.manage', 'audit.read']) assert.equal(await scalar('select public.admin_has_permission($1)', [permission]), false, permission);
    for (const permission of ['profiles.read', 'profiles.manage', 'orders.manage', 'sourcing.manage', 'reviews.manage', 'projects.manage', 'deliveries.manage', 'finance.manage', 'support.manage']) assert.equal(await scalar('select public.admin_has_permission($1)', [permission]), true, permission);
    assert.equal(await scalar('select count(*)::int from audit_logs'), 0);
    assert.equal(await scalar('select count(*)::int from project_audit_logs'), 0);
    assert.deepEqual(await rows(`update profiles set full_name='Hidden target' where id='${owner}' returning id`), []);
    assert.deepEqual(await rows(`update admin_users set is_active=false where profile_id='${profile}' returning id`), []);
    assert.deepEqual(await rows(`update user_roles set revoked_at=now() where profile_id='${profile}' returning profile_id`), []);
    assert.deepEqual(await rows("update admin_roles set name_ar='Modified' returning id"), []);
    assert.deepEqual(await rows("update admin_permissions set permission_key='modified' returning id"), []);
    await denied(`insert into user_roles(profile_id,role) values('${customer}','admin')`);
    await denied(`insert into admin_users(id,profile_id,role_id) values('${id(305)}','${customer}','${id(101)}')`);
    await denied(`insert into admin_role_permissions values('${id(102)}','${id(202)}')`);
    await denied(`insert into admin_roles values('${id(103)}','super_admin','Alternate administrator')`);
  });
  await test(`restricted operator ${index + 1}: ordinary profile edits and immutable restriction`, async () => {
    await actor(profile);
    assert.equal((await rows(`update profiles set full_name='Edited customer' where id='${customer}' returning id`)).length, 1);
    assert.equal((await rows(`update profiles set email='changed@example.invalid' where id='${profile}' returning id`)).length, 1);
    assert.equal(await scalar('select public.admin_can_view_administrators()'), false);
    assert.equal(await scalar("select public.admin_has_permission('admins.manage')"), false);
    assert.equal(await scalar(`select count(*)::int from profiles where id='${owner}'`), 0);
  });
}

await test('unrestricted super administrator keeps all directory, audit, and management access', async () => {
  await actor(owner);
  assert.equal(await scalar('select public.admin_can_view_administrators()'), true);
  assert.equal(await scalar('select count(*)::int from profiles'), 9);
  assert.equal(await scalar('select count(*)::int from user_roles'), 11);
  assert.equal(await scalar('select count(*)::int from admin_users'), 4);
  for (const permission of ['admins.manage', 'roles.manage', 'audit.read']) assert.equal(await scalar('select public.admin_has_permission($1)', [permission]), true);
  assert.equal(await scalar('select count(*)::int from audit_logs'), 1);
  assert.equal(await scalar('select count(*)::int from project_audit_logs'), 1);
  assert.equal((await rows(`update profiles set full_name='Updated operator' where id='${restricted[0]}' returning id`)).length, 1);
  await db.exec(`insert into user_roles(profile_id,role) values('${customer}','admin'); insert into admin_users(id,profile_id,role_id) values('${id(305)}','${customer}','${id(101)}')`);
  assert.equal(await scalar(`select count(*)::int from admin_users where profile_id='${customer}'`), 1);
});
await test('ordinary users remain limited to their own identities', async () => {
  for (const profile of [customer, provider]) {
    await actor(profile);
    assert.deepEqual((await rows('select id from profiles')).map(row => row.id), [profile]);
    assert.deepEqual((await rows('select profile_id from user_roles')).map(row => row.profile_id), [profile]);
    assert.equal(await scalar('select count(*)::int from admin_users'), 0);
    assert.equal(await scalar('select public.admin_can_view_administrators()'), false);
    assert.equal(await scalar("select public.admin_has_permission('profiles.read')"), false);
  }
});
await test('anonymous callers cannot use directory or permission RPCs or private helpers', async () => {
  await actor(null, 'anon');
  await denied('select public.admin_can_view_administrators()');
  await denied("select public.admin_has_permission('profiles.read')");
  await denied('select private.admin_directory_restricted()');
  await denied(`select private.admin_profile_visible('${owner}')`);
});
await test('service access retains complete data; policy helper is private and safely configured', async () => {
  await actor(null, 'service_role');
  assert.equal(await scalar('select count(*)::int from profiles'), 9);
  assert.equal(await scalar('select count(*)::int from admin_users'), 4);
  await db.exec('reset role');
  const functions = await rows("select proname,prosecdef,proconfig from pg_proc where pronamespace='private'::regnamespace");
  assert.ok(functions.some(fn => fn.proname === 'admin_profile_visible' && fn.prosecdef && fn.proconfig.includes('search_path=""')));
  assert.equal(await scalar("select has_schema_privilege('anon','private','USAGE')"), false);
});
await db.close();
console.log(`Admin directory SQL PASS: ${passed} authorization groups.`);
