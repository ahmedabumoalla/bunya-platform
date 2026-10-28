import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,mocks){const loaded={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>{if(name in mocks)return mocks[name];throw Error('Unexpected dependency '+name);},loaded,loaded.exports);return loaded.exports;}
class PublicJoinError extends Error {constructor(message,status){super(message);this.status=status;}}
const phone=load('src/lib/auth/phone-verification.ts',{});
const username=load('src/lib/join/username.ts',{});
let created,queries,profileUpdate,rateKey,deleted,failProfile=false;
const admin={from:()=>({select:()=>({ilike:(key,value)=>{queries.push({key,value});return {maybeSingle:async()=>({data:null,error:null})};},eq:()=>({maybeSingle:async()=>({data:null,error:null})})}),update:value=>({eq:async()=>{profileUpdate=value;return {error:failProfile?new Error('write failed'):null};}})}),auth:{admin:{createUser:async value=>{created=value;return {data:{user:{id:'new-account'}},error:null};},deleteUser:async()=>{deleted=true;return {error:null};}}}};
const route=load('src/app/api/auth/register/route.ts',{
 '@/lib/auth/password-policy':{validatePassword:()=>null},
 '@/lib/auth/request-client':{authRouteOptions:()=>{},isLocalAppOrigin:()=>true,authRouteResponse:(_,body,status)=>Response.json(body,{status})},
 '@/lib/auth/phone-verification':phone,
 '@/lib/auth/phone-verification-delivery':{PhoneVerificationDeliveryError:class extends Error {},issuePhoneVerificationCode:async({phone})=>({phone,message:'sent'})},
 '@/lib/supabase/admin':{createAdminClient:()=>admin},
 '@/lib/join/security':{assertSameOrigin:()=>{},enforceRateLimit:(_,key)=>{rateKey=key;},PublicJoinError},
 '@/lib/join/username':username,
 '@/lib/notifications/providers/green-api':{checkGreenApiWhatsApp:async()=>({status:'available'})},
});
async function register(fields){created=null;queries=[];profileUpdate=null;deleted=false;return route.POST(new Request('http://localhost/api/auth/register',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'fixture'},body:JSON.stringify({fullName:'Test Customer',phone:'0500000000',password:'Example123',...fields})}));}
for(const fields of [{},{email:'',username:''},{email:'   ',username:'   '}]){
 const response=await register(fields);assert.equal(response.status,201);const result=await response.json();
 assert.match(result.loginEmail,/@phone\.bunya\.invalid$/);assert.equal(created.email,result.loginEmail);
 assert.equal(created.phone_confirm,undefined,'phone verification is never bypassed');assert.equal(created.user_metadata.username,undefined);
 assert.deepEqual(profileUpdate,{email:null});assert.deepEqual(queries,[]);assert.equal(rateKey,'register:+966500000000');
}
assert.equal((await register({email:'person@example.com',username:'person'})).status,201);
assert.equal(created.email,'person@example.com');assert.equal(created.user_metadata.username,'person');assert.equal(profileUpdate,null);assert.equal(queries.length,2);
assert.equal((await register({email:'person@example.com'})).status,201);assert.equal(queries.length,1);
assert.equal((await register({username:'person'})).status,201);assert.equal(queries.length,1);
for(const fields of [{phone:''},{phone:'123'},{email:'bad-email'},{username:'ab'}]){assert.equal((await register(fields)).status,400);assert.equal(created,null);}
failProfile=true;assert.equal((await register({})).status,500);assert.equal(deleted,true,'failed setup removes only the just-created account');
const ui=readFileSync('src/components/AuthFlows.tsx','utf8');
assert.ok(ui.includes('if(form.email.trim()&&!emailPattern.test(form.email.trim()))'));
assert.ok(ui.includes('if(username&&(username.length<4||username.length>40))'));
assert.ok(ui.includes('email:body.loginEmail||form.email.trim().toLowerCase()'));
assert.ok(ui.includes('البريد الإلكتروني (اختياري)'));
assert.ok(ui.includes('اسم المستخدم (اختياري)'));
assert.ok(ui.includes('رقم الجوال السعودي (إجباري)'));
console.log('PASS registration: optional email/username independently and together, required valid mobile, provided-field validation, bootstrap without phone verification bypass, rollback.');
