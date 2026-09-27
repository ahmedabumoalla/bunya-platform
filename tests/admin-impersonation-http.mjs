import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const originalSecret = process.env.SUPABASE_SECRET_KEY;
process.env.SUPABASE_SECRET_KEY = 'isolated-maintenance-cookie-fixture-not-a-real-key';
const crypto = load('src/lib/auth/impersonation-cookie.ts');
const id = '11111111-1111-4111-8111-111111111111';
const ticket = { id, actorId: id, actorSessionId: id, targetId: id, targetSessionId: id, accessToken: 'private-fixture-token', expiresAt: Date.now() + 60_000 };
const sealed = crypto.sealImpersonation(ticket);
assert.deepEqual(crypto.openImpersonation(sealed), ticket);
assert.ok(!sealed.includes(ticket.accessToken));
const tampered = Buffer.from(sealed, 'base64url'); tampered[30] ^= 1;
assert.equal(crypto.openImpersonation(tampered.toString('base64url')), null);
assert.equal(crypto.openImpersonation('invalid'), null);
assert.equal(crypto.openImpersonation('a'.repeat(6001)), null);
process.env.SUPABASE_SECRET_KEY = 'different-fixture-key';
assert.equal(crypto.openImpersonation(sealed), null);
if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const requests = [];
globalThis.fetch = async (input, init) => { requests.push({ input, init }); return new Response('{}'); };
globalThis.document = { cookie: '' };
const browser = load('src/lib/supabase/client.ts', {
  '@supabase/ssr': { createBrowserClient: (_url, _key, options) => options },
  './env': { getSupabasePublicEnv: () => ({ url: 'https://fixture.supabase.co', key: 'public-key' }) },
}).createClient();
await browser.global.fetch('https://fixture.supabase.co/rest/v1/orders', { headers: { authorization: 'original-admin-token' } });
assert.equal(requests.at(-1).input, 'https://fixture.supabase.co/rest/v1/orders');
globalThis.document.cookie = 'bunya-maintenance-active=1';
await browser.global.fetch('https://fixture.supabase.co/rest/v1/orders?select=id', { method: 'PATCH', headers: { authorization: 'original-admin-token', apikey: 'public-key' }, body: '{}' });
assert.equal(requests.at(-1).input, '/api/maintenance/supabase/rest/v1/orders?select=id');
assert.equal(requests.at(-1).init.headers.get('authorization'), null);
assert.equal(requests.at(-1).init.headers.get('apikey'), null);
assert.equal(requests.at(-1).init.body, '{}');
await browser.global.fetch('https://fixture.supabase.co/auth/v1/user');
assert.equal(requests.at(-1).input, '/api/maintenance/supabase/auth/v1/user');
await browser.global.fetch('https://fixture.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' });
assert.equal(requests.at(-1).input, 'https://fixture.supabase.co/auth/v1/token?grant_type=refresh_token');
await browser.global.fetch('https://other.example/rest/v1/orders');
assert.equal(requests.at(-1).input, 'https://other.example/rest/v1/orders');

let active = true;
const guard = load('src/lib/auth/impersonation.ts', {
  react: { cache: fn => fn }, 'next/headers': {},
  '@supabase/supabase-js': {}, '@/lib/supabase/session': {}, '@/lib/supabase/admin': {},
  '@/lib/supabase/env': {}, './resolve-identity': {}, './impersonation-cookie': {},
}).assertMaintenanceOrigin;
const proxy = load('src/app/api/maintenance/supabase/[...path]/route.ts', {
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/auth/impersonation': { getImpersonation: async () => { if (!active) throw new Error('expired'); return ticket; }, assertMaintenanceOrigin: guard },
  '@/lib/supabase/env': { getSupabasePublicEnv: () => ({ url: 'https://fixture.supabase.co', key: 'public-key' }) },
  '@/lib/supabase/admin': { createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
});
async function call(path, method = 'GET', origin = 'https://platform.example') {
  return proxy[method](new Request('https://platform.example/api/maintenance/supabase/' + path.join('/'), {
    method, headers: { origin, authorization: 'untrusted-incoming-token' }, body: method === 'POST' ? '{}' : undefined,
  }), { params: Promise.resolve({ path }) });
}
for (const path of [['auth','v1','admin','users'],['auth','v1','token'],['rest','v1','..','auth'],['rest','v1','x/y'],['functions','v1','anything']]) {
  assert.equal((await call(path)).status, 403);
}
assert.equal((await call(['auth','v1','user'], 'POST')).status, 403);
assert.equal((await call(['rest','v1','orders'], 'POST', 'https://attacker.example')).status, 403);
assert.equal((await call(['rest','v1','orders'], 'POST', '')).status, 403);
const response = await call(['rest','v1','orders'], 'POST');
assert.equal(response.status, 200);
assert.equal(requests.at(-1).init.headers.get('authorization'), 'Bearer private-fixture-token');
assert.equal(requests.at(-1).init.headers.get('apikey'), 'public-key');
assert.equal(response.headers.get('authorization'), null);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
active = false;
assert.equal((await call(['rest','v1','orders'])).status, 403);
globalThis.fetch = originalFetch;
if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
console.log('PASS: sealed-cookie tampering, key separation, browser/server identity transport, proxy allowlist, CSRF, token isolation and expired sessions.');
