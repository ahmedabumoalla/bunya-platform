import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,mocks={}){const loaded={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name==='server-only'?{}:name in mocks?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;}
const managed=load('src/lib/notifications/managed-quotes.ts');
const compact=load('src/lib/notifications/compact.ts');
const catalog=load('src/lib/notifications/event-catalog.ts',{'@/lib/admin/event-labels':{adminEventLabels:{}},'./compact':compact});
const quoteId='2f8a0333-f79e-4248-8186-8fde80e258f0',code='BQ-FC1544E9307F';
let queued=null,ownerActive=true,ownerRole='super_admin',allowed=true,sendStatus='submitted',providerRecord=null,enqueueFailure=false;
const sent=[],finished=[];
const db={
 from(table){const filters={};const q={
  select(){return q;},eq(key,value){filters[key]=value;return q;},
  async upsert(value,options){assert.equal(table,'outbox_events');assert.equal(options.ignoreDuplicates,true);assert.equal(options.onConflict,'idempotency_key');if(enqueueFailure)return {error:{message:'unavailable'}};queued??={id:'event-id',status:'pending',...value};return {error:null};},
  async maybeSingle(){if(table==='managed_quote_requests')return {data:{id:quoteId,request_code:code},error:null};if(table==='admin_users'){assert.equal(filters.profile_id,managed.MANAGED_QUOTE_OWNER_ID);return {data:{is_active:ownerActive,admin_roles:{role_key:ownerRole},profiles:{is_active:true}},error:null};}if(table==='notification_provider_submissions')return {data:providerRecord,error:null};throw Error('Unexpected read '+table);},
  async single(){assert.equal(table,'outbox_events');return {data:queued?{id:queued.id}:null,error:null};},
 };return q;},
 async rpc(name,args){
  if(name==='managed_quote_actor_allowed'){assert.equal(args.p_actor,managed.MANAGED_QUOTE_OWNER_ID);return {data:allowed,error:null};}
  if(name==='claim_notification_outbox_event'){assert.ok(args.p_event_types.includes(managed.MANAGED_QUOTE_SUBMITTED_EVENT));const data=queued?.status==='pending'||queued?.status==='failed'?[{...queued}]:[];if(data.length)queued.status='processing';return {data,error:null};}
  if(name==='finish_notification_outbox'){finished.push(args);queued.status=args.p_success?'processed':'failed';return {error:null};}
  throw Error('Unexpected RPC '+name);
 },
};
const dispatcher=load('src/lib/notifications/dispatcher.ts',{
 '@/lib/supabase/admin':{createAdminClient:()=>db},'./managed-quotes':managed,'./compact':compact,'./event-catalog':catalog,
 './providers/green-api':{maskWhatsAppDestination:()=> '966****401',sendGreenApiMessage:async input=>{sent.push(input);return {status:sendStatus,providerMessageId:sendStatus==='submitted'?'fixture-id':null};}},
 './providers/resend':{sendResendSensitiveCopy:()=>{throw Error('No email expected');}},
 './submissions':{maskEmail:()=>'',recordProviderSubmission:async input=>{providerRecord={status:input.result.status};}},
 './native-push':{sendNativePush:()=>{throw Error('Existing in-app notice must not be duplicated');}},
 './site-url':{OFFICIAL_PLATFORM_URL:'https://www.buniahksa.com'},
});
const eventId=await managed.enqueueManagedQuoteNotification(db,quoteId);
assert.equal(eventId,'event-id');assert.equal(queued.aggregate_id,quoteId);
await dispatcher.dispatchNotificationEvent(eventId);
assert.equal(sent.length,1);assert.equal(sent[0].to,'+966508424401');
assert.equal(sent[0].text,`طلب عرض سعر جديد · ${code}\nhttps://www.buniahksa.com/admin/managed-quotes/${quoteId}`);
assert.equal(queued.status,'processed');
await managed.enqueueManagedQuoteNotification(db,quoteId);await dispatcher.dispatchNotificationEvent(eventId);
assert.equal(sent.length,1,'repeated customer submit keeps processed event intact');
queued.status='failed';await dispatcher.dispatchNotificationEvent(eventId);assert.equal(sent.length,1,'provider submission already recorded is not sent twice');
for(const revoke of ['inactive','role','permission']){
 queued.status='pending';providerRecord=null;ownerActive=revoke!=='inactive';ownerRole=revoke==='role'?'reviewer':'super_admin';allowed=revoke!=='permission';
 await dispatcher.dispatchNotificationEvent(eventId);assert.equal(sent.length,1);assert.equal(queued.status,'failed','revoked owner never falls back to other admins');
}
ownerActive=true;ownerRole='super_admin';allowed=true;sendStatus='failed';queued.status='pending';
await dispatcher.dispatchNotificationEvent(eventId);assert.equal(queued.status,'failed');assert.equal(finished.at(-1).p_error,'provider_submission_failed');
sendStatus='submitted';await dispatcher.dispatchNotificationEvent(eventId);assert.equal(queued.status,'processed');
enqueueFailure=true;await assert.rejects(managed.enqueueManagedQuoteNotification(db,quoteId),/enqueue_failed/);
console.log('PASS managed quote WhatsApp: owner-only explicit number, readable reference/link, durable unique event, retries, no duplicate sends/notices, revoked recipient denied. No real messages sent.');
