import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
let pathname = '/contractor', customer = true;
const identity = () => ({ profile: { fullName: 'Test' }, activeRoles: customer ? ['contractor','customer'] : ['contractor'], details: { contractor: { displayName: 'Contractor company', approvalStatus: 'approved' }, customer: { exists: customer } } });
const mocks = {
  'next/link': { default: ({ children,...props }) => React.createElement('a',props,children) },
  'next/navigation': { usePathname: () => pathname },
  '@/components/auth/AuthIdentityProvider': { useAuthIdentity: identity },
  '@/components/brand/BunyaLogo': { BunyaLogo: () => React.createElement('span',null,'Bunya') },
  '@/components/auth/LogoutButton': { LogoutButton: ({ children,...props }) => React.createElement('button',props,children) },
  '@/components/admin/AdminIcon': { AdminIcon: () => React.createElement('svg',{'aria-hidden':true}) },
  '@/lib/supabase/client': { createClient: () => { throw Error('SSR must not query browser Supabase'); } },
  '@/lib/body-scroll-lock': { lockBodyScroll: () => { throw Error('SSR must not mutate document'); } },
};
function load(file) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{exports,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id)});
  return exports;
}
mocks['./ContractorUI'] = load('src/components/contractor/ContractorUI.tsx');
const { ContractorShell } = load('src/components/contractor/ContractorShell.tsx');
const routes = ['', '/opportunities', '/project-comments', '/proposals', '/projects', '/services', '/portfolio', '/reviews', '/finance', '/notifications', '/profile', '/verification', '/policies', '/support'];
const registry = readFileSync('.next/types/routes.d.ts','utf8');
const html = () => renderToStaticMarkup(React.createElement(ContractorShell,null,React.createElement('h1',null,'Content')));
for (const route of routes) {
  pathname = '/contractor'+route;
  const markup = html();
  const active = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(active.length,1,pathname);
  assert.ok(active[0].includes(`href="${pathname}"`));
  assert.ok(registry.includes(`"${pathname}"`),`Next page registered: ${pathname}`);
  assert.equal((markup.match(/<main\b/g)??[]).length,1);
  assert.match(markup,/id="contractor-content"/);
  assert.match(markup,/aria-controls="contractor-navigation"/);
  assert.match(markup,/href="\/customer"/);
  assert.match(markup,/>معتمد<\/span>/);
}
for (const path of ['opportunities','proposals','projects']) {
  pathname = `/contractor/${path}/example`;
  assert.ok(registry.includes(`"/contractor/${path}/[id]"`));
  assert.match(html(),new RegExp(`<a href="/contractor/${path}"[^>]*aria-current="page"`));
}
customer = false;
assert.doesNotMatch(html(),/href="\/customer"/);
const styles = ['contractor-refined.css','contractor-operations.css','contractor-catalog.css'];
for (const file of styles) {
  const root = postcss.parse(readFileSync(`src/app/contractor/${file}`,'utf8'));
  root.walkRules(rule => assert.ok(rule.selector.startsWith('.contractor-app[data-contractor-design="refined"]'),`unscoped selector: ${rule.selector}`));
}
const css = readFileSync('src/app/contractor/contractor-refined.css','utf8');
assert.match(css,/@media \(max-width: 860px\)/);
assert.match(readFileSync('src/components/contractor/ContractorShell.tsx','utf8'),/matchMedia\("\(max-width: 860px\)"\)/);
function luminance(hex) { const rgb = hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; }
for (const [fg,bg] of [['ffffff','173f32'],['d3e0d7','173f32'],['203e32','e4ecda'],['5d7167','ffffff'],['5d7167','f3f6f3']]) {
  const a=luminance(fg),b=luminance(bg);
  assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg}`);
}
console.log('PASS contractor shell: 14 destinations + 3 registered detail routes, current navigation, customer-role gate, localized approval, scoped CSS and text contrast.');
