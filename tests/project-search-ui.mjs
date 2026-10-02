import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const source=readFileSync('src/components/customer/CustomerProjectWorkflows.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const project={id:'project',request_code:'P1',title:'Project',city:'Riyadh',region:'Central',description:'Description',scope:'Scope',lifecycle_status:'receiving_proposals',estimated_budget_max:1000,estimated_budget_min:null,minimum_rating:null,project_request_specialties:[]};
const proposal={id:'proposal',status:'under_review',amount:1000,contractor:{display_name:'Builder'},contractor_proposal_stages:[]};
const activeSearch={status:'awaiting_customer',active_proposal_id:'proposal',contractor_name:'Builder',invited_count:1};
function harness(name,{search={...activeSearch},searchFailure=false,decisionFailure=false}={}) {
  let cursor=0,tree,pushed;
  const state=[],effects=[],calls=[];
  const client={from(table){const q={select(){return q;},eq(){return q;},neq(){return q;},order(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:table==='project_requests'?project:[proposal],error:null}).then(resolve);}};return q;},async rpc(name,args){calls.push({name,args});if(name==='get_customer_project_search')return {data:searchFailure?null:search,error:searchFailure?{message:'offline'}:null};if(name==='stop_project_contractor_search')search={...search,status:'stopped'};if(name==='resume_project_contractor_search')search={...search,status:'awaiting_customer'};return {data:'project',error:decisionFailure?{message:'Not reviewable'}:null};}};
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},useEffect(fn,deps){const i=cursor++;if(!state[i]||deps.some((v,index)=>!Object.is(v,state[i][index]))){state[i]=deps;effects.push(fn);}}};
  class Values{constructor(form){this.fields=form.fields;}get(key){return this.fields[key]??null;}}
  const mocks={react:hooks,'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'next/navigation':{useRouter:()=>({push:value=>{pushed=value;}})},'@/lib/supabase/client':{createClient:()=>client},'@/lib/customer/presentation':{customerReadableText:value=>String(value??'—')},'./CustomerProjectWorkflows.module.css':{default:new Proxy({},{get:(_,key)=>key})}};
  const exports={};vm.runInNewContext(code,{exports,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),FormData:Values,crypto:{randomUUID:()=>`request-${calls.length}`},document:{getElementById:()=>null},console});
  const render=()=>{cursor=0;tree=exports[name]({id:'project'});return renderToStaticMarkup(tree);};
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));render();for(const fn of effects.splice(0))fn();await new Promise(resolve=>setImmediate(resolve));return render();};
  return {render,settle,calls,get tree(){return tree;},get pushed(){return pushed;}};
}
function nodes(node,test){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(child=>nodes(child,test));return [...(test(node)?[node]:[]),...nodes(node.props?.children,test)];}
function button(h,text){return nodes(h.tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(text))[0];}
const request=harness('ProjectRequestForm');
assert.doesNotMatch(request.render(),/name="proposal_deadline_at"/);
const fields={title:'A project',project_type:'Building',description:'Description',scope:'Full scope',city:'Riyadh',region:'Central',specialties:'Building',estimated_duration:'Month',expected_start_at:'2026-12-01',budget_max:'1000'};
await nodes(request.tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){},currentTarget:{fields}});
assert.equal(request.calls[0].name,'submit_customer_project_request');
assert.equal(request.calls[0].args.p_request.city,'Riyadh');
assert.ok(!('proposal_deadline_at' in request.calls[0].args.p_request));
assert.equal(request.pushed,'/customer/project-requests/project');
const detail=harness('ProjectProposalDecisions');
assert.match(await detail.settle(),/عرض بانتظار قرارك/);
assert.ok(button(detail,'قبول العرض'));
button(detail,'إيقاف البحث').props.onClick();detail.render();
await button(detail,'نعم، أوقف البحث').props.onClick();
assert.equal(detail.calls.at(-1).name,'stop_project_contractor_search');
assert.match(await detail.settle(),/أوقفت البحث/);
assert.ok(!button(detail,'قبول العرض'));
await button(detail,'استئناف البحث').props.onClick();
assert.equal(detail.calls.at(-1).name,'resume_project_contractor_search');
await detail.settle();
button(detail,'رفض العرض').props.onClick({currentTarget:{id:'reject-trigger'}});detail.render();
nodes(detail.tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Price outside budget'}});detail.render();
await nodes(detail.tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
assert.equal(detail.calls.at(-1).name,'decide_contractor_proposal');
assert.equal(detail.calls.at(-1).args.p_decision,'rejected');
assert.equal(detail.calls.at(-1).args.p_proposal_id,'proposal');
for(const options of [{search:{...activeSearch,status:'awaiting_contractor'}},{search:{...activeSearch,active_proposal_id:'other'}},{searchFailure:true}]){
  const h=harness('ProjectProposalDecisions',options);await h.settle();assert.ok(!button(h,'قبول العرض'),'only the current customer-review quote is actionable');
}
console.log('PASS project request without global cutoff; search load/stop/resume/current-only decision; stale/unavailable quote actions gated; preserved project and decision payloads.');
