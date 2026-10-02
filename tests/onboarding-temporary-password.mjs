import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const generators = {};
vm.runInNewContext(compile('../src/lib/join/admin.ts'), { exports: generators, require: name => name === 'node:crypto' ? crypto : {} });
for (let i = 0; i < 500; i++) assert.match(generators.generateOnboardingTemporaryPassword(), /^[1-9][0-9]{7}$/);
const driver = generators.generateTemporaryPassword();
assert.equal(driver.length, 18);assert.match(driver, /[A-Z]/);assert.match(driver, /[a-z]/);assert.match(driver, /[0-9]/);assert.match(driver, /[!@#$%*\-_+]/);
const send = {}, sent = [];
vm.runInNewContext(compile('../src/lib/notifications/send-onboarding-credentials.ts'), { exports: send, require(name) {
  if (name === './providers/green-api') return { sendGreenApiMessage: async input => { sent.push(input);return {}; }, maskWhatsAppDestination: () => 'masked' };
  if (name === './providers/resend') return { sendResendSensitiveCopy: async input => { sent.push(input);return {}; } };
  if (name === './submissions') return { recordProviderSubmission: async () => {}, maskEmail: () => 'masked' };
  if (name === './site-url') return { OFFICIAL_PLATFORM_URL: 'https://example.invalid' };
  return {};
} });
for (const kind of ['provider','contractor']) {
  await send.sendOnboardingCredentials({ kind, applicationId: 'test', applicantName: 'test', details: [], email: 'test@invalid.example', mobile: '0500000001', password: '12345678', idempotencyKey: kind });
}
assert.equal(sent.length, 4);
for (const message of sent) { assert.ok(message.text.includes('12345678'));assert.ok(message.text.includes('24 ساعة'));assert.ok(!message.text.includes('72')); }

const routeCode = compile('../src/app/api/admin/join-requests/[kind]/[id]/[action]/route.ts');
async function resend(kind, failAt) {
  const events=[], exports={};let renewed;
  const admin={
    from(table) {
      let update;
      const query={ select(){return this;},eq(){return this;},update(value){update=value;return this;},
        async maybeSingle(){
          if(table===`${kind}_applications`) return {data:{status:'approved',email:'test@invalid.example',mobile:'0500000001'}};
          if(table==='account_onboarding_deliveries') return {data:{auth_user_id:'user'}};
          if(table==='profiles') { events.push('renew');renewed=update;return failAt==='profile'?{error:{code:'failed'}}:{data:{id:'user'}}; }
          throw Error(table);
        },then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}
      };return query;
    },
    auth:{admin:{async updateUserById(id,input){events.push('password');assert.equal(id,'user');assert.match(input.password,/^[0-9]{8}$/);return {error:failAt==='auth'?{}:null};}}},
    async rpc(){events.push('delivery');return {};}
  };
  vm.runInNewContext(routeCode,{exports,crypto,Date,console,require(name){
    if(name==='next/server') return {NextResponse:{json:(body,options)=>({body,status:options?.status??200})}};
    if(name==='@/lib/join/admin')return {...generators,requireJoinReviewer:async()=>({admin,userId:'reviewer'})};
    if(name==='@/lib/notifications/send-onboarding-credentials')return {sendOnboardingCredentials:async()=>{events.push('send');return {whatsapp:{status:'failed'},email:{status:'submitted'}};}};
    if(name==='node:crypto')return crypto;
    return {};
  }});
  const result=await exports.POST({json:async()=>({})},{params:Promise.resolve({kind,id:'application',action:'resend-credentials'})});
  if(failAt){assert.equal(result.status,500);assert.equal(events.includes('send'),false);}
  else{assert.equal(result.status,200);assert.deepEqual(events,['password','renew','send','delivery']);assert.equal(renewed.must_change_password,true);assert.equal(renewed.password_changed_at,null);assert.equal(Date.parse(renewed.temporary_password_expires_at)-Date.parse(renewed.temporary_password_issued_at),86400000);}
}
for(const kind of ['provider','contractor'])for(const failure of [undefined,'auth','profile'])await resend(kind,failure);
console.log('PASS: 8-digit cryptographic onboarding passwords, unchanged driver generator, both-channel 24h message, both-role resend renewal and failure ordering; no real messages');
