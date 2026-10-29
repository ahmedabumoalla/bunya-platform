import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';
const require=createRequire(import.meta.url);
function load(path,mocks={},globals={}) {const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),Date,Map,Set,URL,process,console,TextDecoder,File,Uint8Array,Response,...globals});return exports;}
const manifest=JSON.parse(readFileSync('src/data/catalog/imported.json','utf8')),options=JSON.parse(readFileSync('src/data/catalog/quote-options.json','utf8'));
const validation=load('src/lib/quotes/price-quotation-validation.ts');
const managedCatalog=load('src/lib/quotes/managed-catalog.ts',{'server-only':{},'@/data/catalog/imported.json':manifest,'@/data/catalog/quote-options.json':options});
class ManagedQuoteError extends Error {constructor(status,message){super(message);this.status=status;}}
const id='00000000-0000-4000-8000-000000000001', sourceId='00000000-0000-4000-8000-000000000002';
let canManage=true, frozen=false, authenticated=true, row=null, existing=null, savedPayload=null, claimOK=true, finishOK=true, providerStatus='submitted', providerError=null;
const calls=[],sent=[];
const db={
 from(table){const filters=[];const query={select(){return query;},eq(k,v){filters.push([k,v]);return query;},order(){return query;},range(){return query;},
   async maybeSingle(){return {data:table==='price_quotations'?(filters.some(([k])=>k==='idempotency_key')?existing:row):null,error:null};},
   then(resolve){return Promise.resolve(resolve({data:row?[row]:[],count:row?1:0,error:null}));}};return query;},
 async rpc(name,payload){calls.push({name,payload});if(name==='price_quotation_create'){savedPayload=payload;row={...payload.p_payload,id,quotation_code:'QUO-20261029-123456ABCDEF',created_at:new Date().toISOString(),send_status:'draft',sent_at:null,send_error:null};return {data:id,error:null};}if(name==='price_quotation_claim_send')return {data:claimOK,error:null};if(name==='price_quotation_finish_send'){if(finishOK)row={...row,send_status:payload.p_status,sent_at:payload.p_status==='submitted'?new Date().toISOString():null,send_error:payload.p_error};return {data:finishOK,error:null};}throw Error(name);}
};
const context={userId:id,canManage:true,admin:db};
const source={id:sourceId,request_code:'BQ-ORIGINAL',items:[{id:'line-1',product_id:'historical-product',product_name:'Historical canonical product',unit:'قطعة',sku:'OLD',attributes:[{label:'Size',value:'10'}]}]};
const managed={ManagedQuoteError,managedQuoteId:/^[a-f0-9-]{36}$/,managedQuoteContext:async()=>{if(!authenticated)throw new ManagedQuoteError(401,'Login');return {...context,canManage};},readManagedQuote:async(_ctx,key)=>{if(key!==sourceId)throw new ManagedQuoteError(404,'Not found');return source;}};
const catalog=load('src/lib/quotes/price-quotation-catalog.ts',{'server-only':{},'@/data/catalog/imported.json':manifest,'@/data/catalog/quote-options.json':options,'./managed-server':managed,'./managed-catalog':managedCatalog});
let renderCalls=0,catalogCalls=0;
const pdfRenderer={renderPriceQuotationPdf:async()=>{renderCalls++;return new Uint8Array([37,80,68,70]);}};
const server=load('src/lib/quotes/price-quotation-server.ts',{'server-only':{},'./managed-server':managed,'@/lib/supabase/archive-server':{archiveActorStatus:async()=>({active:frozen})},'./price-quotation-validation':validation,'./price-quotation-catalog':catalog,'./price-quotation-policy':{PRICE_QUOTATION_POLICY_VERSION:'exclusive-address-sales-v1'},'./price-quotation-pdf':pdfRenderer,'@/lib/notifications/providers/green-api':{sendGreenApiFile:async payload=>{sent.push(payload);return {status:providerStatus,providerMessageId:providerStatus==='submitted'?'provider-id':null,sanitizedError:providerError};}}});
const route=load('src/app/api/price-quotations/route.ts',{'@/lib/quotes/price-quotation-server':server,'@/lib/quotes/managed-server':managed});
const detail=load('src/app/api/price-quotations/[id]/route.ts',{'@/lib/quotes/price-quotation-server':server});
const sendRoute=load('src/app/api/price-quotations/[id]/send/route.ts',{'@/lib/quotes/price-quotation-server':server});
const pdfRoute=load('src/app/api/price-quotations/[id]/pdf/route.ts',{'@/lib/quotes/price-quotation-server':server,'@/lib/quotes/price-quotation-pdf':pdfRenderer});
const catalogRoute=load('src/app/api/price-quotations/catalog/route.ts',{'@/lib/quotes/price-quotation-server':server,'@/lib/quotes/managed-server':managed,'@/lib/quotes/price-quotation-catalog':{priceQuotationCatalog:async(...args)=>{catalogCalls++;return catalog.priceQuotationCatalog(...args);}}});
const request=(method='GET',body,url='/api/price-quotations',headers={})=>new NextRequest(`https://example.com${url}`,{method,headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const params={params:Promise.resolve({id})};
const product=manifest.products[0],variant=options[product.id][0];
const draft={idempotency_key:id,customer_phone:'0500000001',items:[{product_id:product.id,sku:variant?.sku??'',unit:product.units[0]||'تحددها الإدارة',quantity:2.125,unit_price:12.34,notes:'Note'}],vat_rate:15,delivery_fee:10};
const guardedReads=[()=>pdfRoute.GET(request(),params),()=>catalogRoute.GET(request())];
authenticated=false;assert.equal((await route.GET(request())).status,401);for(const read of guardedReads)assert.equal((await read()).status,401);authenticated=true;
canManage=false;assert.equal((await route.POST(request('POST',draft))).status,403);for(const read of guardedReads)assert.equal((await read()).status,403);canManage=true;
frozen=true;for(const fn of [()=>route.GET(request()),()=>route.POST(request('POST',draft)),()=>detail.GET(request(),params),()=>sendRoute.POST(request('POST'),params),...guardedReads])assert.equal((await fn()).status,403);frozen=false;
assert.equal(renderCalls,0,'Unauthorized or frozen users never trigger PDF rendering');assert.equal(catalogCalls,0,'Unauthorized or frozen users never read the catalog');
assert.equal((await route.POST(request('POST',draft,'/api/price-quotations',{'sec-fetch-site':'cross-site'}))).status,403);
assert.equal((await route.GET(request('GET',undefined,'/api/price-quotations?page=-1'))).status,400);
assert.equal((await route.POST(request('POST',{...draft,customer_phone:'invalid'}))).status,400);
for(const changes of [{quantity:0},{quantity:0.0001},{unit_price:-1},{unit_price:12.345},{unit:'fake'},{sku:'forged'},{product_id:'brkz-000000000000000000000000'}])assert.equal((await route.POST(request('POST',{...draft,items:[{...draft.items[0],...changes}]}))).status,400);
let response=await route.POST(request('POST',{...draft,items:[{...draft.items[0],product_name:'FORGED',line_total:0,attributes:[{label:'Fake',value:'Fake'}]}],total:0,policy_version:'FORGED'}));assert.equal(response.status,201);
let body=await response.json();assert.equal(body.quotation.customer_phone,'+966500000001');assert.equal(body.quotation.customer_name,'');assert.equal(body.quotation.items[0].product_name,product.name);assert.equal(body.quotation.items[0].line_total,26.22);assert.equal(body.quotation.total,41.65);assert.equal(body.quotation.policy_version,'exclusive-address-sales-v1');assert.deepEqual(body.quotation.items[0].attributes,variant.attributes);assert.match(response.headers.get('cache-control'),/private, no-store/);
response=await pdfRoute.GET(request(),params);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('content-disposition'),'inline; filename="QUO-20261029-123456ABCDEF.pdf"');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(await response.text(),'%PDF');assert.equal(renderCalls,1);
response=await pdfRoute.GET(request('GET',undefined,`/api/price-quotations/${id}/pdf?download=1`),params);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(renderCalls,2);
response=await catalogRoute.GET(request('GET',undefined,`/api/price-quotations/catalog?product_id=${product.id}`));assert.equal(response.status,200);assert.equal((await response.json()).products[0].name,product.name);assert.equal(catalogCalls,1);
existing={...row,created_by:id,idempotency_key:id,request_fingerprint:savedPayload.p_fingerprint};response=await route.POST(request('POST',draft));assert.equal(response.status,201);assert.equal(calls.filter(call=>call.name==='price_quotation_create').length,1);
assert.equal((await route.POST(request('POST',{...draft,delivery_fee:11}))).status,409);existing=null;
response=await route.POST(request('POST',{...draft,source_request_id:sourceId,items:[{source_item_id:'line-1',product_id:'historical-product',unit:'قطعة',sku:'OLD',quantity:3,unit_price:2}]}));assert.equal(response.status,201);body=await response.json();assert.equal(body.quotation.items[0].product_name,'Historical canonical product');assert.equal(body.quotation.source_request_code,'BQ-ORIGINAL');
assert.equal((await route.POST(request('POST',{...draft,source_request_id:sourceId,items:[{source_item_id:'missing',product_id:'historical-product',unit:'قطعة',sku:'OLD',quantity:3,unit_price:2}]}))).status,400);
row={...row,send_status:'draft'};claimOK=false;assert.equal((await sendRoute.POST(request('POST'),params)).status,409);assert.equal(sent.length,0);claimOK=true;
response=await sendRoute.POST(request('POST'),params);assert.equal(response.status,200);assert.equal(sent.length,1);assert.equal(sent[0].file.type,'application/pdf');assert.match(sent[0].file.name,/\.pdf$/);assert.equal(sent[0].attempts,1);assert.equal(sent[0].to,'+966500000001');assert.match(sent[0].caption,/شركة العنوان الحصري/);
assert.equal((await sendRoute.POST(request('POST'),params)).status,200);assert.equal(sent.length,1);
row={...row,send_status:'draft'};providerStatus='failed';providerError='provider_timeout';response=await sendRoute.POST(request('POST'),params);assert.equal((await response.json()).quotation.send_status,'uncertain');assert.equal((await sendRoute.POST(request('POST'),params)).status,409);assert.equal(sent.length,2);
row={...row,send_status:'draft'};providerStatus='configuration_missing';providerError='provider_configuration_missing';response=await sendRoute.POST(request('POST'),params);assert.equal((await response.json()).quotation.send_status,'failed');
row={...row,send_status:'sending',send_started_at:'2020-01-01T00:00:00Z',idempotency_key:id,request_fingerprint:'secret',send_claim:'private',provider_message_id:'private'};response=await detail.GET(request(),params);body=await response.json();assert.equal(body.quotation.send_status,'uncertain');for(const key of ['idempotency_key','request_fingerprint','send_claim','provider_message_id'])assert.equal(Object.hasOwn(body.quotation,key),false);
row={...row,send_status:'draft',valid_until:'2020-01-01T00:00:00Z'};const before=sent.length;assert.equal((await sendRoute.POST(request('POST'),params)).status,409);assert.equal(sent.length,before);
assert.equal((await route.POST(new NextRequest('https://example.com/api/price-quotations',{method:'POST',headers:{'content-type':'application/json'},body:'{invalid'}))).status,400);
assert.equal((await route.POST(request('POST',{...draft,terms:'x'.repeat(110000)}))).status,413);
const half=validation.calculatePriceQuotationTotals([{quantity:0.005,unit_price:1}],0,0);assert.equal(half.subtotal,0.01);
assert.throws(()=>validation.calculatePriceQuotationTotals([{quantity:1000000,unit_price:10000000}],0,15));
for(const entry of manifest.products){const choice=options[entry.id][0];const item=await catalog.canonicalPriceQuotationItem(context,{product_id:entry.id,sku:choice?.sku??'',unit:entry.units[0]||'تحددها الإدارة',quantity:1,unit_price:1},0);assert.equal(item.product_name,entry.name);}
const supplierProduct={id:sourceId,name:'Supplier canonical',sku:'BASE'},supplierVariants=[{id,sku:'RED'},{id:sourceId,sku:'BIG'}];let supplierInput;
const supplierContext={...context,admin:{from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:supplierProduct,error:null};},then(resolve){return Promise.resolve(resolve({data:table==='product_variants'?supplierVariants:[],error:null}));}};return q;},async rpc(_name,input){supplierInput=input;return {data:{product_name:supplierProduct.name,unit:'box',quantity:2,measurement:'20cm',variant_selections:[{attributes:{Color:'Red'}},{attributes:{Size:'Big'}}],product_specifications_snapshot:['Manufacturer']},error:null};}}};
const supplierItem=await catalog.canonicalPriceQuotationItem(supplierContext,{product_id:sourceId,sku:'',variant_ids:[id,sourceId],measurement_id:id,unit:'box',quantity:2,unit_price:20},0);assert.equal(supplierInput.p_item.measurement_id,id);assert.deepEqual(supplierInput.p_item.variant_ids,[id,sourceId]);assert.equal(supplierItem.sku,'RED / BIG');assert.equal(supplierItem.attributes.length,4);
await assert.rejects(()=>catalog.canonicalPriceQuotationItem(supplierContext,{product_id:sourceId,sku:'',variant_ids:['00000000-0000-4000-8000-000000000099'],unit:'box',quantity:2,unit_price:20},0),error=>error.status===400);
let providerCalls=0;
const provider=load('src/lib/notifications/providers/green-api.ts',{'server-only':{},'node:timers/promises':{setTimeout:async()=>{}}},{process:{env:{GREEN_API_URL:'https://provider.invalid',GREEN_API_MEDIA_URL:'https://media.invalid',GREEN_API_ID_INSTANCE:'test',GREEN_API_TOKEN_INSTANCE:'test',GREEN_API_SEND_DELAY_MS:'0'}},FormData,AbortSignal,DOMException,fetch:async()=>{providerCalls++;return new Response('{}',{status:500});}});
const providerResult=await provider.sendGreenApiFile({to:'+966500000001',file:new File(['%PDF'],'quotation.pdf',{type:'application/pdf'}),caption:'Test',idempotencyKey:'test',attempts:1});assert.equal(providerResult.status,'failed');assert.equal(providerCalls,1,'File submission with attempts=1 never repeats a potentially accepted request');
const defaultProviderResult=await provider.sendGreenApiFile({to:'+966500000001',file:new File(['%PDF'],'existing.pdf',{type:'application/pdf'}),caption:'Existing caller',idempotencyKey:'existing'});assert.equal(defaultProviderResult.status,'failed');assert.equal(providerCalls,4,'Existing file callers retain the default three attempts');
console.log('Price quotation HTTP: authentication/archive denial, canonical catalog and source snapshots, money validation, bounded body, idempotency, private responses and single-attempt WhatsApp lifecycle passed. No real messages.');
