import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {NextRequest} from 'next/server.js';

class ManagedQuoteError extends Error {constructor(status,message){super(message);this.status=status;}}
let allowed=true,calls=0,lastInput,error=null;
const mock={priceQuotationContext:async()=>{if(!allowed)throw new ManagedQuoteError(403,'Denied');return {userId:'actor',admin:{rpc:async(name,input)=>{assert.equal(name,'sales_customer_search');calls++;lastInput=input;return {data:{customers:[{customer_number:'CUS-000001'}],count:1},error}}}}},priceQuotationResponse:(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}}),priceQuotationFailure:error=>Response.json({message:error.message},{status:error.status||500})};
const exports={};
new Function('exports','require',ts.transpileModule(readFileSync('src/app/api/price-quotations/customers/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,name=>name.endsWith('/managed-server')?{ManagedQuoteError}:mock);
const request=query=>new NextRequest('https://example.com/api/price-quotations/customers'+query);
allowed=false;assert.equal((await exports.GET(request('?q=0500000000'))).status,403);assert.equal(calls,0);allowed=true;
for(const query of ['?page=-1','?page=0.5','?page=100001','?q='+encodeURIComponent('x'.repeat(101)),'?q=%00'])assert.equal((await exports.GET(request(query))).status,400);
assert.equal(calls,0);
let response=await exports.GET(request('?q='+encodeURIComponent('العميل (أ),%')+'&page=1'));
assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(lastInput.p_query,'العميل (أ),%');assert.equal(lastInput.p_offset,20);assert.equal(lastInput.p_limit,20);
assert.equal((await response.json()).customers[0].customer_number,'CUS-000001');
error={code:'42501'};assert.equal((await exports.GET(request(''))).status,403);
error={code:'XX000'};assert.equal((await exports.GET(request(''))).status,503);
console.log('PASS customer search HTTP: auth before data, bounded validation, parameterized query, pagination, private response and service errors.');
