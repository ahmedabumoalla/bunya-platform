import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
const compact={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/notifications/compact.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:compact});
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
    '@/lib/notifications/compact':compact,
    react:{...React,useEffect(){},useMemo:fn=>fn(),useState(value){const i=index++;if(!(i in state))state[i]=typeof value==='function'?value():value;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];}},
    'next/navigation':{usePathname:()=>pathname},
    '@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>({userId:'owner'})},
    '@/lib/supabase/client':{createClient:()=>db},
    '@/lib/admin/records':{stateLabels:{completed:'مكتمل',requested:'مطلوب',open:'مفتوح',normal:'عادية'},readableText:value=>String(value??'')},
    '@/lib/uploads/client':{optimizeUploadFile:async file=>file},
    '@/components/admin/AdminFilterBar':{AdminFilterBar:props=>React.createElement('div',{'data-support-filters':true},props.resultText)},
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
const customerSupport=setup('SupportCenter','/customer/support',['','all',[],null,false,'']);
assert.doesNotMatch(customerSupport.render(),/Supabase|Live Data|روابط موقعة|خمس دقائق/);
const tickets=[
  {id:'ticket-open',ticket_code:'T-100',subject:'طلب توريد',status:'open',priority:'normal',escalation_level:0},
  {id:'ticket-closed',ticket_code:'T-200',subject:'طلب توريد سابق',status:'closed',priority:'normal',escalation_level:0},
];
const adminSupport=setup('SupportCenter','/admin/support',['','all',tickets,null,false,''],{}, {admin:true});
adminSupport.render();
const filter=()=>nodes(adminSupport.tree,node=>Array.isArray(node.props?.filters))[0];
assert.equal(filter().props.resultText,'2 تذكرة مطابقة');
assert.equal(filter().props.filters[0].defaultValue,'all');
assert.equal(JSON.stringify(filter().props.filters[0].options.map(option=>option.value)),JSON.stringify(['all','open','closed']));
filter().props.onApply({status:'open'});
assert.match(adminSupport.render(),/T-100/);
assert.doesNotMatch(adminSupport.render(),/T-200/);
filter().props.onQueryChange('200');
assert.match(adminSupport.render(),/لا توجد تذاكر تطابق البحث/);
assert.equal(filter().props.resultText,'0 تذكرة مطابقة');
filter().props.onApply({status:'all'});
assert.match(adminSupport.render(),/T-200/);
assert.doesNotMatch(adminSupport.render(),/T-100/);
nodes(adminSupport.tree,node=>node.type==='button'&&node.props['aria-pressed']===false)[0].props.onClick();
assert.equal(adminSupport.state[3].id,'ticket-closed','filtering retains the canonical ticket selection');
filter().props.onQueryChange('');
assert.match(adminSupport.render(),/2 تذكرة مطابقة/);
console.log('PASS contractor operations: preserved balance and bank/settlement handlers, notification owner table/action/read, empty finance/support and localized presentation.');
console.log('PASS admin support: shared filter options, combined search/status, empty result recovery and original ticket selection.');
