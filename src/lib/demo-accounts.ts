import type {ContractorApplication, CustomerRegistration, ProviderApplication} from "./bunya-types";
import {contractorProfileMock} from "./contractor-data";
import {customerProfileMock} from "./customer-data";
import {localStorageKeys, normalizeValue, readLocalCollection} from "./bunya-local";
import {providerProfileMock} from "./provider-data";

const DEMO_PASSWORD_PROOF = "f0832245d7b76d85a0eaa33188ea74e6417d2e6eb0ee18fb4dc18b282ac4960d";
const SEEDED_AT = "2026-07-16T00:00:00.000Z";

export type DemoAccountRole = "customer" | "provider" | "contractor";
export type DemoAccount = {
  id:string;
  role:DemoAccountRole;
  displayName:string;
  email:string;
  username:string;
  mobile:string;
  passwordProof:string;
  route:"/customer"|"/merchant"|"/contractor";
  status:"active"|"approved";
};

export const demoAccountCredentials = [
  {role:"customer",label:"حساب العميل",email:"customer.demo@bunya.test",username:"customer.demo",mobile:"0500000101",password:"Bunya@123",route:"/customer"},
  {role:"provider",label:"حساب المزود",email:"provider.demo@bunya.test",username:"provider.demo",mobile:"0500000102",password:"Bunya@123",route:"/merchant"},
  {role:"contractor",label:"حساب المقاول",email:"contractor.demo@bunya.test",username:"contractor.demo",mobile:"0500000103",password:"Bunya@123",route:"/contractor"},
] as const;

export const demoAccounts:readonly DemoAccount[] = [
  {id:"customer-adel",role:"customer",displayName:"عميل بُنية التجريبي",email:"customer.demo@bunya.test",username:"customer.demo",mobile:"0500000101",passwordProof:DEMO_PASSWORD_PROOF,route:"/customer",status:"active"},
  {id:"provider-modern-materials",role:"provider",displayName:"شركة بُنية لمواد البناء",email:"provider.demo@bunya.test",username:"provider.demo",mobile:"0500000102",passwordProof:DEMO_PASSWORD_PROOF,route:"/merchant",status:"approved"},
  {id:"ctr-asas",role:"contractor",displayName:"مؤسسة بُنية للمقاولات",email:"contractor.demo@bunya.test",username:"contractor.demo",mobile:"0500000103",passwordProof:DEMO_PASSWORD_PROOF,route:"/contractor",status:"approved"},
];

type DemoProviderRecord = ProviderApplication & {passwordProof:string};
type DemoContractorRecord = ContractorApplication & {username:string;passwordProof:string;availability:"available"};

function matchesDemo(record:{id?:string;email?:string;username?:string;mobile?:string},account:DemoAccount){
  const targets=[account.email,account.username,account.mobile].map(normalizeValue);
  return record.id===account.id||[record.email,record.username,record.mobile].some(value=>Boolean(value)&&targets.includes(normalizeValue(value??"")));
}

function upsertDemo<T extends {id:string;email:string;username?:string;mobile:string}>(key:string,seed:T){
  const current=readLocalCollection<T>(key);
  const index=current.findIndex(item=>matchesDemo(item,demoAccounts.find(account=>account.id===seed.id)!));
  const next=index<0?[seed,...current]:current.map((item,itemIndex)=>itemIndex===index?{...item,...seed}:item);
  window.localStorage.setItem(key,JSON.stringify(next));
  return index<0;
}

function seedProfiles(){
  if(!localStorage.getItem("bunya-customer-profile"))localStorage.setItem("bunya-customer-profile",JSON.stringify({...customerProfileMock,id:"customer-adel",fullName:"عميل بُنية التجريبي",username:"customer.demo",mobile:"0500000101",email:"customer.demo@bunya.test"}));
  if(!localStorage.getItem("bunya-provider-profile"))localStorage.setItem("bunya-provider-profile",JSON.stringify({...providerProfileMock,id:"provider-modern-materials",companyName:"شركة بُنية لمواد البناء",contactName:"مسؤول حساب المزود التجريبي",mobile:"0500000102",email:"provider.demo@bunya.test",username:"provider.demo",accountStatus:"approved"}));
  if(!localStorage.getItem("bunya-contractor-profile"))localStorage.setItem("bunya-contractor-profile",JSON.stringify({...contractorProfileMock,id:"ctr-asas",displayName:"مؤسسة بُنية للمقاولات",companyName:"مؤسسة بُنية للمقاولات",mobile:"0500000103",email:"contractor.demo@bunya.test",availability:"available",accountStatus:"approved"}));
}

export function bootstrapDemoAccounts(){
  if(process.env.NODE_ENV!=="development")return {created:0,total:0};
  const customer=demoAccounts[0];const provider=demoAccounts[1];const contractor=demoAccounts[2];
  const created=[
    upsertDemo<CustomerRegistration>(localStorageKeys.customers,{id:customer.id,fullName:customer.displayName,mobile:customer.mobile,email:customer.email,username:customer.username,passwordProof:customer.passwordProof,createdAt:SEEDED_AT}),
    upsertDemo<DemoProviderRecord>(localStorageKeys.providers,{id:provider.id,companyName:provider.displayName,contactName:"مسؤول حساب المزود التجريبي",mobile:provider.mobile,email:provider.email,username:provider.username,passwordProof:provider.passwordProof,mapsUrl:providerProfileMock.mapsUrl,latitude:providerProfileMock.latitude,longitude:providerProfileMock.longitude,categories:providerProfileMock.categories,deliveryAvailable:providerProfileMock.deliveryAvailable,deliveryRegions:providerProfileMock.deliveryRegions,status:"approved",createdAt:SEEDED_AT}),
    upsertDemo<DemoContractorRecord>(localStorageKeys.contractors,{id:contractor.id,contractorName:contractor.displayName,mobile:contractor.mobile,email:contractor.email,username:contractor.username,passwordProof:contractor.passwordProof,availability:"available",workRegions:contractorProfileMock.workRegions,specialties:contractorProfileMock.specialties,documents:[],status:"approved",createdAt:SEEDED_AT}),
  ];
  seedProfiles();
  return {created:created.filter(Boolean).length,total:3};
}

export function resetDemoAccounts(){return bootstrapDemoAccounts()}

export function findDemoAccount(role:DemoAccountRole,userId:string){return demoAccounts.find(account=>account.role===role&&account.id===userId)}
