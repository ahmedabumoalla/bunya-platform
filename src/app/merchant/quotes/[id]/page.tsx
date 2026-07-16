import { ProviderQuoteDetails } from "@/components/provider/ProviderSentQuotes";
export default async function MerchantQuotePage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ProviderQuoteDetails id={id}/>}
