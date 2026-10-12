import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('src/components/conversations/ContractorConversations.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000001';
const convo={id,number:1,customer_id:'customer',contractor_user_id:'contractor',customer_name:'Customer',contractor_name:'Contractor',status:'open'};
function harness({admin=false,user='customer',accepted=false,bank=null,moderation='released'}={}) {
 let cursor=0,tree,failRefresh=false;const state=[],effects=[],timers=[],calls=[];
 const quote={id:'quote',amount:1000,commission_rate:5,commission_amount:50,duration_days:30,start_at:'2099-01-01',valid_until:'2099-02-01',status:accepted?'accepted':'offered',accepted_at:'2026-10-13'};
 const conversation={...convo,status:accepted?'contracted':'open',project_id:accepted?'project':null};
 const client={from(table){let single=false;const query={select(){return query;},eq(){return query;},or(){return query;},in(){return query;},order(){return query;},range(){return query;},limit(){return query;},single(){single=true;return query;},then(resolve){const data=table==='contractor_conversations'?(single?conversation:[conversation]):table==='contractor_chat_messages'?[{id:'quote',sender_id:'contractor',kind:'quote',body:'Reviewed scope',moderation,created_at:'2026-10-13',contractor_chat_quotes:quote}]:[];return Promise.resolve({data,error:failRefresh?{message:'offline'}:null}).then(resolve);}};return query;},async rpc(name,args){if(name==='contractor_chat_summary')return {data:{paid:0,quote:accepted?quote:null,bank,payment_review:false}};calls.push({name,args});failRefresh=true;return {data:{id:'message',moderation:'pending'},error:null};}};
 const hooks={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},useCallback(fn,deps){const i=cursor++;if(!state[i]||deps.some((v,j)=>!Object.is(v,state[i].deps[j])))state[i]={fn,deps};return state[i].fn;},useEffect(fn,deps){const i=cursor++;if(!state[i]||deps.some((v,j)=>!Object.is(v,state[i][j]))){state[i]=deps;effects.push(fn);}}};
 const mocks={react:hooks,'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'next/navigation':{useSearchParams:()=>new URLSearchParams(`id=${id}`)},'@/lib/supabase/client':{createClient:()=>client},'@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>({userId:user})},'./CollectionAccountSettings':{CollectionAccountSettings:()=>React.createElement('div',null,'Bank settings')},'./ContractorConversations.module.css':{default:new Proxy({},{get:(_,k)=>k})}};
 const exports={};vm.runInNewContext(code,{exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),crypto:{randomUUID:()=>id},URLSearchParams,Date,console,setTimeout:fn=>timers.push(fn),clearTimeout(){},setInterval(){},clearInterval(){},document:{visibilityState:'visible'}});
 const render=()=>{cursor=0;tree=exports.ContractorConversations({admin});return renderToStaticMarkup(tree);};
 const settle=async()=>{render();for(const fn of effects.splice(0))fn();for(const fn of timers.splice(0))fn();await new Promise(r=>setImmediate(r));return render();};
 return {render,settle,calls,get tree(){return tree;}};
}
function nodes(node,test){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(n=>nodes(n,test));return[...(test(node)?[node]:[]),...nodes(node.props?.children,test)];}
const button=(h,text)=>nodes(h.tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(text))[0];
const customer=harness();let html=await customer.settle();assert.match(html,/اعتماد العرض/);assert.doesNotMatch(html,/إرسال عرض سعر|Bank settings/);
button(customer,'اعتماد العرض').props.onClick();assert.match(customer.render(),/تأكيد الاعتماد/);assert.ok(nodes(customer.tree,n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.required).length);
const pending=harness({moderation:'pending'});assert.doesNotMatch(await pending.settle(),/اعتماد العرض/);
const contractor=harness({user:'contractor'});await contractor.settle();assert.ok(button(contractor,'إرسال عرض سعر'));assert.ok(!button(contractor,'اعتماد العرض'));
const paidFlow=harness({accepted:true});assert.match(await paidFlow.settle(),/دفع المتبقي إلكترونيًا/);assert.match(paidFlow.render(),/بعد إضافة حساب تحصيل/);assert.doesNotMatch(paidFlow.render(),/name="reference"/);
const bankFlow=harness({accepted:true,bank:{bank_name:'Test bank',beneficiary:'Test platform',iban:'TEST-ONLY'}});assert.match(await bankFlow.settle(),/إرسال إشعار التحويل للإدارة/);
const admin=harness({admin:true,user:'admin',moderation:'pending'});html=await admin.settle();assert.match(html,/أرشيف المحادثات والصفقات/);assert.match(html,/Bank settings/);assert.doesNotMatch(html,/id="chat-body"/);
const composer=harness();await composer.settle();nodes(composer.tree,n=>n.props?.id==='chat-body')[0].props.onChange({target:{value:'Project scope'}});composer.render();
await nodes(composer.tree,n=>n.type==='form'&&n.props.className==='composer')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));html=composer.render();
assert.equal(composer.calls[0].args.p_action,'send');assert.equal(composer.calls[0].args.p_payload.body,'Project scope');assert.match(html,/تم حفظ الإجراء، لكن تعذر تحديث العرض/);assert.equal(nodes(composer.tree,n=>n.props?.id==='chat-body')[0].props.value,'','committed message must clear even when reload fails');
console.log('PASS conversation UI: role actions, reviewed quote acceptance, consent, real bank availability, admin archive and committed-message reload failure. No browser/live records.');
