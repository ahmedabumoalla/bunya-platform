import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
const code = new Map();
function load(path, mocks = {}, globals = {}) {
  if (!code.has(path)) code.set(path, ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const exports = {};
  vm.runInNewContext(code.get(path), { exports, File, FormData, Response, Headers, URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal, crypto: crypto.webcrypto, console: { error() {} }, fetch() { throw Error('Unexpected network access'); }, require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; if (name === 'server-only') return {}; if (name === 'node:crypto') return crypto; throw Error(`Unexpected dependency ${name}`); }, ...globals });
  return exports;
}
const security = load('src/lib/join/security.ts');
const bounded = load('src/lib/join/provider-upload-batches.ts', { '@/lib/supabase/admin': {}, '@/lib/supabase/env': {}, './security': security, './provider-fields': {}, './contractor-fields': {}, './contractor-validation': {} });
const media = load('src/lib/products/media.ts');
const providerId = '10000000-0000-4000-8000-000000000001', productId = '20000000-0000-4000-8000-000000000001';
const fileId = '30000000-0000-4000-8000-000000000001';
const env = { getSupabasePublicEnv: () => ({ url: 'https://fixture.supabase.co' }) };
const endpoint = 'https://fixture.storage.supabase.co/storage/v1/upload/resumable/sign';
const descriptor = (extra = {}) => ({ name: 'photo.jpg', mimeType: 'image/jpeg', size: 12, ...extra });
const uploaded = (extra = {}) => ({ path: `${providerId}/${productId}/uploads/${fileId}.jpg`, ...descriptor(), ...extra });
const status = expected => error => error?.status === expected;
let cases = 0;
function initHarness(options = {}) {
  const signed = [], lookups = [];
  const identity = options.anonymous ? null : { status: options.identityStatus || 'ready', activeRoles: options.roles || ['provider'], details: { provider: options.noProvider ? null : { providerId } } };
  const db = {
    from(table) { assert.equal(table, 'products'); return { select() { return this; }, eq(key, value) { lookups.push([key, value]); return this; }, async maybeSingle() { return { error: options.lookupError || null, data: options.missing ? null : { provider_id: options.foreign ? 'foreign' : providerId, review_status: options.reviewStatus || 'approved', is_published: options.published ?? true } }; } }; },
    storage: { from(bucket) { assert.equal(bucket, media.PRODUCT_MEDIA_BUCKET); return { async createSignedUploadUrl(path, config) { signed.push({ path, config }); return options.signError ? { error: Error('no') } : { data: { token: 'test-token' }, error: null }; } }; } },
  };
  const route = load('src/app/api/provider/products/uploads/route.ts', { '@/lib/auth/server': { getAuthIdentity: async () => identity }, '@/lib/supabase/admin': { createAdminClient: () => db }, '@/lib/supabase/env': env, '@/lib/join/security': security, '@/lib/join/provider-upload-batches': bounded, '@/lib/products/media': media });
  return { signed, lookups, async post(body = { files: [descriptor()] }, origin = 'https://bunya.invalid') { return route.POST({ headers: new Headers({ origin }), nextUrl: new URL('https://bunya.invalid/api/provider/products/uploads'), body: new Response(typeof body === 'string' ? body : JSON.stringify(body)).body }); } };
}
for (const options of [{ anonymous: true }, { identityStatus: 'password_reset_required' }, { roles: ['customer'] }, { noProvider: true }]) {
  const h = initHarness(options); assert.equal((await h.post()).status, 401); assert.equal(h.signed.length, 0); cases++;
}
{
  const h = initHarness(); assert.equal((await h.post(undefined, 'https://evil.invalid')).status, 403); assert.equal(h.signed.length, 0); cases++;
}
for (const [options, expected] of [[{ foreign: true }, 404], [{ missing: true }, 404], [{ reviewStatus: 'draft' }, 409], [{ reviewStatus: 'pending_review' }, 409], [{ published: false }, 409], [{ lookupError: Error('db') }, 500], [{ signError: true }, 500]]) {
  const h = initHarness(options); assert.equal((await h.post({ productId, files: [descriptor()] })).status, expected); if (!options.signError) assert.equal(h.signed.length, 0); cases++;
}
for (const body of ['{', ' '.repeat(16001), {}, { files: [] }, { files: Array.from({ length: 7 }, () => descriptor()) }, { productId: '../escape', files: [descriptor()] }, ...[null, descriptor({ name: '' }), descriptor({ name: 'bad\nname.jpg' }), descriptor({ name: 'x'.repeat(201) }), descriptor({ mimeType: 'image/svg+xml' }), descriptor({ size: -1 }), descriptor({ size: 0 }), descriptor({ size: 1.5 }), descriptor({ size: '12' }), descriptor({ size: 5 * 1024 ** 2 + 1 }), descriptor({ mimeType: 'video/mp4', size: 100 * 1024 ** 2 + 1 })].map(file => ({ files: [descriptor(), file] }))]) {
  const h = initHarness(), response = await h.post(body); assert.ok([400, 413].includes(response.status), `Expected invalid metadata refusal: ${response.status}`); assert.equal(h.signed.length, 0, 'Validate every descriptor before issuing upload capability'); cases++;
}
for (const reviewStatus of ['approved', 'needs_changes']) {
  const h = initHarness({ reviewStatus });
  const response = await h.post({ productId, files: [descriptor({ size: 5 * 1024 ** 2 }), descriptor({ mimeType: 'video/mp4', size: 100 * 1024 ** 2 }), descriptor({ mimeType: 'video/webm' }), descriptor({ mimeType: 'video/quicktime' })] });
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.productId, productId); assert.equal(value.endpoint, endpoint); assert.equal(value.bucket, media.PRODUCT_MEDIA_BUCKET); assert.deepEqual(value.files.map(item => item.mimeType), ['image/jpeg', 'video/mp4', 'video/webm', 'video/quicktime']); assert.deepEqual(h.lookups, [['id', productId]]);
  for (const target of h.signed) { assert.ok(target.path.startsWith(`${providerId}/${productId}/uploads/`)); assert.equal(target.config.upsert, false); } cases++;
}
{
  const h = initHarness(), response = await h.post(), value = await response.json(); assert.equal(response.status, 200); assert.match(value.productId, /^[0-9a-f-]{36}$/); assert.equal(h.lookups.length, 0); assert.ok(h.signed[0].path.startsWith(`${providerId}/${value.productId}/uploads/`)); cases++;
}
console.log(`PASS ${cases} upload initialization authorization, state, descriptor limits and scoped signing cases`);

