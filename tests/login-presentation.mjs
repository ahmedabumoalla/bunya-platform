import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let state = [], cursor = 0, signIns = [], redirects = [], finishSignIn;
let role = 'customer', pending = false;
const location = { origin: 'http://localhost:3000', search: '?returnTo=%2F%3Fquote%3Dreview', replace: url => redirects.push(url) };
const db = {
  auth: {
    async signInWithPassword(credentials) {
      signIns.push(credentials);
      if (pending) return new Promise(resolve => { finishSignIn = resolve; });
      return { data: { user: { id: 'synthetic-test', phone: '+966500000000', phone_confirmed_at: 'test-confirmed' } }, error: null };
    },
    async signOut() {},
  },
  from(table) { return { select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: { is_active: true, must_change_password: false } }; },
    async is() { assert.equal(table, 'user_roles'); return { data: [{ role, is_primary: true }] }; },
  }; },
  async rpc() {},
};
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(source, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    URL, URLSearchParams, window: { location }, process: { env: {} },
    FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values[name]; } },
  });
  return exports;
}
const types = load('src/lib/auth/types.ts');
const { LoginFlow } = load('src/components/LoginFlow.tsx', {
  react: { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; } },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/lib/auth/return-to': load('src/lib/auth/return-to.ts', { './types': types }),
  '@/lib/auth/phone-verification': load('src/lib/auth/phone-verification.ts'),
  '@/lib/auth/types': types,
  '@/lib/auth/login-errors': load('src/lib/auth/login-errors.ts'),
  '@/lib/supabase/client': { createClient: () => db },
  './brand/BunyaLogo': { BunyaLogo: () => null },
  './LoginFlow.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
});
function render(props = {}) { cursor = 0; return LoginFlow({ returnTo: '/?quote=review', ...props }); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)]; }
function find(tree, predicate) { const match = nodes(tree).find(predicate); assert.ok(match); return match; }
function input(tree, name) { return find(tree, n => n.type === 'input' && n.props.name === name); }
async function submit(tree, values) { await find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { values } }); }
let tree = render();
assert.equal(input(tree, 'identifier').props.autoComplete, 'username');
assert.equal(input(tree, 'password').props.autoComplete, 'current-password');
assert.equal(input(tree, 'password').props.type, 'password');
find(tree, n => n.props?.['aria-controls'] === 'login-password').props.onClick();
tree = render(); assert.equal(input(tree, 'password').props.type, 'text');
assert.equal(find(tree, n => n.props?.['aria-controls'] === 'login-password').props.type, 'button');
const html = renderToStaticMarkup(tree);
assert.ok(html.includes('/register?returnTo=%2F%3Fquote%3Dreview'));
assert.ok(html.includes('/forgot-password'));
assert.ok(!html.includes('portal-page'));
await submit(tree, { identifier: 'invalid', password: '' });
tree = render();
for (const name of ['identifier', 'password']) {
  assert.equal(input(tree, name).props['aria-invalid'], true);
  const errorId = input(tree, name).props['aria-describedby'];
  assert.equal(find(tree, n => n.props?.id === errorId).props.role, 'alert');
}
assert.equal(signIns.length, 0);
// Autofilled FormData, not only controlled state, remains the credentials source.
for (const [currentRole, expected] of Object.entries(types.ROLE_ROUTES)) {
  state = []; role = currentRole; tree = render(); redirects = [];
  await submit(tree, { identifier: ' USER@EXAMPLE.COM ', password: 'synthetic password' });
  assert.equal(signIns.at(-1).email, 'user@example.com');
  assert.equal(signIns.at(-1).password, 'synthetic password');
  assert.equal(redirects[0], role === 'customer' ? '/?quote=review' : expected);
}
state = []; pending = true; tree = render();
const request = submit(tree, { identifier: '0500000000', password: 'synthetic password' });
tree = render();
assert.equal(input(tree, 'identifier').props.disabled, true);
assert.equal(input(tree, 'password').props.disabled, true);
assert.equal(find(tree, n => n.props?.type === 'submit').props.disabled, true);
assert.equal(signIns.at(-1).phone, '+966500000000');
const requestsBefore = signIns.length;
await submit(tree, { identifier: '0500000000', password: 'synthetic password' });
assert.equal(signIns.length, requestsBefore);
finishSignIn({ data: { user: null }, error: { code: 'invalid_credentials' } });
await request;
tree = render(); assert.equal(input(tree, 'identifier').props.disabled, false);
assert.ok(nodes(tree).some(n => n.props?.role === 'alert' && n.props.className === 'formError'));
console.log('PASS login field/autofill contracts, visibility control, accessible validation, signup returnTo, email/phone normalization, five role redirects, busy guard and recoverable error. Mocked auth only.');
