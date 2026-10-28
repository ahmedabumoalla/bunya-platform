import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const loaded = {exports: {}};
  new Function('require','module','exports',code)(name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const common = load('src/lib/supabase/archive-fetch.ts');
const ids = [...common.ARCHIVE_ACTORS];
const base = 'https://project.example';
const token = id => 'Bearer e30.'+Buffer.from(JSON.stringify({sub:id})).toString('base64url')+'.signature';
let status = {active:true,eligible:true,captured_at:'2026-10-28T11:00:00Z'};
let statusCode = 200;
const calls = [];
const transport = async (input,init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push({url,init});
  if (url.endsWith('/rpc/admin_archive_status')) return Response.json(status,{status:statusCode});
  return Response.json([{id:'old',image_url:base+'/storage/v1/object/public/provider-product-images/old.png'}],{headers:{'Content-Range':'0-0/1'}});
};
for (const id of ids) {
  const read = common.createArchiveFetch(base,transport);
  const headers = {authorization:token(id),'Accept-Profile':'public','Content-Profile':'public'};
  const response = await read(base+'/rest/v1/products?select=*,product_images(*)',{headers});
  assert.equal(calls.at(-1).init.headers.get('Accept-Profile'),'admin_archive');
  assert.equal(calls.at(-1).init.headers.get('authorization'),token(id),'JWT retained for independent RLS');
  assert.equal(response.headers.get('Content-Range'),'0-0/1');
  assert.equal((await response.json())[0].image_url,'/api/admin/archive/files/provider-product-images/old.png');
  for (const [path,method] of [['products','POST'],['profiles','PATCH'],['orders','DELETE'],['rpc/review_product','POST'],['rpc/unknown','GET']]) {
    const before = calls.length;
    assert.equal((await read(base+'/rest/v1/'+path,{method,headers})).status,403);
    assert.equal(calls.length,before,'denied writes never reach network');
  }
  await read(base+'/rest/v1/rpc/admin_attention_counts',{method:'POST',headers,body:'{}'});
  assert.equal(calls.at(-1).init.headers.get('Content-Profile'),'admin_archive');
  await read(base+'/rest/v1/notifications?or=(expires_at.is.null,expires_at.gt.2030-01-01T00:00:00Z)',{headers});
  assert.match(new URL(calls.at(-1).url).searchParams.get('or'),/2026-10-28T11:00:00Z/,'notification expiry uses snapshot clock');
  await read(base+'/storage/v1/object/sign/provider-product-images/old.png',{method:'POST',headers,body:'{"expiresIn":300}'});
  assert.equal(calls.at(-1).url,'/api/admin/archive/storage');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{bucket:'provider-product-images',path:'old.png',expiresIn:300});
  await read(base+'/storage/v1/object/sign/provider-product-images/old.png',{method:'POST',headers,body:new TextEncoder().encode('{"expiresIn":300}').buffer});
  assert.equal(calls.at(-1).url,'/api/admin/archive/storage','delegated ArrayBuffer body remains a read');
  assert.equal((await read(base+'/storage/v1/object/provider-product-images/new.png',{method:'PUT',headers,body:'file'})).status,403);
}
status = {active:false,eligible:false};
const inactive = common.createArchiveFetch(base,transport);
const headers = {authorization:token(ids[0])};
await inactive(base+'/rest/v1/products',{headers});
assert.equal(calls.at(-1).init.headers,headers,'not activated: original behavior retained');
status = {active:true,eligible:false};
assert.equal((await common.createArchiveFetch(base,transport)(base+'/rest/v1/products',{headers})).status,403);
for (const path of [`/rest/v1/profiles?id=eq.${ids[0]}&select=id,is_active,must_change_password`, `/rest/v1/user_roles?profile_id=eq.${ids[0]}`]) {
  await common.createArchiveFetch(base,transport)(base+path,{headers});
  assert.equal(calls.at(-1).init.headers.get('Accept-Profile'),'public','own authentication remains live during password reset');
}
await common.createArchiveFetch(base,transport)(base+'/rest/v1/rpc/complete_temporary_password_change',{method:'POST',headers,body:'{}'});
assert.equal(calls.at(-1).init.headers.get('Content-Profile'),'public','completion uses independently authorized live RPC');
assert.equal((await common.createArchiveFetch(base,transport)(base+`/rest/v1/profiles?id=eq.${ids[1]}&select=must_change_password`,{headers})).status,403,'other identity cannot bypass archive gate');
statusCode = 500;
assert.equal((await common.createArchiveFetch(base,transport)(base+'/rest/v1/products',{headers})).status,403);
statusCode = 404;
await common.createArchiveFetch(base,transport)(base+'/rest/v1/products',{headers});
assert.equal(calls.at(-1).init.headers,headers,'rollout before migration leaves behavior unchanged');
statusCode = 200;status = {active:true,eligible:true};
await common.createArchiveFetch(base,transport,async()=> 'https://platform.example')(base+'/storage/v1/object/sign/provider-product-images/old.png',{method:'POST',headers,body:'{}'});
assert.equal(calls.at(-1).url,'https://platform.example/api/admin/archive/storage','server storage uses trusted absolute origin');
const count = calls.length;
await common.createArchiveFetch(base,transport)('https://other.example/rest/v1/products',{headers});
assert.equal(calls.length,count+1,'never sends status/token to another host');

