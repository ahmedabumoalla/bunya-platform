import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const config = { PAYMOB_API_KEY:'test-fixture', PAYMOB_SECRET_KEY:'sk_live_fixture', PAYMOB_PUBLIC_KEY:'pk_live_fixture', PAYMOB_HMAC_SECRET:'isolated-fixture-only', PAYMOB_INTEGRATION_IDS:'42' };
let replies = [], fetchCalls = [];
async function fakeFetch(url, options) { fetchCalls.push({url,options});const next=replies.shift();if(next instanceof Error)throw next;return next; }
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function load(path,mocks={}) {
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:id=>id==='server-only'?{}:Object.hasOwn(mocks,id)?mocks[id]:require(id),process:{env:config},fetch:fakeFetch,AbortSignal,Date,Buffer,URLSearchParams});return exports;
}
const paymob=load('src/lib/payments/paymob.ts');
const payments=load('src/lib/payments/contractor-payments.ts',{'./paymob':paymob});
let calls=[],dbError=null;
const db={from(){const query={select(){return query;},eq(){return query;},update(value){calls.push({update:value});return query;},maybeSingle:async()=>({data:{id:'payment',amount:100,status:'pending'},error:dbError}),then(resolve){return Promise.resolve({error:dbError}).then(resolve);}};return query;},async rpc(name,args){calls.push({name,args});return {data:{status:args.p_outcome==='failed'?'pending':args.p_outcome},error:dbError};}};
const tx={id:12,order:{id:34},integration_id:42,amount_cents:10000,currency:'SAR',pending:false,success:true,is_live:true};
for(const changed of [{currency:'USD'},{amount_cents:1},{integration_id:99},{order:{id:'bad'}}]) await assert.rejects(()=>payments.applyContractorTransaction(db,{...tx,...changed}));
assert.equal(calls.length,0,'mismatched callbacks must not write');
assert.equal((await payments.applyContractorTransaction(db,{...tx,pending:true})).status,'pending');
assert.equal((await payments.applyContractorTransaction(db,{...tx,is_auth:true,is_capture:false})).status,'pending');
assert.equal(calls.length,0,'authorization without capture is not revenue');
await payments.applyContractorTransaction(db,tx);
assert.equal(calls[0].args.p_outcome,'succeeded');assert.equal(calls[0].args.p_amount,100);
await payments.applyContractorTransaction(db,{...tx,is_refunded:true});assert.equal(calls.at(-1).args.p_outcome,'refunded');
const expired={id:'payment',gateway_order_id:'34',expires_at:'2000-01-01T00:00:00Z'};
calls=[];replies=[response({token:'fixture'}),response(tx)];await payments.reconcileContractorPayment(db,expired);
assert.equal(calls[0].args.p_outcome,'succeeded');
calls=[];replies=[response({token:'fixture'}),response({...tx,pending:true})];await payments.reconcileContractorPayment(db,expired);assert.equal(calls.length,0,'pending payment remains reserved after checkout expiry');
replies=[response({token:'fixture'}),response({},404)];assert.equal((await payments.reconcileContractorPayment(db,expired)).status,'failed');assert.equal(calls.at(-1).update.status,'failed');
calls=[];replies=[response({},500)];await assert.rejects(()=>payments.reconcileContractorPayment(db,expired));assert.equal(calls.length,0,'network failure cannot authorize another payment');
replies=[response({token:'fixture'}),response({...tx,is_live:false})];await assert.rejects(()=>payments.reconcileContractorPayment(db,expired));
replies=[response({id:'intent',client_secret:'fixture-secret',intention_order_id:34})];
assert.equal((await paymob.createPaymobIntention({amountCents:10000,paymentRecordId:'payment',orderCode:'CHAT-1',quoteId:'quote',customer:{fullName:'Test Only',phone:'fixture',email:'fixture'},notificationUrl:'https://example.invalid/callback',redirectionUrl:'https://example.invalid/return'})).orderId,'34');
assert.equal(JSON.parse(fetchCalls.at(-1).options.body).amount,10000);
assert.equal(paymob.verifyPaymobHmac(tx,null),false);assert.equal(paymob.verifyPaymobHmac(tx,'bad'),false);
// Independently construct the documented canonical HMAC fields, then tamper with a signed amount.
const fields=['amount_cents','created_at','currency','error_occured','has_parent_transaction','id','integration_id','is_3d_secure','is_auth','is_capture','is_refunded','is_standalone_payment','is_voided','order.id','owner','pending','source_data.pan','source_data.sub_type','source_data.type','success'];
const canonical=fields.map(key=>{const value=key.split('.').reduce((v,k)=>v?.[k],tx);return value==null?'':String(value);}).join('');
const signature=createHmac('sha512',config.PAYMOB_HMAC_SECRET).update(canonical).digest('hex');
assert.equal(paymob.verifyPaymobHmac(tx,signature),true);assert.equal(paymob.verifyPaymobHmac({...tx,amount_cents:1},signature),false);
console.log('PASS contractor payments: signed callback integrity, order/currency/integration/amount matching, capture requirement, reconciliation/expiry holds and intention order correlation. Isolated fixtures only.');
