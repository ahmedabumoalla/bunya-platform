import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), Date, console, Map, URL });
  return exports;
}
const manifest = JSON.parse(readFileSync('src/data/catalog/imported.json', 'utf8'));
const options = JSON.parse(readFileSync('src/data/catalog/quote-options.json', 'utf8'));
const canonical = load('src/lib/quotes/managed-catalog.ts', { 'server-only': {}, '@/data/catalog/imported.json': manifest, '@/data/catalog/quote-options.json': options });
const normalizer = load('src/lib/quotes/pending-draft.ts');
const first = manifest.products[0], firstVariant = options[first.id][0];
const cart = { id: 'cart-1', productId: first.id, productName: 'forged', quantity: 2.125, unit: first.units[0], measurementId: '', selectedVariants: [{ id: firstVariant.sku, name: 'forged', attributes: [{ label: 'forged', value: 'forged' }] }], notes: 'site notes' };
const normalized = normalizer.normalizePendingStorefrontQuote({ items: [cart], idempotencyKey: 'managed-test-123', details: {} });
assert.ok(normalized);
const item = canonical.canonicalPlatformQuoteItem(normalized.items[0], 0);
assert.equal(item.product_name, first.name);
assert.deepEqual(JSON.parse(JSON.stringify(item.attributes)), firstVariant.attributes);
assert.throws(() => canonical.canonicalPlatformQuoteItem({ ...cart, unit: 'forged' }, 0));
assert.throws(() => canonical.canonicalPlatformQuoteItem({ ...cart, selectedVariants: [{ id: 'NOT-REAL-SKU' }] }, 0));
assert.throws(() => canonical.canonicalPlatformQuoteItem({ ...cart, productId: 'brkz-000000000000000000000000' }, 0));
assert.equal(normalizer.normalizePendingStorefrontQuote({ items: [{ ...cart, selectedVariants: [...cart.selectedVariants, ...cart.selectedVariants] }], idempotencyKey: 'managed-test-123' }), null);
for (const product of manifest.products) {
  const variant = options[product.id][0];
  const candidate = { ...cart, productId: product.id, unit: product.units[0] || 'تحددها الإدارة', selectedVariants: variant ? [{ id: variant.sku, attributes: [] }] : [] };
  assert.ok(canonical.canonicalPlatformQuoteItem(candidate, 0), 'Every real catalog product can be requested');
}

