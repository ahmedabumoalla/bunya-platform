import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(file,mocks={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),console,URL});return exports;
}
const types=load('src/lib/auth/types.ts');
const accountModule=load('src/lib/auth/public-account.ts',{'./types':types});
const {publicAccountFor}=accountModule;
const link={default:({children,...props})=>React.createElement('a',props,children)};
const accountStyles={default:new Proxy({},{get:(_,key)=>key})};
const accountLinkModule=load('src/components/home/PublicAccountLink.tsx',{'next/link':link,'./PublicAccountHeader.module.css':accountStyles});
const identity=role=>({status:'ready',userId:'user',primaryRole:role,activeRoles:[role,...(['provider','contractor'].includes(role)?['customer']:[])],profile:{isActive:true,mustChangePassword:false},details:{customer:{exists:true},provider:role==='provider'?{providerId:'supplier',companyName:'Test'}:null,contractor:role==='contractor'?{contractorProfileId:'builder'}:null,admin:null,driver:null}});
const {StoreHeader}=load('src/components/home/HomeStorefrontUi.tsx',{
  'next/link':link,'@/lib/auth/public-account':accountModule,'@/lib/products/image-urls':{},
  '@/components/brand/BunyaLogo':{BunyaLogo:()=>null},'@/components/i18n/LanguageSwitcher':{MobileHeaderLanguageSwitcher:()=>null},'./PublicAccountHeader.module.css':accountStyles,'./PublicAccountLink':accountLinkModule,
});
for(const [role,href] of Object.entries(types.ROLE_ROUTES)) {
  const account=publicAccountFor(identity(role));assert.equal(account.href,href);
  const html=renderToStaticMarkup(React.createElement(StoreHeader,{account,quoteCount:0,compact:false,menuOpen:false,quoteOpen:false,onMenuToggle(){},onNavigate(){},onQuoteOpen(){}}));
  assert.match(html,new RegExp(`href="${href}"[^>]*aria-label="ملفي الشخصي`));
  assert.match(html,new RegExp(`class="mobileActions"><a[^>]*href="${href}"`),'Account link exists outside mobile drawer on first render');
  assert.equal(html.includes('href="/providers/join"'),false);
  assert.equal(html.includes('href="/contractors/join"'),false);
  assert.equal(html.includes('لوحة التحكم'),false);
  assert.match(html,/class="avatar" aria-hidden="true"/);
  assert.ok(html.includes(account.roleLabel));
}
const guest=publicAccountFor(null);assert.equal(guest.signedIn,false);assert.equal(guest.href,'/login');assert.equal(guest.canApplyProvider,true);
const guestHtml=renderToStaticMarkup(React.createElement(StoreHeader,{account:guest,quoteCount:0,menuOpen:true}));
for(const href of ['/login','/providers/join','/contractors/join']) assert.ok(guestHtml.includes(`href="${href}"`));
assert.equal(guestHtml.includes('class="accountLink"'),false);
const named=publicAccountFor({...identity('admin'),profile:{fullName:'  أحمد محمد  '}});
assert.equal(named.displayName,'أحمد محمد');assert.equal(named.initials,'أم');
const fallbackHtml=renderToStaticMarkup(React.createElement(accountLinkModule.PublicAccountLink,{account:publicAccountFor(identity('customer'))}));
assert.match(fallbackHtml,/<circle/,'Missing name uses a profile icon');
assert.equal(publicAccountFor({...identity('provider'),profile:{mustChangePassword:true}}).href,'/account/change-password');
assert.equal(publicAccountFor({...identity('provider'),status:'inactive_profile'}).href,'/login');
assert.equal(publicAccountFor({...identity('provider'),activeRoles:['provider','contractor','customer']}).canApplyContractor,false);
async function portal(value,expected='customer') {
  const authServer=load('src/lib/auth/server.ts',{'server-only':{},react:{cache:fn=>fn},'next/navigation':{redirect:url=>{throw Error(`redirect:${url}`);}},'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:value?{id:'user'}:null},error:null})}})},'./resolve-identity':{resolveAuthIdentity:async()=>value,roleIsReady:(role,details)=>role==='customer'?details.customer.exists:Boolean(details[role])},'./types':types});
  return authServer.requirePortalRole(expected);
}
for(const role of ['provider','contractor']) {
  const current=identity(role);assert.equal(await portal(current),current);assert.equal(await portal(current,role),current);
  await assert.rejects(portal({...current,activeRoles:[role]}),/redirect:/);
  await assert.rejects(portal({...current,details:{...current.details,customer:{exists:false}}}),/redirect:/);
  await assert.rejects(portal({...current,details:{...current.details,[role]:null}}),/redirect:/);
  await assert.rejects(portal({...current,profile:{mustChangePassword:true}}),/change-password/);
  await assert.rejects(portal({...current,status:'inactive_profile'}),/inactive_profile/);
}
await assert.rejects(portal(identity('admin')),/redirect:\/admin/);await assert.rejects(portal(null),/redirect:\/login/);
const shellMocks={
  'next/link':link,'next/navigation':{usePathname:()=>'/merchant'},'@/lib/supabase/client':{},'@/components/brand/BunyaLogo':{BunyaLogo:()=>null},'@/components/auth/LogoutButton':{LogoutButton:()=>null},'@/components/admin/AdminIcon':{AdminIcon:()=>null},'@/lib/body-scroll-lock':{},
};
for(const customerReady of [true,false]) {
  const current=identity('provider');current.details.customer.exists=customerReady;
  const {ProviderShell}=load('src/components/provider/ProviderShell.tsx',{...shellMocks,'@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>current}});
  const html=renderToStaticMarkup(React.createElement(ProviderShell));assert.equal(html.includes('href="/customer"'),customerReady);
  assert.match(html,/href="\/" aria-label="بُنية — الصفحة الرئيسية للموقع"/);
}
const {AdminShell}=load('src/components/admin/AdminShell.tsx',{
  ...shellMocks,'next/navigation':{usePathname:()=>'/admin'},'@/lib/admin/navigation':{adminGroups:[]},'./AdminIcon':{AdminIcon:()=>null},'./AdminSectionNav':{AdminSectionNav:()=>null},'@/components/auth/AuthIdentityProvider':{useAuthIdentity:()=>identity('admin')},
});
const adminHtml=renderToStaticMarkup(React.createElement(AdminShell));
assert.match(adminHtml,/<a href="\/" class="admin-brand" aria-label="بُنية — الصفحة الرئيسية للموقع"/);
console.log('PASS profile links for five roles, mobile account visibility, signed-in join suppression, guest/password states, name/icon fallbacks, admin/provider home links and guarded dual-role portal access');

const drafts=load('src/lib/quotes/pending-draft.ts');
const phones=load('src/lib/auth/phone-verification.ts');
const draft={version:1,idempotencyKey:'professional-account-rfq',items:[{productId:'20000000-0000-4000-8000-000000000003',productName:'Other supplier product',unit:'piece',quantity:1,selectedVariants:[]}],details:{...drafts.emptyStorefrontQuoteDetails,locationHint:'الرياض موقع العمل',mapsUrl:'https://maps.app.goo.gl/example',desiredReceiptAt:new Date(Date.now()+86400000).toISOString(),recipientName:'Test buyer',recipientMobile:'0500000001',siteResponsibleName:'Test owner',siteResponsibleMobile:'0500000002',workingHours:'من 7 إلى 16',loadingOption:'provider',unloadingOption:'customer',roadAccess:'accessible',accessInstructions:'مدخل الموقع واضح',driverDepartureLiabilityAccepted:true,dataAccuracyAccepted:true}};
for(const role of ['provider','contractor',null]) {
  let called=false;
  const db={auth:{getUser:async()=>({data:{user:role?{id:'buyer',app_metadata:{role}}:null},error:null})},rpc:async(name,args)=>{called=true;assert.equal(name,'submit_storefront_rfq');assert.equal(args.p_items[0].product_id,draft.items[0].productId);assert.equal(args.p_request.recipient_mobile,'+966500000001');return{data:'request-id',error:null};},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{quote_window_label:'Received'}})})};
  const api=load('src/app/api/customer/quote-requests/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200,cookies:{set(){}}})}},
    '@/lib/auth/phone-verification':phones,'@/lib/quotes/pending-draft':drafts,
    '@/lib/quotes/pending-draft-server':{deletePendingQuote:async()=>{},pendingQuoteCookie:'draft',pendingQuoteCookieOptions:{}},
    '@/lib/supabase/server':{createClient:async()=>db},
  });
  const response=await api.POST({json:async()=>draft,cookies:{get:()=>undefined}});
  assert.equal(response.status,role?201:401,JSON.stringify(response.body));assert.equal(called,Boolean(role));
}
console.log('PASS actual quote-request API accepts authenticated provider/contractor draft contracts and denies guest before RPC; SQL tests cover role/self-supplier enforcement');
