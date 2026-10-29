import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
}
const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const archive = load('src/lib/supabase/archive-fetch.ts');
const actor = [...archive.ARCHIVE_ACTORS][0];
const token = suffix => `Bearer e30.${Buffer.from(JSON.stringify({sub: actor})).toString('base64url')}.${suffix}`;
const base = 'https://example.supabase.co';
const request = (fetcher, credential = token('one')) => fetcher(`${base}/rest/v1/providers?select=id`, {headers: {authorization: credential}});

// Hold the status HTTP response so concurrency is deterministic, independent of timing.
{
  const hold = deferred(), statuses = [], reads = [];
  const fetcher = archive.createArchiveFetch(base, async (input, init) => {
    if (String(input).endsWith('/rpc/admin_archive_status')) {
      statuses.push(init); await hold.promise;
      return Response.json({active: true, eligible: true, captured_at: '2026-10-28T11:21:28Z'});
    }
    reads.push(init); return Response.json([{id: 'visible'}]);
  });
  const pending = Array.from({length: 12}, () => request(fetcher));
  await tick(); assert.equal(statuses.length, 1); assert.equal(reads.length, 0);
  hold.resolve();
  for (const response of await Promise.all(pending)) assert.deepEqual(await response.json(), [{id: 'visible'}]);
  assert.equal(reads.length, 12);
  for (const init of reads) {
    assert.equal(init.headers.get('authorization'), token('one'));
    assert.equal(init.headers.get('accept-profile'), 'admin_archive');
    assert.equal(init.cache, 'no-store');
  }
  assert.equal((await fetcher(`${base}/rest/v1/providers`, {method: 'DELETE', headers: {authorization: token('one')}})).status, 403);
  assert.equal(reads.length, 12, 'coalescing never bypasses the archive write guard');
}
{
  const hold = deferred(), statuses = [], reads = [];
  const fetcher = archive.createArchiveFetch(base, async (input, init) => {
    const credential = init.headers.get('authorization');
    if (String(input).endsWith('/rpc/admin_archive_status')) {
      statuses.push(credential); await hold.promise;
      return Response.json({active: true, eligible: credential === token('allowed')});
    }
    reads.push(credential); return Response.json([]);
  });
  const allowed = request(fetcher, token('allowed')), denied = request(fetcher, token('denied'));
  await tick(); assert.deepEqual(statuses, [token('allowed'), token('denied')]);
  hold.resolve();
  assert.equal((await allowed).status, 200); assert.equal((await denied).status, 403);
  assert.deepEqual(reads, [token('allowed')], 'different credentials cannot borrow an in-flight authorization result');
}
for (const failure of ['http', 'transport', 'json', 'inactive', 'missing']) {
  const hold = deferred(); let statuses = 0, reads = 0;
  const fetcher = archive.createArchiveFetch(base, async (input) => {
    if (!String(input).endsWith('/rpc/admin_archive_status')) {reads++; return Response.json([]);}
    statuses++;
    if (statuses > 1) return Response.json({active: true, eligible: true});
    await hold.promise;
    if (failure === 'transport') throw new Error('offline');
    if (failure === 'json') return new Response('{', {headers: {'content-type': 'application/json'}});
    if (failure === 'http') return new Response('', {status: 503});
    if (failure === 'missing') return new Response('', {status: 404});
    return Response.json({active: false, eligible: false});
  });
  const pending = Promise.allSettled([request(fetcher), request(fetcher)]);
  await tick(); assert.equal(statuses, 1); hold.resolve();
  const outcomes = await pending;
  if (['transport', 'json'].includes(failure)) assert.ok(outcomes.every(result => result.status === 'rejected'));
  else assert.ok(outcomes.every(result => result.status === 'fulfilled' && result.value.status === (failure === 'http' ? 403 : 200)));
  assert.equal(reads, ['inactive', 'missing'].includes(failure) ? 2 : 0);
  assert.equal((await request(fetcher)).status, 200);
  assert.equal(statuses, 2, `${failure} must release the pending entry for retry`);
}

