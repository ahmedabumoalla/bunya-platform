import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
function compile(file) { return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText; }
function module(file, dependency) {
  const exports = {};
  vm.runInNewContext(compile(file), { exports, require: dependency });
  return exports;
}
let dictionaryLoads = 0;
const messages = module('src/lib/i18n/messages.ts', name => { if (name.endsWith('.json')) dictionaryLoads++; throw new Error(`Core messages must not import ${name}`); });
const config = module('src/lib/i18n/config.ts', require);
assert.equal(dictionaryLoads, 0);
assert.equal(config.languageSwitchingEnabled, false, 'Performance work must not activate multilingual mode');
for (const locale of config.supportedLocales) {
  for (const key of Object.keys(messages.messages.ar)) assert.equal(messages.translate(locale, key), messages.messages[locale][key]);
  assert.equal(messages.translateStatus(locale, 'delivered'), messages.messages[locale].statusDelivered);
}

let state, cursor, effects, documentStub, profileCalls, reloads, lazyResult, observed, disconnected;
function reset(cookie = 'bunya_locale=en') {
  state = []; cursor = 0; effects = []; profileCalls = 0; dictionaryLoads = 0; reloads = 0; observed = []; disconnected = 0;
  documentStub = { documentElement: {}, body: { dataset: {} }, cookie };
  lazyResult = { observeLiteralTranslations: locale => { observed.push(locale); return () => disconnected++; } };
}
const hooks = { ...React,
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = value; }]; },
  useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
};
function provider(enabled, preferred = 'en') {
  const exports = {};
  vm.runInNewContext(compile('src/components/i18n/LocaleProvider.tsx'), {
    exports, require: name => name === 'react' ? hooks : name === '@/lib/i18n/config' ? { ...config, languageSwitchingEnabled: enabled }
      : name === '@/lib/i18n/messages' ? messages
      : name === '@/lib/i18n/literal-translations' ? (dictionaryLoads++, lazyResult)
      : name === '@/lib/supabase/client' ? { createClient() {
        profileCalls++;
        const query = { select() { return query; }, update() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: { preferred_locale: preferred } }) };
        return { auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) }, from: () => query };
      } } : require(name),
    document: documentStub, location: { protocol: 'https:' }, window: { location: { reload() { reloads++; } } },
  });
  return exports.LocaleProvider;
}
function render(Component, initialLocale) { cursor = 0; effects = []; return Component({ initialLocale, children: null }).props.value; }
const flush = () => new Promise(resolve => setImmediate(resolve));

reset(); let Provider = provider(false), value = render(Provider, 'en');
for (const effect of effects) effect(); await value.setLocale('en'); await flush();
assert.equal(value.locale, 'ar'); assert.equal(value.direction, 'rtl');
assert.equal(dictionaryLoads, 0); assert.equal(profileCalls, 0); assert.equal(observed.length, 0);
assert.equal(documentStub.documentElement.lang, 'ar');

reset(); Provider = provider(true); value = render(Provider, 'ar');
for (const effect of effects) effect(); await flush();
assert.equal(dictionaryLoads, 0, 'Arabic locale never requests generated dictionary, even when switching is enabled');

reset(); Provider = provider(true); value = render(Provider, 'en');
assert.equal(value.t('loading'), messages.messages.en.loading, 'Initial non-Arabic keyed rendering is synchronous');
assert.equal(value.status('delivered'), messages.messages.en.statusDelivered);
assert.equal(dictionaryLoads, 0, 'Rendering alone does not request optional literal dictionary');
effects[0](); const disconnect = effects[1](); await flush();
assert.equal(dictionaryLoads, 1); assert.deepEqual(observed, ['en']);
assert.equal(documentStub.documentElement.dir, 'ltr');
disconnect(); assert.equal(disconnected, 1);

reset(); let resolveLazy;
lazyResult = new Promise(resolve => { resolveLazy = resolve; });
Provider = provider(true); render(Provider, 'ur');
const cancel = effects[1](); await flush(); cancel();
resolveLazy({ observeLiteralTranslations: locale => { observed.push(locale); return () => disconnected++; } }); await flush();
assert.equal(dictionaryLoads, 1); assert.deepEqual(observed, [], 'Unmount or locale change before chunk resolution cannot activate stale observer');

reset(); lazyResult = Promise.reject(new Error('Optional chunk unavailable'));
Provider = provider(true); value = render(Provider, 'en'); effects[1](); await flush();
assert.equal(value.t('home'), messages.messages.en.home, 'Optional literal failure preserves core translation');
assert.equal(observed.length, 0);

reset(''); Provider = provider(true, 'ur'); render(Provider, 'ar');
effects[2](); await flush();
value = render(Provider, 'ar');
assert.equal(value.locale, 'ur', 'Saved profile preference restoration remains supported when explicitly enabled');
assert.ok(documentStub.cookie.startsWith('bunya_locale=ur;'));
assert.equal(reloads, 1);
effects[1](); await flush(); assert.deepEqual(observed, ['ur']);

const dictionaries = ['literal-translations.generated.json', 'product-change-literals.json', 'phone-verification-literals.json'];
const generated = Object.assign({}, ...dictionaries.map(file => JSON.parse(readFileSync(`src/lib/i18n/${file}`, 'utf8'))));
const literals = module('src/lib/i18n/literal-translations.ts', name => name === './messages' ? messages : name.endsWith('.json') ? { default: JSON.parse(readFileSync(`src/lib/i18n/${name.slice(2)}`, 'utf8')) } : require(name));
assert.equal(literals.translateLiteral('ar', ' نص عربي ١٢٣ '), ' نص عربي ١٢٣ ');
const keyedSources = new Set(Object.values(messages.messages.ar));
let checked = 0;
for (const [source, translated] of Object.entries(generated)) {
  if (keyedSources.has(source) || !/[\u0600-\u06ff]/.test(source) || source.trim() !== source) continue;
  const expected = translated.en;
  if (!expected || /[\u0660-\u0669\u06f0-\u06f9٬٫]/.test(expected)) continue;
  assert.equal(literals.translateLiteral('en', ` ${source} `), ` ${expected} `, 'Literal dictionaries and whitespace behavior remain intact');
  if (++checked === 200) break;
}
assert.equal(checked, 200);
assert.ok(!readFileSync('src/lib/i18n/messages.ts', 'utf8').includes('.json'));
console.log('PASS locale lazy loading: zero dictionary/profile work while paused or Arabic; all synchronous keyed locales/statuses; deferred foreign observer, teardown/cancellation/failure, preference restoration and 200 literal translations.');
