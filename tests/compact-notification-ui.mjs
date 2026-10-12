import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const compact={};vm.runInNewContext(compile('src/lib/notifications/compact.ts'),{exports:compact});
const id='12abcdef-1234-4567-890a-123456789012';
const target=`/merchant/quote-requests/${id}`;
const row={id,title:'طلب تسعير جديد',message:`مرجع الطلب: ${id}\nالبريد: private@example.com\n${'تفاصيل '.repeat(100)}`,action_url:target,read_at:null,created_at:'2026-10-12T20:00:00Z',type:'provider.rfq_new'};
let index=0;const state=[[row],'all','',false];
const mocks={
 react:{...React,useEffect(){},useCallback:f=>f,useState:()=>[state[index++],()=>{}]},
 'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
 '@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>({userId:'provider'})},
 '@/lib/supabase/client':{createClient:()=>({from(){throw Error('Rendering notices must not fetch request forms');},rpc(){throw Error('No detailed request contexts in a notice');}})},
 '@/lib/notifications/compact':compact,
 './ProviderNotifications.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})},
};
const exports={};vm.runInNewContext(compile('src/components/provider/ProviderNotifications.tsx'),{exports,require:id=>mocks[id]??require(id),Date});
const tree=exports.ProviderNotifications();const html=renderToStaticMarkup(tree);
assert.ok(html.includes(`href="${target}"`),'full canonical UUID stays in detail route');
assert.ok(html.includes('12ABCDEF'),'short reference is visible');
assert.ok(!html.includes('private@example.com'),'legacy emails are absent from preview');
assert.ok(!html.includes('rfqBody')&&!html.includes('dataGrid'),'notice does not reproduce the request form');
const walk=node=>node&&typeof node==='object'?[node,...React.Children.toArray(node.props?.children).flatMap(walk)]:[];
const preview=walk(tree).find(node=>node.type==='p'&&node.props.className==='generic');
assert.ok(Array.from(preview.props.children).length<=120,'message stays concise');
assert.equal(row.message.includes('private@example.com'),true,'original event record is untouched');
console.log('Compact notification UI PASS: concise legacy preview, no request forms, original action ID retained.');