const target = '11111111-1111-4111-8111-111111111111';
const ready = {status: 'ready', activeRoles: ['admin'], details: {admin: {}}, userId: 'viewer'};
const records = {formatRecordField: (row, spec) => String(row[spec.key] ?? ''), readableText: value => String(value), stateLabels: {}};
let gateState, privileged = 0;
const detail = load('src/lib/admin/user-details.ts', {
  '@/lib/supabase/server': {createClient: async () => ({
    auth: {getUser: async () => ({data: {user: gateState.user}})},
    from: () => ({select: () => ({eq: () => ({maybeSingle: () => {gateState.started.push('profile'); return gateState.hold.promise.then(() => gateState.profile);}})})}),
    rpc: async name => {gateState.started.push(name); await gateState.hold.promise; return {data: name === 'admin_can_impersonate' ? gateState.impersonate : gateState.permission};},
  })},
  '@/lib/supabase/admin': {createAdminClient: () => {privileged++; return {}; }},
  '@/lib/auth/resolve-identity': {resolveAuthIdentity: async () => {gateState.started.push('identity'); await gateState.hold.promise; return gateState.identity;}},
  '@/lib/admin/records': records, '@/lib/join/provider-fields': {}, '@/lib/join/contractor-fields': {},
});
for (const kind of ['ready', 'signed-out', 'non-admin', 'permission', 'hidden', 'profile-error']) {
  gateState = {user: {id: 'viewer'}, identity: ready, permission: true, impersonate: false, profile: {data: {id: target}}, hold: deferred(), started: []};
  if (kind === 'signed-out') gateState.user = null;
  if (kind === 'non-admin') gateState.identity = {...ready, activeRoles: []};
  if (kind === 'permission') gateState.permission = false;
  if (kind === 'hidden') gateState.profile = {data: null};
  if (kind === 'profile-error') gateState.profile = {data: {id: target}, error: {message: 'unavailable'}};
  const before = privileged, pending = detail.requireUserDetailAccess(target);
  const settled = Promise.allSettled([pending]);
  await tick(); assert.equal(privileged, before, 'privileged client waits for every access gate');
  if (kind !== 'signed-out') {
    assert.ok(gateState.started.includes('profile') && gateState.started.includes('identity'));
    assert.equal(gateState.started.filter(name => name === 'admin_has_permission').length, 10);
  } else assert.deepEqual(gateState.started, []);
  gateState.hold.resolve();
  const [result] = await settled;
  if (kind === 'ready') {assert.equal(result.status, 'fulfilled'); assert.equal(result.value.canImpersonate, false); assert.equal(privileged, before + 1);}
  else {assert.equal(result.status, 'rejected'); assert.equal(privileged, before); assert.equal(result.reason.status, {'signed-out': 401, 'non-admin': 403, permission: 403, hidden: 404}[kind]);}
}

const links = {members: [], providerIds: ['provider'], contractorIds: ['contractor'], driverIds: ['driver'], providerApplicationIds: ['provider-app'], contractorApplicationIds: ['contractor-app']};
{
  const pending = [], fixtures = {
    providers: [{id: 'provider', company_name: 'Provider'}], provider_profiles: [{provider_id: 'provider'}],
    provider_applications: [{company_name: 'Applicant'}], contractor_profiles: [{display_name: 'Contractor'}],
    contractor_profile_specialties: [{specialty_name: 'Cooling'}], contractor_profile_regions: [{region_name: 'Riyadh'}],
    contractor_applications: [{contractor_name: 'Contractor applicant'}], admin_users: [{role: {name_ar: 'Admin'}}], provider_drivers: [{full_name: 'Driver'}],
  };
  const admin = {from(table) {
    const hold = deferred();
    const q = {select: () => q, eq: () => q, in: () => q, order: () => q,
      then: (resolve, reject) => {pending.push({table, hold}); return hold.promise.then(() => ({data: fixtures[table]})).then(resolve, reject);}};
    return q;
  }};
  const result = detail.overviewSections({admin, profile: {id: target}, permissions: new Set(['reviews.manage', 'roles.manage', 'deliveries.manage'])}, links);
  await tick(); assert.equal(pending.length, 9, 'all independent overview reads start before any resolves');
  for (const entry of pending.reverse()) entry.hold.resolve();
  assert.deepEqual((await result).map(section => section.title), ['بيانات الحساب', 'المنشأة · Provider', 'البيانات التجارية · Provider', 'طلب انضمام المزود · Applicant', 'هوية المقاول', 'الملف المهني للمقاول', 'التخصصات ومناطق العمل', 'طلب انضمام المقاول · Contractor applicant', 'الدور الإداري', 'بيانات السائق']);
}
// Empty and restricted permission sets must not even issue privileged section queries.
for (const permissions of [[], ['roles.manage'], ['deliveries.manage']]) {
  const queried = [];
  const admin = {from(table) {queried.push(table); const q = {select: () => q, eq: () => q, in: () => q, then: done => Promise.resolve({data: []}).then(done)}; return q;}};
  const sections = await detail.overviewSections({admin, permissions: new Set(permissions), profile: {id: target}}, links);
  assert.equal(sections.length, 1);
  assert.deepEqual(queried, permissions.includes('roles.manage') ? ['admin_users'] : permissions.includes('deliveries.manage') ? ['provider_drivers'] : []);
}

