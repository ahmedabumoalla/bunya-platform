import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import postcss from 'postcss';
const require=createRequire(import.meta.url);
function load(file,mocks){const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(output,{exports,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id)});return exports;}
const portal=load('src/components/PortalUI.tsx',{'next/link':{default:({children,...p})=>React.createElement('a',p,children)},'@/components/brand/BunyaLogo':{BunyaLogo:()=>null},'@/lib/bunya-local':{createLocalId:()=>'',normalizeValue:v=>v}});
const multi=renderToStaticMarkup(React.createElement(portal.MultiValueInput,{label:'Specialties',placeholder:'Add',values:['x'.repeat(200)],onChange(){},error:'Required'}));
const inputId=multi.match(/<input id="([^"]+)"/)[1];assert.ok(multi.includes(`for="${inputId}"`));assert.ok(multi.includes(`aria-describedby="${inputId}-error"`));assert.ok(multi.includes(`id="${inputId}-error"`));assert.match(multi,/aria-invalid="true"/);
const password=renderToStaticMarkup(React.createElement(portal.PasswordFieldWithVisibilityCheckbox,{id:'password',label:'Password',value:'',onChange(){},error:'Required'}));assert.match(password,/aria-describedby="password-error"/);assert.match(password,/id="password-error"/);
for(const otp of [false,true]){const hooks={...React,useEffect(){},useState(initial){return [otp&&initial==='phone'?'otp':initial,()=>{}];}};const flow=load('src/components/PhoneVerificationFlow.tsx',{'react':hooks,'next/navigation':{useRouter:()=>({})},'@/lib/auth/return-to':{resolveSafeReturnTo:()=>''},'@/lib/auth/phone-verification':{maskSaudiPhone:()=>'',normalizeSaudiPhone:()=>'',pendingRegistrationCodeSentKey:'sent',pendingRegistrationPhoneKey:'phone'},'@/lib/supabase/client':{createClient:()=>({})},'@/components/PortalUI':portal});const html=renderToStaticMarkup(React.createElement(flow.PhoneVerificationFlow,{}));const buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);assert.equal(buttons.length,otp?4:2);assert.ok(buttons.every(a=>/portal-(?:primary|secondary)-button/.test(a)));if(otp)assert.match(html,/<input[^>]+id="phone-verification-otp"[^>]+dir="ltr"/);}
const css=postcss.parse(readFileSync('src/app/account-details.css','utf8'));assert.ok(css.nodes.length>10);
const linkMock={default:({children,...props})=>React.createElement('a',props,children)};
const brandMock={BunyaLogo:()=>null};
const {default:PageError}=load('src/app/error.tsx',{'next/link':linkMock,'@/components/brand/BunyaLogo':brandMock});
let retried=false;
const errorTree=PageError({error:new Error('private server diagnostic'),retry:()=>{retried=true;}});
const errorHtml=renderToStaticMarkup(errorTree);
assert.doesNotMatch(errorHtml,/private server diagnostic/);
function findButton(node){if(!React.isValidElement(node))return null;if(node.type==='button')return node;for(const child of React.Children.toArray(node.props.children)){const found=findButton(child);if(found)return found;}return null;}
findButton(errorTree).props.onClick();assert.equal(retried,true);
const {SubscriptionCard}=load('src/components/SubscriptionCard.tsx',{'next/link':linkMock});
for(const role of ['provider','contractor']){const html=renderToStaticMarkup(React.createElement(SubscriptionCard,{plan:{role,id:'plan',name:'Plan',priceMonthly:1,description:'Description',benefits:[],cta:'Join'}}));assert.ok(html.includes(`href="/${role==='provider'?'providers':'contractors'}/join"`));assert.doesNotMatch(html,/\?\?\?/);}
console.log('PASS account SSR, labelled errors, phone/OTP actions, retry callback/private-error suppression, subscription destinations and CSS. No API calls.');
