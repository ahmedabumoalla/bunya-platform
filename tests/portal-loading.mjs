import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const sourcePath = process.argv.find(value => value.startsWith('--source='))?.slice(9) || 'src/components/database/RoleDatabasePortal.tsx';
const baseline = process.argv.includes('--baseline');
const source = readFileSync(sourcePath, 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
let pathname = '', effects = [], queries = [];
const components = new Proxy({}, { get: (_, name) => Object.assign(() => null, { displayName: name }) });
const db = { from(table) {
  queries.push({ type: 'table', table });
  const query = { select() { return query; }, limit() { return query; }, eq() { return query; }, then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } };
  return query;
}, rpc(name) { queries.push({ type: 'rpc', name }); return Promise.resolve({ data: [], error: null }); } };
const exports = {};
vm.runInNewContext(code, { exports, require: name => {
  if (name === 'react') return { ...React, useState: initial => [initial, () => {}], useMemo: compute => compute(), useEffect: effect => effects.push(effect) };
  if (name === 'next/navigation') return { usePathname: () => pathname };
  if (name === 'next/link') return { __esModule: true, default: () => null };
  if (name === 'next/dynamic') return { __esModule: true, default: loader => Object.assign(() => null, { displayName: loader.toString().match(/module\.([A-Za-z0-9_]+)/)?.[1] || 'LazyView' }) };
  if (name === '@/components/auth/AuthIdentityProvider') return { useAuthIdentity: () => ({ profile: null, details: { provider: null } }) };
  if (name === '@/lib/supabase/client') return { createClient: () => db };
  if (name === '@/lib/admin/records') return { adminRecordPages: { '/admin/orders': {}, '/admin/catalog': {} } };
  if (name.startsWith('@/components/')) return components;
  return require(name);
}, AbortController });

const routes = [
  { role: 'contractor', path: '/contractor', view: 'ContractorDashboard', before: 5, after: 0 },
  { role: 'driver', path: '/driver', view: 'DriverDeliveryWorkflow', before: 4, after: 0 },
  { role: 'provider', path: '/merchant/products', view: 'ProviderProductsList', before: 1, after: 0 },
  { role: 'provider', path: '/merchant/products/new', view: 'ProviderProductCreate', before: 1, after: 0 },
  { role: 'provider', path: '/merchant/quote-requests/request-id', view: 'ProviderRfqResponse', before: 1, after: 0 },
  { role: 'provider', path: '/merchant/orders/order-id', view: 'ProviderFulfillmentWorkflow', before: 1, after: 0 },
  { role: 'provider', path: '/merchant/finance', view: 'ProviderFinance', before: 1, after: 0 },
  { role: 'contractor', path: '/contractor/opportunities/opportunity-id', before: 1, after: 0 },
  { role: 'contractor', path: '/contractor/portfolio', before: 1, after: 0 },
  { role: 'admin', path: '/admin/contractor-services', before: 0, after: 0 },
  { role: 'admin', path: '/admin/users', view: 'AdminUsers', before: 0, after: 0 },
  { role: 'admin', path: '/admin/price-quotations', view: 'PriceQuotations', before: 0, after: 0 },
  { role: 'admin', path: '/admin/managed-quotes/request-id', view: 'ManagedQuotes', before: 0, after: 0 },
  { role: 'customer', path: '/customer/orders/order-id', before: 0, after: 0 },
  { role: 'provider', path: '/merchant', before: 6, after: 6 },
  { role: 'admin', path: '/admin/catalog', before: 1, after: 1 },
  { role: 'admin', path: '/admin/admins', before: 1, after: 1 },
];
const results = [];
for (const test of routes) {
  pathname = test.path; effects = []; queries = [];
  const rendered = exports.RoleDatabasePortal({ role: test.role });
  if (test.view) assert.equal(rendered.type.displayName, test.view, `${test.path}: role view must remain unchanged`);
  for (const effect of effects) effect();
  await new Promise(resolve => setImmediate(resolve));
  const expected = baseline ? test.before : test.after;
  assert.equal(queries.length, expected, `${test.role} ${test.path}: only rendered fallback should load generic data`);
  results.push({ role: test.role, path: test.path, genericQueries: queries.length });
}
const componentImports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](@\/components\/[^"']+)["']/g)].filter(match => !match[2].includes('/auth/'));
const dynamicViews = [...source.matchAll(/const \w+ = dynamic\(\(\) => import\(/g)].length;
if (!baseline) {
  assert.equal(componentImports.length, 0, 'Feature views must not be eagerly imported into every role portal');
  assert.ok(dynamicViews > 50, 'All existing feature views stay lazily available');
  assert.ok(!source.includes('ssr: false'), 'SSR remains enabled for role content');
}
const evidence = { actualRunAt: new Date().toISOString(), runtime: process.version, sourcePath, baseline, staticFeatureModules: componentImports.length, staticFeatureViews: componentImports.reduce((sum, match) => sum + match[1].split(',').length, 0), dynamicViews, routes: results };
const output = process.argv.find(value => value.startsWith('--evidence='))?.slice(11);
if (output) writeFileSync(output, JSON.stringify(evidence, null, 2));
console.log(`PASS portal loading ${baseline ? 'baseline' : 'optimized'}: ${routes.length} route request-count cases, ${componentImports.length} static feature modules, ${dynamicViews} lazy views; no network/business writes.`);
