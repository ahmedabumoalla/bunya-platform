import type {ContractorApplication,CustomerRegistration,ProviderApplication} from "./bunya-types";
import {contractorProfileMock} from "./contractor-data";
import {customerProfileMock} from "./customer-data";
import {createPasswordProof,localStorageKeys,normalizeValue,readLocalCollection} from "./bunya-local";
import {demoAccountCredentials,demoPasswordProof,demoSeedVersion,demoSeedVersionKey} from "./demo-account-definitions";
import type {DemoAccountCredential,DemoAccountRole} from "./demo-account-definitions";
import {providerProfileMock} from "./provider-data";

export {demoAccountCredentials,demoSeedVersion};

const SEEDED_AT = "2026-07-16T00:00:00.000Z";
const demoIds = new Set(demoAccountCredentials.map(account=>account.id));

type DemoProviderRecord = ProviderApplication & {passwordProof:string};
type DemoContractorRecord = ContractorApplication & {username:string;passwordProof:string;availability:"available"};
type DemoRecord = CustomerRegistration|DemoProviderRecord|DemoContractorRecord;
type UpsertState = "created"|"repaired"|"ready";
export type DemoBootstrapResult={created:number;repaired:number;total:number;ready:boolean;version:string};

function matchesDemo(record:{id?:string;email?:string;username?:string;mobile?:string},account:DemoAccountCredential){
  const targets=[account.email,account.username,account.mobile].map(normalizeValue);
  return record.id===account.id||[record.email,record.username,record.mobile].some(value=>Boolean(value)&&targets.includes(normalizeValue(value??"")));
}

function upsertDemo<T extends {id:string;email:string;username?:string;mobile:string}>(key:string,seed:T,account:DemoAccountCredential):UpsertState{
  const current=readLocalCollection<T>(key);
  const matches=current.filter(item=>matchesDemo(item,account));
  const existing=matches[0];
  const canonical={...existing,...seed};
  const untouched=current.filter(item=>!matchesDemo(item,account));
  const next=[canonical,...untouched];
  const state:UpsertState=!existing?"created":matches.length!==1||JSON.stringify(existing)!==JSON.stringify(canonical)?"repaired":"ready";
  if(state!=="ready")window.localStorage.setItem(key,JSON.stringify(next));
  return state;
}

function seedProfiles(){
  if(!localStorage.getItem("bunya-customer-profile"))localStorage.setItem("bunya-customer-profile",JSON.stringify({...customerProfileMock,id:"customer-adel",fullName:"عميل بُنية التجريبي",username:"customer.demo",mobile:"0500000101",email:"customer.demo@bunya.test"}));
  if(!localStorage.getItem("bunya-provider-profile"))localStorage.setItem("bunya-provider-profile",JSON.stringify({...providerProfileMock,id:"provider-modern-materials",companyName:"شركة بُنية لمواد البناء",contactName:"مسؤول حساب المزود التجريبي",mobile:"0500000102",email:"provider.demo@bunya.test",username:"provider.demo",accountStatus:"approved"}));
  if(!localStorage.getItem("bunya-contractor-profile"))localStorage.setItem("bunya-contractor-profile",JSON.stringify({...contractorProfileMock,id:"ctr-asas",displayName:"مؤسسة بُنية للمقاولات",companyName:"مؤسسة بُنية للمقاولات",mobile:"0500000103",email:"contractor.demo@bunya.test",availability:"available",accountStatus:"approved"}));
}

export async function bootstrapDemoAccounts():Promise<DemoBootstrapResult>{
  if(process.env.NODE_ENV!=="development")return {created:0,repaired:0,total:0,ready:false,version:demoSeedVersion};
  const passwordProof=await createPasswordProof(demoAccountCredentials[0].password);
  if(passwordProof!==demoPasswordProof)throw new Error("DEMO_PASSWORD_PROOF_MISMATCH");
  const customer=demoAccountCredentials[0];const provider=demoAccountCredentials[1];const contractor=demoAccountCredentials[2];
  const states=[
    upsertDemo<CustomerRegistration>(localStorageKeys.customers,{id:customer.id,fullName:customer.displayName,mobile:customer.mobile,email:customer.email,username:customer.username,passwordProof,createdAt:SEEDED_AT},customer),
    upsertDemo<DemoProviderRecord>(localStorageKeys.providers,{id:provider.id,companyName:provider.displayName,contactName:"مسؤول حساب المزود التجريبي",mobile:provider.mobile,email:provider.email,username:provider.username,passwordProof,mapsUrl:providerProfileMock.mapsUrl,latitude:providerProfileMock.latitude,longitude:providerProfileMock.longitude,categories:providerProfileMock.categories,deliveryAvailable:providerProfileMock.deliveryAvailable,deliveryRegions:providerProfileMock.deliveryRegions,status:"approved",createdAt:SEEDED_AT},provider),
    upsertDemo<DemoContractorRecord>(localStorageKeys.contractors,{id:contractor.id,contractorName:contractor.displayName,mobile:contractor.mobile,email:contractor.email,username:contractor.username,passwordProof,availability:"available",workRegions:contractorProfileMock.workRegions,specialties:contractorProfileMock.specialties,documents:[],status:"approved",createdAt:SEEDED_AT},contractor),
  ];
  seedProfiles();
  localStorage.setItem(demoSeedVersionKey,demoSeedVersion);
  return {created:states.filter(state=>state==="created").length,repaired:states.filter(state=>state==="repaired").length,total:3,ready:true,version:demoSeedVersion};
}

function collectionFor(role:DemoAccountRole):DemoRecord[]{
  if(role==="customer")return readLocalCollection<CustomerRegistration>(localStorageKeys.customers);
  if(role==="provider")return readLocalCollection<DemoProviderRecord>(localStorageKeys.providers);
  return readLocalCollection<DemoContractorRecord>(localStorageKeys.contractors);
}

export async function ensureDemoAccount(role:DemoAccountRole){
  const result=await bootstrapDemoAccounts();
  const account=demoAccountCredentials.find(item=>item.role===role);
  if(!result.ready||!account)return null;
  const record=collectionFor(role).find(item=>matchesDemo(item,account));
  if(!record||record.passwordProof!==demoPasswordProof)return null;
  return account;
}

export async function resetDemoAccounts(){
  const result=await bootstrapDemoAccounts();
  const raw=localStorage.getItem("bunya-local-session");
  if(raw){
    try{
      const session=JSON.parse(raw) as {userId?:string};
      if(session.userId&&demoIds.has(session.userId as (typeof demoAccountCredentials)[number]["id"]))localStorage.removeItem("bunya-local-session");
    }catch{localStorage.removeItem("bunya-local-session")}
  }
  return result;
}