const headers = { 'image/jpeg': [255, 216, 255], 'image/png': [137, 80, 78, 71], 'image/webp': [...Buffer.from('RIFF0000WEBP')], 'video/mp4': [...Buffer.from('0000ftypmp42')], 'video/quicktime': [...Buffer.from('0000moov0000')], 'video/webm': [0x1a, 0x45, 0xdf, 0xa3] };
function verifyHarness(options = {}) {
  const infoCalls = [], signed = [], requests = [], state = { cancelled: false, arrayBuffers: 0 };
  const bucket = { async info(path) { infoCalls.push(path); return { data: { size: 12, contentType: options.mime || 'image/jpeg', ...options.info }, error: options.infoError || null }; }, async createSignedUrl(path, duration) { signed.push({ path, duration }); return options.signError ? { error: Error('sign') } : { data: { signedUrl: 'https://storage.invalid/object' } }; } };
  const verifier = load('src/lib/products/media-server.ts', { '@/lib/supabase/admin': { createAdminClient: () => ({ storage: { from(name) { assert.equal(name, media.PRODUCT_MEDIA_BUCKET); return bucket; } } }) }, '@/lib/join/provider-upload-batches': bounded, '@/lib/join/security': security, './media': media }, { async fetch(url, config) {
    requests.push({ url, config }); const bytes = new Uint8Array(options.bytes || headers[options.mime || 'image/jpeg']);
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); if (!options.leaveOpen) controller.close(); }, cancel() { state.cancelled = true; } });
    const response = new Response(body, { status: options.responseStatus || 206 }); response.arrayBuffer = async () => { state.arrayBuffers++; throw Error('Must not buffer full file'); }; return response;
  } });
  return { infoCalls, signed, requests, state, run(values = [uploaded()]) { const form = new FormData(); form.set('uploaded_media', typeof values === 'string' ? values : JSON.stringify(values)); return verifier.verifiedProductMedia(form, providerId, productId); } };
}
const beforeVerifier = cases;
for (const mime of Object.keys(headers)) {
  const h = verifyHarness({ mime }); const values = await h.run([uploaded({ mimeType: mime })]); assert.equal(values[0].mimeType, mime); assert.equal(h.signed[0].duration, 60); assert.equal(h.requests[0].config.headers.Range, 'bytes=0-11'); assert.equal(h.requests[0].config.cache, 'no-store'); assert.equal(h.state.arrayBuffers, 0); cases++;
}
for (const values of ['{', 'x'.repeat(16001), {}, [null], [uploaded(), uploaded()], Array.from({ length: 7 }, () => uploaded()), [uploaded({ path: `foreign/${productId}/uploads/${fileId}.jpg` })], [uploaded({ path: `${providerId}/foreign/uploads/${fileId}.jpg` })], [uploaded({ path: `${providerId}/${productId}/uploads/../${fileId}.jpg` })], [uploaded({ path: `${providerId}/${productId}/uploads/${fileId}.exe` })], [uploaded({ name: '\u0000' })], [uploaded({ size: '12' })], [uploaded({ mimeType: 'application/pdf' })]]) {
  const h = verifyHarness(); await assert.rejects(h.run(values), status(400)); assert.equal(h.infoCalls.length, 0); cases++;
}
for (const [options, expected] of [[{ info: { size: 13 } }, 400], [{ info: { contentType: 'video/mp4' } }, 400], [{ infoError: Error('not uploaded') }, 400], [{ bytes: [0, 0, 0] }, 400], [{ responseStatus: 200, leaveOpen: true }, 503], [{ bytes: Array(13).fill(255), leaveOpen: true }, 413]]) {
  const h = verifyHarness(options); await assert.rejects(h.run(), status(expected)); assert.equal(h.state.arrayBuffers, 0); if (options.leaveOpen) assert.equal(h.state.cancelled, true); cases++;
}
{
  const h = verifyHarness({ signError: true }); await assert.rejects(h.run(), /product_media_sign_failed/); assert.equal(h.requests.length, 0); cases++;
}
console.log(`PASS ${cases - beforeVerifier} verifier ownership, duplicates, MIME/size/signature and bounded range cases`);

