import { finalOffer, sampleRequest } from "@/lib/bunya-order";
import { StatusBadge } from "./StatusBadge";

type FinalOfferCardProps = {
  audience: "customer" | "contractor";
  showHandshakeCode?: boolean;
};

export function FinalOfferCard({
  audience,
  showHandshakeCode = false,
}: FinalOfferCardProps) {
  return (
    <article className="rounded-lg border border-[#214536]/20 bg-[#dce8d7] p-6 text-[#214536] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">العرض النهائي باسم منصة بُنية فقط</p>
          <h2 className="mt-3 text-4xl font-black">
            {finalOffer.totalPrice.toLocaleString("ar-SA")} ريال
          </h2>
        </div>
        <StatusBadge tone="green">
          {finalOffer.offerStatus === "paid" ? "مدفوع" : "جاهز للاعتماد"}
        </StatusBadge>
      </div>

      <p className="mt-4 leading-8">
        يرى {audience === "customer" ? "المستخدم" : "المقاول"} هذا العرض فقط.
        لا يظهر اسم التاجر، ولا تظهر عروض التجار الآخرين أو تفاصيل المقارنة.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <p className="rounded-lg bg-[#fffaf1] p-4 font-black">
          المنتج: {sampleRequest.productName}
        </p>
        <p className="rounded-lg bg-[#fffaf1] p-4 font-black">
          الكمية: {sampleRequest.quantity.toLocaleString("ar-SA")} {sampleRequest.unit}
        </p>
        <p className="rounded-lg bg-[#fffaf1] p-4 font-black">
          مدة التوصيل: {finalOffer.deliveryDuration}
        </p>
        <p className="rounded-lg bg-[#fffaf1] p-4 font-black">
          حالة الدفع: {finalOffer.paymentStatus}
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {["اعتماد العرض", "دفع Mock", "إشعار التاجر بالسداد"].map((step) => (
          <p key={step} className="rounded-lg bg-[#214536] px-4 py-3 text-sm font-black text-white">
            {step}
          </p>
        ))}
      </div>

      {showHandshakeCode ? (
        <div className="mt-6 rounded-lg border border-[#214536]/20 bg-[#fffaf1] p-5">
          <p className="text-sm font-black">كود المصافحة الرقمية للعميل</p>
          <p className="mt-2 text-5xl font-black tracking-[0.2em]">
            {sampleRequest.handshakeCode}
          </p>
          <p className="mt-3 text-sm leading-7">
            يعطي العميل هذا الكود للسائق عند الاستلام لتأكيد تسليم البضاعة.
          </p>
        </div>
      ) : null}
    </article>
  );
}
