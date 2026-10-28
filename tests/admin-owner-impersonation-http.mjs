import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import React from 'react';
import {NextRequest} from 'next/server.js';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const loadedModule = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in mocks ? mocks[name] : name.endsWith('/archive-fetch') ? load('src/lib/supabase/archive-fetch.ts') : name.endsWith('/archive-origin') ? {archiveProxyOrigin: async () => 'https://example.test'} : name.endsWith('/archive-server') ? {archiveActorStatus: async () => ({active: false})} : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const ownerId = '8b9f3886-e1b8-4816-9fbb-d425b0753255';
const targetId = '00000000-0000-4000-8000-000000000002';
const actorSession = '00000000-0000-4000-8000-000000000011';
const targetSession = '00000000-0000-4000-8000-000000000012';
let allowed = true, capabilityError = null, ownerStatus = 'ready';
const original = {
  auth: {getUser: async () => ({data: {user: {id: ownerId}}}), getSession: async () => ({data: {session: {access_token: 'owner-token'}}})},
  rpc: async name => {assert.equal(name, 'admin_can_impersonate'); return {data: allowed, error: capabilityError};},
};
const cookieValues = new Map();
const store = {has: key => cookieValues.has(key), set: (key, value, options) => cookieValues.set(key, {value, options})};
const cookie = {
  IMPERSONATION_COOKIE: 'delegated', IMPERSONATION_MARKER: 'delegated-marker',
  isUuid: value => /^[0-9a-f-]{36}$/.test(value),
  sessionId: token => token === 'owner-token' ? actorSession : targetSession,
  sealImpersonation: ticket => {assert.equal(ticket.actorId, ownerId); assert.equal(ticket.targetId, targetId); return 'sealed-fixture';},
};
const guard = load('src/lib/auth/impersonation.ts', {
  react: {cache: fn => fn}, 'next/headers': {cookies: async () => store},
  '@/lib/supabase/session': {createOriginalClient: async () => original}, '@/lib/supabase/admin': {}, '@/lib/supabase/env': {},
  './resolve-identity': {resolveAuthIdentity: async () => ({userId: ownerId, status: ownerStatus, profile: {mustChangePassword: false}, activeRoles: ['admin'], details: {admin: {roleKey: 'super_admin'}}})},
  './impersonation-cookie': cookie,
});
const previousMode = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'development';
  const loopbackRequest = (origin = 'http://127.0.0.1:3001', extra = {}) => new Request('http://localhost:3001/api/admin/impersonation', {headers: {origin, host: '127.0.0.1:3001', ...extra}});
  assert.doesNotThrow(() => guard.assertMaintenanceOrigin(loopbackRequest()));
  for (const origin of ['http://127.0.0.1:3002', 'https://127.0.0.1:3001', 'https://attacker.example']) assert.throws(() => guard.assertMaintenanceOrigin(loopbackRequest(origin)), guard.ImpersonationError);
  assert.throws(() => guard.assertMaintenanceOrigin(loopbackRequest(undefined, {'sec-fetch-site': 'cross-site'})), guard.ImpersonationError);
  process.env.NODE_ENV = 'production';
  assert.throws(() => guard.assertMaintenanceOrigin(loopbackRequest()), guard.ImpersonationError, 'production keeps exact origin checks');
} finally {if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;}
assert.equal((await guard.requireImpersonationOperator()).identity.userId, ownerId);
allowed = false;
await assert.rejects(guard.requireImpersonationOperator(), guard.ImpersonationError, 'super-admin status alone is insufficient');
allowed = true; capabilityError = {};
await assert.rejects(guard.requireImpersonationOperator(), guard.ImpersonationError, 'capability failure is closed');
capabilityError = null; ownerStatus = 'inactive_profile';
await assert.rejects(guard.requireImpersonationOperator(), guard.ImpersonationError);
ownerStatus = 'ready';