function clientHarness(options = {}) {
  const optimized = [], requests = [], uploads = [], removed = [], progress = [];
  const batch = { productId, bucket: media.PRODUCT_MEDIA_BUCKET, endpoint, files: [] };
  const client = load('src/lib/uploads/product-media-client.ts', {
    './client': { async optimizeUploadFile(file) { optimized.push(file); return new File(['optimized'], `${file.name}.webp`, { type: 'image/webp' }); } },
    '@/lib/supabase/env': env, '@/lib/products/media': media,
    '@/lib/supabase/client': { createClient: () => ({ storage: { from(bucket) { assert.equal(bucket, media.PRODUCT_MEDIA_BUCKET); return { async remove(paths) { removed.push([...paths]); if (options.cleanupError) throw Error('cleanup'); return { error: null }; } }; } } }) },
    'tus-js-client': { Upload: class { constructor(file, settings) { this.file = file; this.settings = settings; uploads.push(this); } start() { if (options.failAt === uploads.length) this.settings.onError(Error('network')); else { this.settings.onProgress(this.file.size, this.file.size); this.settings.onSuccess(); } } } },
  }, { async fetch(url, config) {
    requests.push({ url, config }); const metadata = JSON.parse(config.body); batch.files = metadata.files.map((file, index) => ({ ...file, path: `${providerId}/${productId}/uploads/${index}.media`, token: `token-${index}` })); if (options.batch) Object.assign(batch, options.batch); return Response.json(options.initError ? { error: 'init denied' } : batch, { status: options.initError ? 400 : 200 });
  } });
  return { optimized, requests, uploads, removed, progress, batch, async run(form, product = productId) { return client.uploadProductMedia(form, { productId: product, onProgress: value => progress.push(value) }); } };
}
function clientForm() { const form = new FormData(); form.append('images', new File(['video'], 'movie.mp4', { type: 'video/mp4' })); form.append('images', new File(['image'], 'cover.jpg', { type: 'image/jpeg' })); form.append('images', new File(['quicktime'], 'movie.mov', { type: 'video/quicktime' })); form.set('primary_image', 'new:1'); form.set('name', 'product name'); return form; }
const beforeClient = cases;
{
  const h = clientHarness(), form = clientForm(); await h.run(form); assert.equal(h.optimized.length, 1); assert.equal(h.optimized[0].type, 'image/jpeg'); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/provider/products/uploads'); assert.equal(h.requests[0].config.headers['Content-Type'], 'application/json'); const request = JSON.parse(h.requests[0].config.body); assert.equal(request.productId, productId); assert.deepEqual(Object.keys(request.files[0]).sort(), ['mimeType', 'name', 'size']); assert.equal(h.uploads[0].file.type, 'video/mp4'); assert.equal(h.uploads[1].file.type, 'image/webp'); assert.equal(h.uploads[2].file.type, 'video/quicktime');
  for (const [index, upload] of h.uploads.entries()) { assert.equal(upload.settings.endpoint, endpoint); assert.equal(upload.settings.chunkSize, 6 * 1024 ** 2); assert.equal(upload.settings.storeFingerprintForResuming, false); assert.equal(upload.settings.headers['x-signature'], `token-${index}`); assert.equal(upload.settings.headers['x-upsert'], 'false'); assert.equal(upload.settings.metadata.objectName, h.batch.files[index].path); }
  assert.equal(form.getAll('images').length, 0); assert.equal(form.get('primary_image'), 'new:1'); assert.equal(form.get('name'), 'product name'); assert.equal(form.get('product_id'), productId); const uploaded = JSON.parse(form.get('uploaded_media')); assert.equal(uploaded[1].mimeType, 'image/webp'); assert.equal(Object.hasOwn(uploaded[0], 'token'), false); assert.equal(h.progress.at(-1), 100); assert.ok(h.progress.every((value, index) => value >= 0 && value <= 100 && (!index || value >= h.progress[index - 1]))); assert.equal(h.removed.length, 0); cases++;
}
for (const cleanupError of [false, true]) {
  const h = clientHarness({ failAt: 2, cleanupError }), form = clientForm(); await assert.rejects(h.run(form), /تعذر رفع/); assert.equal(h.removed.length, 1); assert.deepEqual(h.removed[0], h.batch.files.map(file => file.path)); assert.equal(form.getAll('images').length, 3); assert.equal(form.has('uploaded_media'), false); assert.equal(h.uploads.length, 2); cases++;
}
for (const batch of [{ endpoint: 'https://evil.invalid/storage/v1/upload/resumable/sign' }, { endpoint: `${endpoint}?redirect=evil` }, { bucket: 'other-bucket' }, { files: [] }]) { const h = clientHarness({ batch }), form = clientForm(); await assert.rejects(h.run(form), /وجهة الرفع/); assert.equal(h.uploads.length, 0); assert.equal(h.removed.length, 0); assert.equal(form.getAll('images').length, 3); cases++; }
{
  const h = clientHarness({ initError: true }); await assert.rejects(h.run(clientForm()), /init denied/); assert.equal(h.uploads.length, 0); cases++;
}
{
  const h = clientHarness(), form = new FormData(); form.set('primary_image', 'existing:123'); await h.run(form); assert.equal(h.requests.length, 0); assert.equal(form.get('primary_image'), 'existing:123'); cases++;
}
const selection = [{ key: 'new:0', mimeType: 'video/mp4' }, { key: 'new:1', mimeType: 'image/webp' }, { key: 'existing:2', mimeType: null }];
assert.equal(media.productPrimaryIndex('', selection), 1); assert.equal(media.productPrimaryIndex('new:1', selection), 1); assert.equal(media.productPrimaryIndex('new:0', selection), -1); assert.equal(media.productPrimaryIndex('missing', selection), -1); assert.equal(media.productPrimaryIndex('existing:2', selection), 2); cases++;
console.log(`PASS ${cases - beforeClient} direct TUS metadata, ordering/cover, trusted endpoint, progress and failure-cleanup cases`);
console.log(`PASS ${cases} total product media upload regression cases; no network/storage mutations`);
