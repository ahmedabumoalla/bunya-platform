import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
function load(path, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require(name){if(name==='server-only')return {};if(Object.hasOwn(mocks,name))return mocks[name];throw Error(`Unexpected import ${name}`)}});
  return exports;
}
const plans=[{id:'legacy-contractor',role:'contractor',is_active:true,price_monthly:100},{id:'provider',role:'provider',is_active:true,price_monthly:200,name:'Provider plan'}];
const filters=[];
const db = {
  from(table) {
    assert.equal(table, 'subscription_plans');
    return {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      order() { return this; },
      then(resolve, reject) {
        return Promise.resolve({ data: plans.filter(row => filters.every(([key, value]) => row[key] === value)), error: null }).then(resolve, reject);
      },
    };
  },
};
const subscriptions = load('src/lib/subscriptions/server.ts', { '@/lib/supabase/server': { createClient: async () => db } });
const visible=await subscriptions.loadSubscriptionPlans();
assert.equal(visible.length,1);assert.equal(visible[0].role,'provider');assert.equal(visible[0].priceMonthly,200);assert.ok(filters.some(([key,value])=>key==='role'&&value==='provider'));
const records=load('src/lib/admin/records.ts');
const fields=records.adminRecordPages['/admin/contractor-projects'].details;
const rate=fields.find(field=>field.key==='platform_commission_rate'),amount=fields.find(field=>field.key==='platform_commission_amount');
assert.equal(records.formatRecordField({platform_commission_rate:5},rate),'5٪');
assert.equal(records.formatRecordField({platform_commission_amount:1250},amount),'1,250.00 ر.س');
assert.equal(records.formatRecordField({platform_commission_amount:null},amount),'غير مسجل');
let cursor=0;const state=[{title:'Project',description:'Scope'},'',false,false,0];
const proposal=load('src/components/contractor/ContractorWorkflows.tsx',{'react':{...React,useState:()=>[state[cursor++],()=>{}],useEffect(){}},'react/jsx-runtime':jsx,'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'next/navigation':{useRouter:()=>({})},'@/components/customer/CustomerProjectWorkflows':{},'@/components/operations/RoleOperations':{},'@/lib/supabase/client':{createClient(){throw Error('No render-time query expected')}}});
const html=renderToStaticMarkup(proposal.OpportunityProposal({id:'opportunity'}));
assert.match(html,/٥٪/);assert.match(html,/دون اشتراك شهري/);assert.match(html,/name="policy"/);assert.match(html,/name="amount"/);
console.log('PASS contractor monthly-plan exclusion; unchanged provider plan; actual/historical commission display; proposal 5% disclosure and existing policy/amount fields');