const identityModule = load('src/lib/auth/resolve-identity.ts', {'@/lib/supabase/archive-fetch': archive, './types': load('src/lib/auth/types.ts')});
for (const mode of ['ready', 'missing-role', 'permission-fallback', 'join-error']) {
  const tables = [];
  const db = {rpc: async (name, args) => {assert.equal(name, 'admin_has_permission'); assert.equal(args.requested_permission, 'profiles.read'); return {data: mode === 'permission-fallback'};}, from(table) {
    tables.push(table);
    const result = table === 'profiles' ? {data: {id: target, is_active: true}} : table === 'user_roles' ? {data: [{role: 'admin', is_primary: true}]} :
      {data: {id: 'membership', role_id: 'role', is_active: true, admin_role: ['missing-role', 'permission-fallback'].includes(mode) ? null : {role_key: 'owner'}}, error: mode === 'join-error' ? {message: 'relation unavailable'} : null};
    const q = {select: value => {if (table === 'admin_users') assert.match(value, /admin_role:admin_roles!role_id\(role_key\)/); return q;}, eq: () => q, is: () => q,
      maybeSingle: () => Promise.resolve(result), then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)};
    return q;
  }};
  if (mode === 'join-error') await assert.rejects(identityModule.resolveAuthIdentity(db, {id: target}), /Unable to verify role membership/);
  else {
    const identity = await identityModule.resolveAuthIdentity(db, {id: target});
    assert.equal(identity.status, mode === 'missing-role' ? 'role_not_ready' : 'ready');
    assert.equal(identity.details.admin?.roleKey ?? null, mode === 'ready' ? 'owner' : mode === 'permission-fallback' ? 'authorized_admin' : null);
  }
  assert.deepEqual(tables, ['profiles', 'user_roles', 'admin_users'], 'joined role avoids a dependent admin_roles query');
}

let routeState;
function queryBuilder(table) {
  routeState.tables.push(table);
  const q = {select: () => q, eq: () => q, in: () => q, order: () => q, or: () => q, range: () => q,
    then: (resolve, reject) => Promise.resolve({data: [], count: 0}).then(resolve, reject)};
  return q;
}
const route = load('src/app/api/admin/users/[id]/route.ts', {
  '@/lib/admin/user-details': {...detail,
    requireUserDetailAccess: async () => routeState.access,
    userDetailLinks: async () => {routeState.linkCalls++; return links;},
    overviewSections: async () => [{title: 'account', fields: []}],
    documentQuery: (_access, requestedLinks, _id, source) => {assert.equal(source, 'files'); assert.deepEqual(requestedLinks.providerIds, []); return queryBuilder('files');},
  },
  '@/lib/auth/resolve-identity': {resolveAuthIdentity: async (db) => {routeState.identityCalls++; assert.equal(db, routeState.expectedIdentityDb); return {status: routeState.identityStatus};}},
  '@/lib/supabase/archive-server': {archiveActorStatus: async () => {routeState.archiveCalls++; return routeState.archiveStatus;}},
  '@/lib/supabase/archive-fetch': archive, '@/lib/admin/records': records,
});
function resetRoute() {
  routeState = {tables: [], linkCalls: 0, identityCalls: 0, archiveCalls: 0, identityStatus: 'ready', archiveStatus: {active: false, eligible: false}, targetUser: {id: target, email_confirmed_at: '2026-01-01'}};
  const archived = {};
  const admin = {from: queryBuilder, schema: name => {assert.equal(name, 'admin_archive'); return archived;}, auth: {admin: {getUserById: async () => ({data: {user: routeState.targetUser}})}}};
  routeState.access = {admin, permissions: new Set(['profiles.read']), profile: {id: target, full_name: 'Account', is_active: true}, actor: ready, canImpersonate: false};
  routeState.expectedIdentityDb = admin; routeState.archivedDb = archived;
}
const get = query => route.GET(new Request(`https://example.test/api/admin/users/${target}?${query}`), {params: Promise.resolve({id: target})});
for (const query of ['section=documents', 'section=documents&source=files', 'section=activity', 'section=unknown']) {
  resetRoute(); const response = await get(query);
  assert.equal(response.status, query.includes('unknown') ? 400 : query.includes('activity') ? 403 : 200);
  assert.equal(routeState.linkCalls, 0); assert.equal(routeState.identityCalls, 0);
  assert.deepEqual(routeState.tables, query.includes('documents') ? ['files'] : []);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
}
for (const mode of ['forbidden', 'self', 'unconfirmed', 'eligible', 'archived', 'not-ready']) {
  resetRoute(); routeState.access.canImpersonate = mode !== 'forbidden';
  if (mode === 'self') routeState.access.actor = {...ready, userId: target};
  if (mode === 'unconfirmed') routeState.targetUser.email_confirmed_at = null;
  if (mode === 'not-ready') routeState.identityStatus = 'disabled';
  if (mode === 'archived') {routeState.archiveStatus = {active: true, eligible: true}; routeState.expectedIdentityDb = routeState.archivedDb;}
  const response = await get(''), body = await response.json();
  assert.equal(response.status, 200); assert.equal(routeState.linkCalls, 1);
  const checked = ['eligible', 'archived', 'not-ready'].includes(mode);
  assert.equal(routeState.identityCalls, checked ? 1 : 0); assert.equal(routeState.archiveCalls, checked ? 1 : 0);
  assert.equal(body.canImpersonate, ['eligible', 'archived'].includes(mode));
  assert.deepEqual(body.sections.map(section => section.title), ['account', 'تاريخ الأدوار', 'حالة الدخول']);
}
console.log('Platform performance HTTP PASS: credential-isolated in-flight coalescing and retries, archive writes denied, parallel authorization fails closed, section permission guards, document/activity fast paths, impersonation gates/schema and overview ordering.');
