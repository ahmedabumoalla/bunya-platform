import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {NextRequest} from 'next/server.js';
const require=createRequire(import.meta.url);
function load(path,mocks={}) {const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),Set,Map});return exports;}
const access=load('src/lib/auth/sales-document-access.ts');
const nav=load('src/lib/admin/navigation.ts',{'@/lib/auth/sales-document-access':access});
for(const id of ['7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e']){
  assert.equal(access.salesDocumentsRestricted(id),true);
  const urls=nav.adminGroupsForUser(id).flatMap(([,items])=>items.map(([,path])=>path));
  assert.ok(!urls.includes('/admin/price-quotations')&&!urls.includes('/admin/invoices'));
  for(const route of ['/admin/users','/admin/notifications','/admin/catalog','/admin/orders','/admin/finance','/admin/admins','/admin/managed-quotes'])assert.ok(urls.includes(route),route+' remains open');
}
assert.equal(nav.adminGroupsForUser('8b9f3886-e1b8-4816-9fbb-d425b0753255'),nav.adminGroups);
assert.equal(access.salesDocumentPath('/admin/price-quotations/known-id'),true);
assert.equal(access.salesDocumentPath('/admin/price-quotations-other'),false);
const details=load('src/lib/admin/user-details.ts',{'server-only':{},'@/lib/auth/sales-document-access':access,'@/lib/supabase/server':{},'@/lib/supabase/admin':{},'@/lib/auth/resolve-identity':{},'@/lib/admin/records':{},'@/lib/join/provider-fields':{},'@/lib/join/contractor-fields':{}});
const links={providerIds:[],contractorIds:[],driverIds:[],providerApplicationIds:[],contractorApplicationIds:[]};
const permissions=new Set(['finance.manage','orders.manage','profiles.read']);
assert.ok(details.recordSources('client',links,permissions).some(item=>item.key==='invoices'));
permissions.add('sales_documents.denied');
const sources=details.recordSources('client',links,permissions);
assert.ok(!sources.some(item=>item.key==='invoices'));
assert.ok(sources.some(item=>item.key==='orders'));
const calls=[];const q={select(){return q},eq(){return q},is(){return q},neq(...args){calls.push(args);return q},not(...args){calls.push(args);return q}};
details.documentQuery({permissions,admin:{from(){return q}}},links,'client','files',true);
assert.equal(JSON.stringify(calls),JSON.stringify([['bucket_id','invoice-documents'],['purpose','in',`(${access.salesDocumentTables.join(',')})`]]));
class PublicJoinError extends Error{constructor(message,status){super(message);this.status=status;}}
let actor='7f4152b6-63d2-49ec-866f-681a3308f670';
const paymentMocks={'@/lib/auth/sales-document-access':access,'@/lib/auth/resolve-identity':{resolveAuthIdentity:()=>{throw Error('Must deny before role resolution')}},'@/lib/auth/request-client':{createAuthRequestClient:async()=>({user:{id:actor}}),authRouteResponse:(_r,data,status)=>Response.json(data,{status})},'@/lib/join/security':{PublicJoinError},'@/lib/payments/paymob':{},'@/lib/payments/paymob-reconciliation':{},'@/lib/supabase/admin':{createAdminClient:()=>{throw Error('Must deny before privileged queries')}}};
for(const path of ['intention','reconcile']){
 const route=load(`src/app/api/payments/paymob/${path}/route.ts`,paymentMocks);
 for(actor of ['7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'])assert.equal((await route.POST(new NextRequest('https://example.com/api',{method:'POST'}))).status,403);
}
console.log('PASS both immutable identities: hidden document navigation, direct paths, service customer invoice/file denial; owner and unrelated data preserved');
