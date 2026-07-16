import type { QuoteRequest } from "@/lib/bunya-types";
import { StatusBadge } from "./StatusBadge";

const statusLabels: Record<QuoteRequest["status"], string> = {
  draft: "مسودة",
  collecting_quotes: "تجميع عروض",
  final_offer_ready: "عرض نهائي جاهز",
  paid: "مدفوع",
  preparing: "قيد التجهيز",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

type OrderStatusCardProps = {
  request: QuoteRequest;
  showHandshake?: boolean;
  compact?: boolean;
};

export function OrderStatusCard({
  request,
  showHandshake = false,
  compact = false,
}: OrderStatusCardProps) {
  return (
    <article className="glass-card motion-card rounded-lg border border-[#5a3a1f]/15 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#b76734]">طلب رقم {request.id}</p>
          <h3 className="mt-2 text-xl font-black">{request.productName}</h3>
        </div>
        <StatusBadge tone={request.status === "delivered" ? "green" : "clay"}>
          {statusLabels[request.status]}
        </StatusBadge>
      </div>
      <dl className={`mt-5 grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        <div className="rounded-lg bg-[#f7f2e8] p-4">
          <dt className="text-sm font-bold text-[#766b5d]">الكمية</dt>
          <dd className="mt-1 font-black">
            {request.quantity.toLocaleString("ar-SA")} {request.unit}
          </dd>
        </div>
        <div className="rounded-lg bg-[#f7f2e8] p-4">
          <dt className="text-sm font-bold text-[#766b5d]">الموقع</dt>
          <dd className="mt-1 font-black">{request.locationHint}</dd>
        </div>
        <div className="rounded-lg bg-[#f7f2e8] p-4">
          <dt className="text-sm font-bold text-[#766b5d]">السداد</dt>
          <dd className="mt-1 font-black">{request.paymentStatus}</dd>
        </div>
        <div className="rounded-lg bg-[#f7f2e8] p-4">
          <dt className="text-sm font-bold text-[#766b5d]">التوصيل</dt>
          <dd className="mt-1 font-black">{request.deliveryPromise}</dd>
        </div>
      </dl>
      {showHandshake ? (
        <div className="mt-4 rounded-lg border border-[#214536]/20 bg-[#dce8d7] p-4 text-[#214536]">
          <p className="text-sm font-black">كود المصافحة الرقمية</p>
          <p className="mt-1 text-3xl font-black tracking-[0.2em]">
            {request.handshakeCode}
          </p>
        </div>
      ) : null}
    </article>
  );
}
