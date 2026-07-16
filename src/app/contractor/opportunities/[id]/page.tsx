import {ContractorOpportunityCycleDetails} from "@/components/contractor/ContractorProjectComments";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ContractorOpportunityCycleDetails id={id}/>}
