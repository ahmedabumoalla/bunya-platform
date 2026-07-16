import { ProviderOrderDetails } from "@/components/provider/ProviderOrders";
export default async function MerchantOrderPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ProviderOrderDetails id={id}/>}