let role = 'admin', ready = true, confirmed = true, minted = 0, resetPending = false;
const inserted = [];
let prepared;
const admin = {
  auth: {admin: {
    getUserById: async id => ({data: {user: {id, email: 'target@example.test', email_confirmed_at: confirmed ? '2026-01-01' : null}}}),
    generateLink: async () => {minted++; return {data: {properties: {hashed_token: 'private-fixture-hash'}}};},
    signOut: async () => ({}),
  }},
  rpc: async (name, params) => {
    if (name === 'prepare_admin_impersonation') {prepared = params; assert.equal(params.p_actor, ownerId); assert.equal(params.p_actor_session, actorSession); assert.match(params.p_nonce_hash, /^[a-f0-9]{64}$/);}
    else assert.equal(name, 'cancel_admin_impersonation_prepare');
    return {error: null};
  },
  from: table => {assert.equal(table, 'admin_impersonation_sessions'); return {select: () => ({eq: () => ({maybeSingle: async () => ({data: {id: prepared.p_id, actor_profile_id: ownerId, target_profile_id: targetId, target_auth_session_id: targetSession, expires_at: new Date(Date.now()+900_000).toISOString()}})})})};},
};
const start = load('src/app/api/admin/impersonation/route.ts', {
  'next/headers': {cookies: async () => store},
  '@/lib/auth/impersonation': guard,
  '@/lib/auth/impersonation-cookie': cookie,
  '@/lib/supabase/admin': {createAdminClient: () => admin},
  '@/lib/supabase/env': {getSupabasePublicEnv: () => ({url: 'https://example.test', key: 'public'})},
  '@/lib/auth/resolve-identity': {resolveAuthIdentity: async () => ({userId: targetId, status: ready ? 'ready' : 'inactive_profile', primaryRole: role, activeRoles: [role], profile: {mustChangePassword: resetPending}})},
  '@/lib/auth/types': {routeForRole: value => ({admin: '/admin', customer: '/customer', provider: '/merchant', contractor: '/contractor', driver: '/driver'})[value]},
  '@supabase/supabase-js': {createClient: (_url, _key, options) => {
    const agent = options.global.headers['User-Agent'];
    assert.match(agent, /^bunya-maintenance\/[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(agent.slice(18)).digest('hex'), prepared.p_nonce_hash);
    inserted.push({actor_profile_id: prepared.p_actor, target_profile_id: prepared.p_target});
    return {auth: {verifyOtp: async () => ({data: {user: {id: targetId}, session: {access_token: 'target-token', expires_at: Math.floor(Date.now()/1000)+3600}}})}};
  }},
});
const request = (id = targetId) => new Request('https://example.test/api/admin/impersonation', {method: 'POST', headers: {origin: 'https://example.test', 'content-type': 'application/json'}, body: JSON.stringify({targetUserId: id})});
for (const targetRole of ['admin', 'customer', 'provider', 'contractor', 'driver']) {
  cookieValues.clear(); role = targetRole;
  const response = await start.POST(request());
  assert.equal(response.status, 200, targetRole);
  const payload = await response.json();
  assert.ok(payload.redirectTo.startsWith('/'));
  if (targetRole === 'admin') assert.equal(payload.redirectTo, '/admin');
  assert.equal(inserted.at(-1).actor_profile_id, ownerId);
  assert.equal(inserted.at(-1).target_profile_id, targetId);
  assert.equal(cookieValues.get('delegated').options.httpOnly, true);
  assert.ok(!JSON.stringify(payload).includes('token'));
}
cookieValues.clear(); resetPending = true;
assert.equal((await start.POST(request())).status, 200, 'pending temporary password does not block delegated entry');
resetPending = false;
const mintedBeforeDenials = minted;
assert.equal((await start.POST(request())).status, 403, 'nested delegation blocked');
cookieValues.clear(); allowed = false;
assert.equal((await start.POST(request())).status, 403);
allowed = true; ready = false;
assert.equal((await start.POST(request())).status, 403);
ready = true; confirmed = false;
assert.equal((await start.POST(request())).status, 403);
confirmed = true;
assert.equal((await start.POST(request(ownerId))).status, 400);
assert.equal(minted, mintedBeforeDenials, 'denied requests never create auth sessions');

let valid = true;
const middleware = load('src/proxy.ts', {
  '@/lib/supabase/middleware': {refreshSupabaseSession: async () => ({response: new Response('next'), userId: ownerId, supabase: original})},
  '@/lib/auth/impersonation-cookie': cookie,
  '@/lib/auth/impersonation': {validateImpersonation: async () => {if (!valid) throw new Error('revoked');return {targetId};}, assertMaintenanceOrigin: guard.assertMaintenanceOrigin},
});
const proxyRequest = path => new NextRequest(`https://example.test${path}`, {method: 'POST', headers: {cookie: 'delegated=sealed-fixture', origin: 'https://example.test'}});
assert.equal((await middleware.proxy(proxyRequest('/api/admin/notifications/id/retry'))).status, 200, 'admin API reaches target authorization');
for (const path of ['/api/admin/impersonation', '/api/admin/impersonation/', '/api/auth/change-password']) assert.equal((await middleware.proxy(proxyRequest(path))).status, 403);
valid = false;
assert.equal((await middleware.proxy(proxyRequest('/api/admin/notifications/id/retry'))).status, 403);

let targetAllowed = false;
const apiGate = load('src/lib/auth/admin-api.ts', {
  '@/lib/supabase/server': {createClient: async () => ({auth: {getUser: async () => ({data: {user: {id: targetId}}})}, rpc: async () => ({data: targetAllowed})})},
  '@/lib/supabase/admin': {createAdminClient: () => ({})},
});
assert.equal((await apiGate.requireAdminPermission('roles.manage')).error, 'forbidden', 'owner privileges never override target restrictions');
targetAllowed = true;
assert.equal((await apiGate.requireAdminPermission('orders.manage')).userId, targetId, 'business attribution remains the target account');
let delegated = null;
const portal = load('src/lib/auth/server.ts', {
  react: {cache: fn => fn},
  'next/navigation': {redirect: path => {throw new Error(path);}},
  '@/lib/supabase/server': {createClient: async () => ({auth: {getUser: async () => ({data: {user: {id: targetId}}})}})},
  './resolve-identity': {resolveAuthIdentity: async () => ({userId: targetId, status: 'ready', primaryRole: 'contractor', activeRoles: ['contractor'], profile: {isActive: true, mustChangePassword: true}, details: {contractor: {}}}), roleIsReady: () => true},
  './types': {routeForRole: role => '/'+role}, './impersonation': {getImpersonation: async () => delegated},
});
await assert.rejects(portal.requirePortalRole('contractor'), /\/account\/change-password/);
delegated = {targetId};
assert.equal((await portal.requirePortalRole('contractor')).userId, targetId, 'only validated delegation bypasses password-change navigation');

const priorFetch = globalThis.fetch, priorWindow = globalThis.window, priorDocument = globalThis.document;
const overview = {id: targetId, name: 'Target admin', email: 'target@example.test', active: true, roles: [], sections: [], canImpersonate: true};
const state = [overview, 'overview', '', 1, null, false, '', 0, false, ''];
let hookIndex = 0, navigated = null, posted = null;
globalThis.document = {body: {}};
globalThis.window = {location: {assign: path => {navigated = path;}}};
globalThis.fetch = async (url, options) => {posted = {url, body: JSON.parse(options.body)}; return Response.json({redirectTo: '/admin'});};
const dialog = load('src/components/admin/AdminUserDetails.tsx', {
  react: {...React, useId: () => 'test-id', useRef: () => ({current: null}), useCallback: fn => fn, useEffect() {}, useState: () => {const index = hookIndex++; return [state[index], value => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];}},
  'react-dom': {createPortal: node => node}, '@/lib/body-scroll-lock': {},
  './AdminUserDetails.module.css': {default: new Proxy({}, {get: (_, key) => key})},
});
const nodes = node => node && typeof node === 'object' ? [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)] : [];
try {
  let tree = nodes(dialog.AdminUserDetails({userId: targetId, onClose() {}}));
  assert.ok(!tree.some(node => node.type === 'textarea'), 'no reason entry');
  const button = tree.find(node => node.type === 'button' && node.props.children === 'الدخول بالنيابة');
  assert.ok(button && !button.props.disabled, 'actual component renders enabled entry');
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(posted, {url: '/api/admin/impersonation', body: {targetUserId: targetId}});
  assert.equal(navigated, '/admin', 'one click navigates directly into admin target');
  state[0] = {...overview, canImpersonate: false}; hookIndex = 0;
  tree = nodes(dialog.AdminUserDetails({userId: targetId, onClose() {}}));
  assert.ok(!tree.some(node => node.type === 'button' && node.props.children === 'الدخول بالنيابة'));
} finally {
  globalThis.fetch = priorFetch;
  if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
}
console.log('Owner impersonation HTTP/UI PASS: exclusive capability, all roles, pending-password entry, one-use authorization, no reason, one-click admin navigation, ordinary password guard retained, no nesting/privilege inheritance.');
