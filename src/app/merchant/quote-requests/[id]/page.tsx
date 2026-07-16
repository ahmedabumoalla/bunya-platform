import { ProviderQuoteRequestDetails } from "@/components/provider/ProviderQuoteRequests";
export default async function MerchantQuoteRequestPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ProviderQuoteRequestDetails id={id} />; }
