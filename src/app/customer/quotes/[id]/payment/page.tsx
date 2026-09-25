import { notFound, redirect } from "next/navigation";
import { PaymobCheckout } from "@/components/payments/PaymobCheckout";
import { requirePortalRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export default async function QuotePaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returned?: string }>;
}) {
  const identity = await requirePortalRole("customer");
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const quote = await supabase.from("bunya_customer_quotes").select("id,quote_code,total,status,customer_request_id").eq("id", id).maybeSingle();
  if (quote.error || !quote.data) notFound();
  const ownedRequest = await supabase.from("quote_requests").select("id").eq("id", quote.data.customer_request_id).eq("requester_id", identity.userId).maybeSingle();
  if (!ownedRequest.data) notFound();
  const order = await supabase.from("orders").select("id,order_code,total,payment_status,invoices(id,status,payment_records(id,status,amount,created_at))").eq("customer_quote_id", id).eq("customer_profile_id", identity.userId).maybeSingle();
  const invoice = order.data?.invoices as unknown as { status: string; payment_records: Array<{ id: string; status: string; amount: number; created_at: string }> } | null;
  const payment = invoice?.payment_records?.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!order.data || !payment) {
    redirect(`/customer/quotes/${id}`);
  }
  return <PaymobCheckout quoteId={id} quoteCode={quote.data.quote_code} orderCode={order.data.order_code} total={Number(order.data.total)} paymentStatus={String(payment.status || order.data.payment_status || "pending")} returned={query.returned === "1"} />;
}
