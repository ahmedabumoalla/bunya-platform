import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const state = { bar: [], dialog: [] };
const listeners = new Map();
const body = {};
let scope = 'bar', cursor = 0, cleanup, effectMounted = false, locks = 0, unlocks = 0, focusCalls = 0;
const mocks = {
  react: {
    ...React,
    useState(initial) {
      const owner = state[scope], index = cursor++;
      if (!(index in owner)) owner[index] = typeof initial === 'function' ? initial() : initial;
      return [owner[index], next => { owner[index] = typeof next === 'function' ? next(owner[index]) : next; }];
    },
    useCallback: callback => callback,
    useId: () => 'filters-title',
    useEffect(effect) { if (!effectMounted) { effectMounted = true; cleanup = effect(); } },
  },
  'react-dom': { createPortal(node, destination) { assert.equal(destination, body); return node; } },
  '@/lib/body-scroll-lock': { lockBodyScroll() { locks++; return () => { unlocks++; }; } },
  './AdminIcon': { AdminIcon: () => null },
  './useDialogFocus': { useDialogFocus() { focusCalls++; return { current: null }; } },
  './AdminFilterBar.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
};
const exports = {};
const source = ts.transpileModule(readFileSync('src/components/admin/AdminFilterBar.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, {
  exports, require: id => mocks[id] ?? require(id),
  document: { body, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); } },
});
const calls = [];
const props = {
  query: 'supplier', searchLabel: 'Find users', resultText: '12 users',
  onQueryChange(value) { props.query = value; },
  filters: [
    { key: 'role', label: 'Role', value: 'provider', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'provider', label: 'Supplier' }] },
    { key: 'sort', label: 'Sort', value: 'oldest', defaultValue: 'newest', options: [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }] },
  ],
  onApply(values) { calls.push({ ...values }); props.filters = props.filters.map(filter => ({ ...filter, value: values[filter.key] })); },
};
const walk = node => node && typeof node === 'object' ? [node, ...React.Children.toArray(node.props?.children).flatMap(walk)] : [];
let barNodes = [], dialogNodes = [];
function render() {
  scope = 'bar'; cursor = 0;
  barNodes = walk(exports.AdminFilterBar(props));
  const child = barNodes.find(node => typeof node.type === 'function' && node.type.name === 'FilterDialog');
  if (child) {
    scope = 'dialog'; cursor = 0;
    dialogNodes = walk(child.type(child.props));
  } else {
    if (effectMounted) { cleanup?.(); effectMounted = false; state.dialog = []; }
    dialogNodes = [];
  }
}
const trigger = () => barNodes.find(node => node.props.className === 'trigger');
const open = () => { trigger().props.onClick(); render(); };
const select = key => dialogNodes.filter(node => node.type === 'select')[key];

render();
assert.equal(barNodes.filter(node => node.type === 'select').length, 0);
assert.equal(dialogNodes.length, 0, 'filters start closed');
assert.equal(trigger().props['aria-expanded'], false);
assert.equal(walk(trigger()).find(node => node.type === 'b').props.children, 2, 'active count includes sort');
barNodes.find(node => node.type === 'input').props.onChange({ target: { value: 'new query' } });
assert.equal(props.query, 'new query');
render();
barNodes.find(node => node.type === 'label').props.children[2].props.onClick();
assert.equal(props.query, '', 'clear only changes the query');
render();
open();
assert.equal(dialogNodes.filter(node => node.type === 'select').length, 2);
assert.equal(select(0).props.value, 'provider');
const dialog = dialogNodes.find(node => node.props.role === 'dialog');
assert.equal(dialog.props['aria-modal'], 'true');
assert.equal(dialog.props['aria-labelledby'], 'filters-title');
assert.ok(focusCalls > 0);
select(0).props.onChange({ target: { value: 'all' } }); render();
assert.equal(select(0).props.value, 'all'); assert.equal(calls.length, 0, 'draft changes do not apply');
dialogNodes.find(node => node.props.className === 'iconButton').props.onClick(); render();
assert.equal(calls.length, 0, 'cancel preserves applied filters');
assert.equal(props.filters[0].value, 'provider');
assert.equal(unlocks, 1);
open();
assert.equal(select(0).props.value, 'provider', 'reopen starts from applied values');
dialogNodes.find(node => node.props.className === 'reset').props.onClick(); render();
assert.equal(select(0).props.value, 'all'); assert.equal(select(1).props.value, 'newest');
assert.equal(calls.length, 0, 'reset is a draft action until apply');
let prevented = false;
dialogNodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() { prevented = true; } }); render();
assert.equal(prevented, true);
assert.deepEqual(calls, [{ role: 'all', sort: 'newest' }]);
assert.equal(dialogNodes.length, 0);
assert.equal(walk(trigger()).some(node => node.type === 'b'), false, 'zero badge disappears');
open(); listeners.get('keydown')({ key: 'Escape', preventDefault() {} }); render();
assert.equal(dialogNodes.length, 0); assert.equal(calls.length, 1, 'Escape cancels without applying');
open();
let backdrop = dialogNodes.find(node => node.props.className === 'backdrop');
backdrop.props.onMouseDown({ target: {}, currentTarget: body }); render();
assert.ok(dialogNodes.length, 'clicking dialog content does not dismiss');
backdrop = dialogNodes.find(node => node.props.className === 'backdrop');
backdrop.props.onMouseDown({ target: body, currentTarget: body }); render();
assert.equal(dialogNodes.length, 0);
assert.equal(locks, unlocks, 'all dialog exits release scroll lock');
assert.equal(listeners.size, 0, 'all dialog exits remove keyboard handler');
console.log('Admin filter bar PASS: closed defaults, draft/cancel/reset/apply, badges, query clear, Escape/backdrop and cleanup.');
