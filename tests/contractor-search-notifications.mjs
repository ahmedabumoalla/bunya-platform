import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/lib/notifications/dispatcher.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nexports.resolveEventForTest=resolveEvent;';
const exports={};
vm.runInNewContext(code,{exports,console,require:name=>name==='./site-url'?{OFFICIAL_PLATFORM_URL:'https://www.buniahksa.com'}:{}});
const fixture={
  contractor_profiles:{profile_id:'owner',phone:'+966500000001',display_name:'Builder'},
  contractor_opportunities:{id:'opportunity',is_current:true,expires_at:'2099-10-03',project_requests:{title:'Project',city:'Riyadh',search_status:'awaiting_contractor'}},
  contractor_proposals:{id:'proposal',status:'under_review',valid_until:'2099-10-03',amount:1000,contractor_profiles:{display_name:'Builder'},contractor_opportunities:{is_current:true,project_requests:{id:'project',title:'Project',customer_profile_id:'customer',request_code:'P1',search_status:'awaiting_customer'}}},
  profiles:{mobile:'+966500000002'},admin_users:[],
};
let errorTable='';
const db={from(table){const q={select(){return q;},eq(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:fixture[table],error:table===errorTable?new Error('read failed'):null}).then(resolve);}};return q;}};
const event={event_type:'contractor.opportunity_new',aggregate_id:'opportunity',payload:{contractor_profile_id:'contractor'}};
let recipients=await exports.resolveEventForTest(db,event);
assert.equal(recipients.length,1);assert.equal(recipients[0].actionUrl,'/contractor/opportunities/opportunity');assert.match(recipients[0].text,/يومَا عمل/);assert.match(recipients[0].text,/٥٪/);
fixture.contractor_opportunities.is_current=false;
assert.equal((await exports.resolveEventForTest(db,event)).length,0,'no stale invitation');
fixture.contractor_opportunities.is_current=true;fixture.contractor_opportunities.project_requests.search_status='stopped';
assert.equal((await exports.resolveEventForTest(db,event)).length,0,'no stopped-search invitation');
errorTable='contractor_opportunities';await assert.rejects(()=>exports.resolveEventForTest(db,event),/read failed/);errorTable='';
recipients=await exports.resolveEventForTest(db,{event_type:'contractor.proposal_submitted',aggregate_id:'proposal',payload:{}});
assert.equal(recipients[0].actionUrl,'/customer/project-requests/project');
fixture.contractor_proposals.contractor_opportunities.is_current=false;
assert.equal((await exports.resolveEventForTest(db,{event_type:'contractor.proposal_submitted',aggregate_id:'proposal',payload:{}})).length,0,'no stale quote notification');
const decision={event_type:'contractor.proposal_needs_changes',aggregate_id:'proposal',payload:{contractor_profile_id:'contractor'}};
fixture.contractor_proposals.opportunity_id='opportunity';
fixture.contractor_proposals.status='needs_changes';
recipients=await exports.resolveEventForTest(db,decision);
assert.equal(recipients[0].actionUrl,'/contractor/opportunities/opportunity');
fixture.contractor_proposals.status='under_review';
assert.equal((await exports.resolveEventForTest(db,decision)).length,0,'no stale change request after revision');
fixture.contractor_proposals.status='accepted';
recipients=await exports.resolveEventForTest(db,{...decision,event_type:'contractor.proposal_accepted',payload:{...decision.payload,project_id:'00000000-0000-4000-8000-000000000001'}});
assert.equal(recipients[0].actionUrl,'/contractor/projects/00000000-0000-4000-8000-000000000001');
console.log('PASS actionable invitation/customer quote/decision links, two business days and5% copy, stale/stopped/revised notification suppression and database-error retry. No messages sent.');