const customer = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const quoteId = '20000000-0000-4000-8000-000000000001';
let actor = customer, signedIn = true, roles = ['customer'], permission = false, accountReady = true, originBearer = false;
let row = { id: quoteId, customer_id: customer, status: 'submitted', pricing: [{ unit_price: 100 }], total: 100, terms: 'draft', revision: 1 };
const rpcCalls = [];
let resultForConfirm = { ok: false, attempts_remaining: 4 };
const db = {
  from(table) {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, range() { return query; },
      async maybeSingle() { return { data: table === 'managed_quote_requests' ? row : { customer_code_ciphertext: 'encrypted', expires_at: new Date(Date.now() + 3600000).toISOString(), verified_at: null, attempts: 0, max_attempts: 5 }, error: null }; },
      then(resolve) { return Promise.resolve(resolve({ data: [row], count: 1, error: null })); } };
    return query;
  },
  async rpc(name, payload) { rpcCalls.push({ name, payload }); return { error: null, data: name === 'admin_has_permission' ? permission : name === 'managed_quote_submit' ? quoteId : name === 'managed_quote_confirm_delivery' ? resultForConfirm : { issued: true } }; },
};
const server = load('src/lib/quotes/managed-server.ts', {
  'server-only': {}, '@/lib/auth/request-client': { createAuthRequestClient: async () => ({ error: null, user: signedIn ? { id: actor } : null, supabase: db, usesBearer: originBearer }) },
  '@/lib/auth/resolve-identity': { resolveAuthIdentity: async () => ({ status: accountReady ? 'ready' : 'suspended', activeRoles: roles, profile: { mustChangePassword: false } }) },
  '@/lib/supabase/admin': { createAdminClient: () => db }, '@/lib/delivery/code-vault': { encryptDeliveryCode: () => 'encrypted', decryptDeliveryCode: () => '123456' }, './managed-catalog': canonical,
});
const request = (method = 'GET', body, origin) => new NextRequest(`https://example.com/api/managed-quotes/${quoteId}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const route = load('src/app/api/managed-quotes/[id]/route.ts', { '@/lib/quotes/managed-server': server });
const codeRoute = load('src/app/api/managed-quotes/[id]/delivery-code/route.ts', { '@/lib/quotes/managed-server': server });
const params = { params: Promise.resolve({ id: quoteId }) };
signedIn = false; assert.equal((await route.GET(request(), params)).status, 401);
signedIn = true; roles = ['provider']; assert.equal((await route.GET(request(), params)).status, 403);
roles = ['customer']; actor = other; assert.equal((await route.GET(request(), params)).status, 404);
actor = customer; accountReady = false; assert.equal((await route.GET(request(), params)).status, 403);
accountReady = true;
let response = await route.GET(request(), params); let body = await response.json();
assert.deepEqual(body.request.pricing, []); assert.equal(body.request.total, 0); assert.equal(body.request.terms, '');
assert.equal(response.headers.get('cache-control'), 'private, no-store');
assert.equal((await route.POST(request('POST', { action: 'publish_quote', revision: 1, payload: {} }), params)).status, 403);
assert.equal((await route.POST(request('POST', { action: 'accept', revision: 1 }, 'https://evil.example'), params)).status, 403);
assert.equal((await codeRoute.GET(request(), params)).status, 409);
row = { ...row, status: 'accepted' };
response = await codeRoute.GET(request(), params); body = await response.json(); assert.equal(body.code, '123456');
assert.match(response.headers.get('cache-control'), /no-store/);
assert.ok(rpcCalls.some(call => call.name === 'managed_quote_issue_code' && call.payload.p_actor === customer && call.payload.p_reissue === false));
roles = ['admin']; permission = true; actor = other;
assert.equal((await codeRoute.GET(request(), params)).status, 403, 'Admin can never reveal the code');
response = await route.POST(request('POST', { action: 'confirm_delivery', code: '123456' }), params);
assert.equal(response.status, 409); assert.equal((await response.json()).attemptsRemaining, 4);
resultForConfirm = { ok: true, status: 'delivered' };
assert.equal((await route.POST(request('POST', { action: 'confirm_delivery', code: '123456' }), params)).status, 200);
response = await route.POST(request('POST', { action: 'reissue_code' }), params);
assert.equal(response.status, 200); assert.ok(!JSON.stringify(await response.json()).includes('123456'));
assert.ok(rpcCalls.some(call => call.name === 'managed_quote_issue_code' && call.payload.p_reissue));
permission = false; assert.equal((await route.POST(request('POST', { action: 'confirm_delivery', code: '123456' }), params)).status, 403);
roles = ['customer']; actor = customer;
const ctx = await server.managedQuoteContext(request());
await server.submitManagedQuote(ctx, normalized);
const submit = rpcCalls.find(call => call.name === 'managed_quote_submit');
assert.equal(submit.payload.p_actor, customer); assert.equal(submit.payload.p_items[0].product_name, first.name);
assert.ok(!rpcCalls.some(call => ['submit_storefront_rfq', 'submit_customer_rfq'].includes(call.name)), 'Never dispatch new requests to suppliers');
const submitRoute = load('src/app/api/customer/quote-requests/route.ts', {
  '@/lib/quotes/managed-server': server,
  '@/lib/quotes/pending-draft': normalizer,
  '@/lib/auth/phone-verification': { normalizeSaudiPhone: value => /^\+9665\d{8}$/.test(value) ? value : null },
  '@/lib/quotes/pending-draft-server': { deletePendingQuote: async () => {}, pendingQuoteCookie: 'draft', pendingQuoteCookieOptions: { path: '/' } },
});
const fullDraft = { ...normalized, details: { ...normalized.details, locationHint: 'Test site', mapsUrl: 'https://maps.app.goo.gl/test', desiredReceiptAt: new Date(Date.now() + 4 * 3600000).toISOString(), recipientName: 'Customer', recipientMobile: '+966500000001', siteResponsibleName: 'Site manager', siteResponsibleMobile: '+966500000002', workingHours: '07:00-17:00', loadingOption: 'included', unloadingOption: 'included', roadAccess: 'open', accessInstructions: 'Main gate', driverDepartureLiabilityAccepted: true, dataAccuracyAccepted: true } };
response = await submitRoute.POST(request('POST', fullDraft));
assert.equal(response.status, 201);
body = await response.json(); assert.equal(body.redirectUrl, `/customer/managed-quotes/${quoteId}`);
assert.equal(body.outsidePricingHours, false);
assert.ok(!rpcCalls.some(call => ['submit_storefront_rfq', 'submit_customer_rfq'].includes(call.name)));
console.log('PASS all598 requestable catalog items, canonical SKU trust, role/owner isolation, CSRF, hidden draft pricing, customer-only code, admin confirm/reissue, cache protection and no supplier dispatch.');
