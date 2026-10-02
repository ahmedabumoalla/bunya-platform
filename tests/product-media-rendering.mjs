import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { return Object.hasOwn(mocks, name) ? mocks[name] : require(name); }, console });
  return exports;
}
const media = load('src/lib/products/image-urls.ts');
const calls = [];
const storage = { from(bucket) { assert.equal(bucket, 'provider-product-images'); return { async createSignedUrl(path, expires, options) { calls.push({ path, expires, options }); return { data: { signedUrl: `https://test.invalid/${path}?signed=1` } }; } }; } };
for (const [extension, mime] of [['mp4', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime']]) {
  assert.equal(media.isProductVideo({ mime_type: mime }), true);
  assert.equal(media.isProductVideo({ image_url: `https://test.invalid/media.${extension.toUpperCase()}?token=1` }), true);
  await media.signProductImage({ storage }, `media.${extension}`, '', { width: 200 });
  assert.equal(calls.at(-1).options, undefined, 'Video must bypass image transformation');
}
await media.signProductImageMap({ storage }, [{ storage_path: 'extensionless', mime_type: 'video/mp4' }, { storage_path: 'cover.jpg', mime_type: 'image/jpeg' }]);
assert.equal(calls.find(item => item.path === 'extensionless').options, undefined);
assert.equal(calls.find(item => item.path === 'cover.jpg').options.transform.width, 640);
const beforeCache = calls.length;
await media.signProductImage({ storage }, 'media.mp4');
assert.equal(calls.length, beforeCache);
assert.equal(await media.signProductImage({ storage }, null, 'fallback'), 'fallback');
console.log('PASS video MIME/extension detection, direct signing, image transformation and cache');

const ui = load('src/components/home/HomeStorefrontUi.tsx', {
  '@/lib/products/image-urls': media,
  '@/components/brand/BunyaLogo': {},
  '@/components/i18n/LanguageSwitcher': {},
});
for (const mimeType of ['video/mp4', 'video/webm', 'video/quicktime']) {
  const image = { id: 'v', label: 'Product video', alt: 'Product demonstration', tone: 'cement', mimeType, url: 'https://test.invalid/media' };
  const hero = renderToStaticMarkup(React.createElement(ui.ProductArtwork, { image, large: true }));
  assert.match(hero, /<video/); assert.match(hero, /controls=""/); assert.match(hero, /preload="metadata"/); assert.match(hero, /playsInline=""/); assert.doesNotMatch(hero, /<img/);
  const thumb = renderToStaticMarkup(React.createElement(ui.ProductArtwork, { image }));
  assert.doesNotMatch(thumb, /<(video|img)/, 'Thumbnail button must not contain nested video controls');
}
const photo = renderToStaticMarkup(React.createElement(ui.ProductArtwork, { image: { label: 'Cover', tone: 'cement', url: 'https://test.invalid/cover.jpg' }, large: true }));
assert.match(photo, /<img/); assert.doesNotMatch(photo, /<video/);
console.log('PASS public gallery video controls and noninteractive thumbnails; image gallery preserved');

const data = {
  products: [{ id: 'p', name: 'Product', base_unit: 'piece', delivery_label: '', rental_duration_value: null }],
  product_categories: [],
  product_images: [
    { id: 'bad-video-primary', product_id: 'p', storage_path: 'catalog.mp4', mime_type: 'video/mp4', is_primary: true, tone: 'cement' },
    { id: 'chosen-cover', product_id: 'p', storage_path: 'chosen.jpg', mime_type: 'image/jpeg', is_primary: true, tone: 'cement' },
    { id: 'other-image', product_id: 'p', storage_path: 'other.jpg', mime_type: 'image/jpeg', is_primary: false, tone: 'cement' },
  ],
};
const db = { storage, from(table) { const query = { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, not() { return this; }, then(resolve, reject) { return Promise.resolve({ data: data[table] || [], error: null }).then(resolve, reject); } }; return query; } };
const catalog = load('src/lib/catalog/server.ts', {
  'server-only': {}, '@/lib/products/image-urls': media,
  '@/lib/supabase/admin': { createAdminClient: () => db }, '@/lib/supabase/server': { createClient: async () => db },
  'next/headers': { cookies: async () => ({ get: () => undefined }) },
  '@/lib/i18n/config': { defaultLocale: 'ar', isAppLocale: () => false, localeCookieName: 'locale' },
});
const result = await catalog.loadPublicCatalog();
assert.equal(result.products[0].images[0].id, 'chosen-cover');
assert.equal(result.products[0].images.at(-1).mimeType, 'video/mp4');
assert.equal(calls.find(item => item.path === 'catalog.mp4').options, undefined);
console.log('PASS catalog MIME propagation and image cover before videos');
