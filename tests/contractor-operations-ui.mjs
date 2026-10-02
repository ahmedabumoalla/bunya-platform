import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
const source=readFileSync('src/components/operations/SupportFinanceWorkflows.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(name,pathname,initial,fixtures={},props={}) {
  let index=0,tree;
  const state=[...initial],calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:null};},from(table){
    const q={select(){return q;},order(){return q;},limit(){return q;},eq(){return q;},update(payload){calls.push({table,payload});return q;},then(resolve){return Promise.resolve({data:fixtures[table]??[],error:null}).then(resolve);}};
    return q;
  }};
  const mocks={
    react:{...React,useEffect(){},useMemo:fn=>fn(),useState(value){const i=index++;if(!(i in state))state[i]=typeof value==='function'?value():value;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];}},
    'next/navigation':{usePathname:()=>pathname},
    '@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>({userId:'owner'})},
    '@/lib/supabase/client':{createClient:()=>db},
    '@/lib/admin/records':{stateLabels:{completed:'مكتمل',requested:'مطلوب',open:'مفتوح',normal:'عادية'},readableText:value=>String(value??'')},
    '@/lib/uploads/client':{optimizeUploadFile:async file=>file},
  };
  const exports={};vm.runInNewContext(code,{exports,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),crypto:{randomUUID:()=> 'request-id'},console});
  const render=()=>{index=0;tree=exports[name](props);return renderToStaticMarkup(tree);};
  return {render,calls,state,get tree(){return tree;}};
}
function nodes(node,predicate){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));return [...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];}
const transaction={id:'t',financial_kind:'payment',amount:500,status:'completed',occurred_at:'2026-10-03',transaction_code:'T-1',contractor_projects:{name:'Project'},contractor_project_milestones:{name:'Stage'}};
const account={id:'bank',bank_name:'Test Bank',iban_last4:'1234',is_default:true,is_active:true};
const settlement={id:'s',amount:100,workflow_status:'requested',settlement_code:'S-1'};
const finance=setup('ContractorFinance','/contractor/finance',[[transaction],[account],[settlement],false,'',{id:'',bank_name:'Test Bank',account_name:'Owner',iban:'SA-example',is_default:true},{amount:'50',bank_account_id:'bank',notes:'Test'}],{contractor_financial_transactions:[transaction],contractor_bank_accounts:[account],contractor_settlement_requests:[settlement]});
const html=finance.render();
assert.ok(html.includes((400).toLocaleString('ar-SA')),'available balance keeps existing settlement subtraction');
assert.match(html,/\*\*\*\*1234/);
assert.match(html,/Project/);
assert.doesNotMatch(html,/>completed</);
const forms=nodes(finance.tree,n=>n.type==='form');
assert.equal(forms.length,2);
await forms[0].props.onSubmit({preventDefault(){}});
assert.equal(finance.calls[0].name,'save_contractor_bank_account');
assert.deepEqual(JSON.parse(JSON.stringify(finance.calls[0].args)),{p_id:null,p_bank:'Test Bank',p_name:'Owner',p_iban:'SA-example',p_default:true});
await forms[1].props.onSubmit({preventDefault(){}});
assert.equal(finance.calls[1].name,'request_contractor_settlement');
assert.equal(finance.calls[1].args.p_amount,50);
assert.equal(finance.calls[1].args.p_bank,'bank');
const empty=setup('ContractorFinance','/contractor/finance',[[],[],[],false,'']);
assert.match(empty.render(),/لم تضف حسابًا بنكيًا بعد/);
assert.match(empty.render(),/لا توجد طلبات تحويل/);
const notification={id:'notice',title:'Notice',body:'Update',read_at:null,action_url:'/contractor/projects/example',created_at:'2026-10-03'};
const notices=setup('NotificationCenter','/contractor/notifications',[[notification],false,''],{contractor_notifications:[notification]},{source:'contractor'});
assert.match(notices.render(),/contractor-notice-unread/);
assert.match(notices.render(),/href="\/contractor\/projects\/example"/);
await nodes(notices.tree,n=>n.type==='button')[0].props.onClick();
assert.equal(notices.calls[0].table,'contractor_notifications');
assert.ok(notices.calls[0].payload.read_at);
const support=setup('SupportCenter','/contractor/support',['','all',[],null,false,'']);
const supportHtml=support.render();
assert.match(supportHtml,/كيف نقدر نساعدك/);
assert.match(supportHtml,/اختر تذكرة/);
assert.doesNotMatch(supportHtml,/Supabase|روابط موقعة/);
console.log('PASS contractor operations: preserved balance and bank/settlement handlers, notification owner table/action/read, empty finance/support and localized presentation.');
