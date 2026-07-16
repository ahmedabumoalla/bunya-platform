import {CustomerOrderDetails} from "@/components/customer/CustomerOrderPages";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <CustomerOrderDetails id={id}/>}
