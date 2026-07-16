import {ContractorProposalDetails} from "@/components/contractor/ContractorProposalProjectPages";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ContractorProposalDetails id={id}/>}