const identityResolver = load('src/lib/auth/resolve-identity.ts', {'@/lib/supabase/archive-fetch':common,'./types':{isAppRole:role=>role==='admin'}});
const identityClient = {
  from: table => {
    const result = table==='profiles' ? {data:{id:ids[0],is_active:true,must_change_password:true}}
      : table==='user_roles' ? {data:[{role:'admin',is_primary:true}]} : {data:null,error:new Error('Password required')};
    const chain = new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>chain});
    return chain;
  }, rpc:async()=>({data:false}),
};
const pendingIdentity = await identityResolver.resolveAuthIdentity(identityClient,{id:ids[0]});
assert.equal(pendingIdentity.profile.mustChangePassword,true);
assert.equal(pendingIdentity.status,'role_not_ready','pending account resolves self identity without claiming business readiness');

// Service reads use a verified request actor, never an incoming archive-actor hint.
let userId = ids[0], bearerUserId = null, suppliedBearer = null, active = true, eligible = true, requiresPassword = false, authError = null;
const rpcCalls = [];
const raw = {
  auth:{getUser:async()=>({data:{user:{id:bearerUserId ?? userId}},error:authError})},
  rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{active,eligible,requires_password_change:requiresPassword},error:null};},
};
const original = {auth:{getUser:async()=>({data:{user:{id:userId}},error:authError}),getSession:async()=>({data:{session:{access_token:token(userId).slice(7)}}})}};
const previousSecret = process.env.SUPABASE_SECRET_KEY;
process.env.SUPABASE_SECRET_KEY = 'unit-test-only';
try {
  const server = load('src/lib/supabase/archive-server.ts',{
    'next/headers':{cookies:async()=>({get:()=>undefined}),headers:async()=>new Headers({'x-bunya-archive-actor':'forged',...(suppliedBearer?{authorization:suppliedBearer}:{})})},
    '@supabase/supabase-js':{createClient:()=>raw},'./session':{createOriginalClient:async()=>original},
    './env':{getSupabasePublicEnv:()=>({url:base,key:'public'})},'./archive-fetch':common,
    '@/lib/auth/impersonation-cookie':{IMPERSONATION_COOKIE:'maintenance'},
  });
  const service = server.createArchiveServiceFetch(base,transport);
  await service(base+'/rest/v1/managed_quote_requests',{headers:{authorization:'service-credential','x-bunya-archive-actor':'forged'}});
  assert.equal(calls.at(-1).init.headers.get('x-bunya-archive-actor'),ids[0]);
  assert.equal(calls.at(-1).init.headers.get('Accept-Profile'),'admin_archive');
  assert.equal((await service(base+'/rest/v1/orders',{method:'PATCH'})).status,403);
  assert.equal((await service(base+'/auth/v1/admin/users',{method:'POST'})).status,403);
  eligible = false;
  await assert.rejects(server.createArchiveServiceFetch(base,transport)(base+'/rest/v1/products'),/revoked/);
  eligible = true;authError = new Error('expired');
  await assert.rejects(server.createArchiveServiceFetch(base,transport)(base+'/rest/v1/products'),/authenticate/);
  authError = null;
  requiresPassword = true;
  await assert.rejects(server.createArchiveServiceFetch(base,transport)(base+'/rest/v1/products'),/Password change required/);
  requiresPassword = false;
  bearerUserId = '8b9f3886-e1b8-4816-9fbb-d425b0753255';suppliedBearer = token(bearerUserId);
  await assert.rejects(server.createArchiveServiceFetch(base,transport)(base+'/rest/v1/products'),/Conflicting/,'unrelated bearer cannot override frozen cookie');
  bearerUserId = null;suppliedBearer = null;
  userId = '8b9f3886-e1b8-4816-9fbb-d425b0753255';eligible = true;
  const oldCount = rpcCalls.length;
  await server.createArchiveServiceFetch(base,transport)(base+'/rest/v1/products',{headers:{'x-bunya-archive-actor':ids[0]}});
  assert.equal(rpcCalls.length,oldCount,'unrestricted actor cannot be switched by supplied header');
  assert.equal(calls.at(-1).init.headers.get('x-bunya-archive-actor'),null);
} finally {if(previousSecret===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=previousSecret;}
console.log('Admin archive HTTP PASS: both actors, frozen reads/joins/count headers, RPC allowlist, no mutations, assets, verified service context, fail-closed status, unrestricted behavior.');
