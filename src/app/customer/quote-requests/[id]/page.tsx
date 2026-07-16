import {CustomerQuoteRequestDetails} from "@/components/customer/CustomerQuotePages";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <CustomerQuoteRequestDetails id={id}/>}
