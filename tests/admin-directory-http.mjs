import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const loadedModule = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const target = '11111111-1111-4111-8111-111111111111';
let targetVisible = false, lookupError = null, serviceCalls = 0, permission = true;
const session = {
  auth: {getUser: async () => ({data: {user: {id: 'viewer'}}})},
  rpc: async () => ({data: permission}),
  from(table) {
    assert.equal(table, 'profiles');
    return {select: () => ({eq: (_field, id) => ({maybeSingle: async () => ({data: targetVisible ? {id, role: 'customer'} : null, error: lookupError})})})};
  },
};
const detail = load('src/lib/admin/user-details.ts', {
  '@/lib/supabase/server': {createClient: async () => session},
  '@/lib/supabase/admin': {createAdminClient: () => { serviceCalls++; return {}; }},
  '@/lib/auth/resolve-identity': {resolveAuthIdentity: async () => ({status: 'ready', activeRoles: ['admin'], details: {admin: {}}})},
  '@/lib/admin/records': {}, '@/lib/join/provider-fields': {}, '@/lib/join/contractor-fields': {},
});
await assert.rejects(detail.requireUserDetailAccess(target), error => error.status === 404);
assert.equal(serviceCalls, 0, 'hidden target never gets service-role access');
lookupError = {message: 'database unavailable'};
await assert.rejects(detail.requireUserDetailAccess(target), /Profile lookup failed/);
assert.equal(serviceCalls, 0, 'RLS lookup failure fails closed');
lookupError = null; targetVisible = true;
assert.equal((await detail.requireUserDetailAccess(target)).profile.id, target);
assert.equal(serviceCalls, 1, 'visible non-admin target remains usable');
permission = false;
await assert.rejects(detail.requireUserDetailAccess(target), error => error.status === 403);
assert.equal(serviceCalls, 1);
const response = detail.userDetailFailure(new detail.UserDetailError(404, 'الحساب غير موجود.'));
assert.equal(response.status, 404);
assert.match(response.headers.get('cache-control'), /private, no-store/);
for (const path of ['src/app/api/admin/users/[id]/route.ts', 'src/app/api/admin/users/[id]/documents/[documentId]/route.ts']) {
  assert.match(readFileSync(path, 'utf8'), /await requireUserDetailAccess\(id\)/, 'all detail/download routes share the gate');
}

const nodes = node => node && typeof node === 'object' ? [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)] : [];
const row = (id, role) => ({id, role, email: `${id}@example.test`, full_name: id, username: id, mobile: null, is_active: true, created_at: '2026-10-01', updated_at: '2026-10-01', user_roles: null});
async function usersView(allowed, rpcError = null) {
  let index = 0, effect;
  const state = [];
  function FilterBar() {}
  const db = {
    rpc: async name => { assert.equal(name, 'admin_can_view_administrators'); return {data: allowed, error: rpcError}; },
    from: () => ({select: () => ({order: () => ({limit: async () => ({data: [row('customer', 'customer'), row('self-admin', 'admin'), {...row('mixed', 'customer'), user_roles: [{role: 'admin', revoked_at: null}]}]})})})}),
  };
  const {AdminUsers} = load('src/components/admin/AdminUsers.tsx', {
    react: {...React, useEffect: callback => {effect ??= callback;}, useMemo: callback => callback(), useState: initial => {const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => {state[i] = typeof value === 'function' ? value(state[i]) : value;}];}},
    '@/lib/supabase/client': {createClient: () => db},
    './AdminUsers.module.css': {default: new Proxy({}, {get: (_, key) => key})},
    './AdminUserDetails': {AdminUserDetails: () => null}, './AdminFilterBar': {AdminFilterBar: FilterBar},
  });
  AdminUsers(); effect();
  await new Promise(resolve => setImmediate(resolve));
  index = 0;
  const tree = nodes(AdminUsers());
  return {tree, bar: tree.find(node => node.type === FilterBar)};
}
const restricted = await usersView(false);
assert.deepEqual(restricted.tree.find(node => node.type === 'tbody').props.children.map(node => node.key), ['customer']);
assert.ok(!restricted.bar.props.filters[0].options.some(option => option.value === 'admin'));
const metrics = restricted.tree.find(node => node.props?.['aria-label'] === 'ملخص المستخدمين');
assert.equal(metrics.props.style['--user-metric-columns'], 5, 'restricted cards fill five equal columns');
assert.ok(!nodes(metrics).some(node => node.type === 'span' && node.props.children === 'إدارة'), 'administration card hidden');
const unrestricted = await usersView(true);
assert.equal(unrestricted.tree.find(node => node.props?.['aria-label'] === 'ملخص المستخدمين').props.style['--user-metric-columns'], 6);
assert.equal(unrestricted.tree.find(node => node.type === 'tbody').props.children.length, 3);
assert.ok(unrestricted.bar.props.filters[0].options.some(option => option.value === 'admin'));
const failed = await usersView(false, {message: 'unavailable'});
assert.ok(!failed.tree.some(node => node.type === 'tbody'), 'capability failure never displays account rows');
console.log('Admin directory HTTP/UI PASS: RLS target gate, closed errors, no privileged access to hidden targets, shared download gate, private responses, restricted cards/filters/counts/rows, unrestricted behavior.');
