"use client";

import { FormEvent, useState } from "react";
import { anonymousQuoteRequests, sentMerchantQuotes } from "@/lib/bunya-order";
import { StatusBadge } from "./StatusBadge";

export function MerchantQuoteWorkbench() {
  const [activeRequestId, setActiveRequestId] = useState(anonymousQuoteRequests[0].id);
  const [price, setPrice] = useState("7224");
  const [delivery, setDelivery] = useState("5 ساعات");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const activeRequest =
    anonymousQuoteRequests.find((request) => request.id === activeRequestId) ??
    anonymousQuoteRequests[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
      <div className="grid gap-4">
        {anonymousQuoteRequests.map((request) => (
          <article
            key={request.id}
            className={`rounded-lg border p-6 transition ${
              activeRequestId === request.id
                ? "border-[#214536]/30 bg-[#dce8d7]"
                : "border-[#5a3a1f]/15 bg-[#fffaf1]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#b76734]">{request.id}</p>
                <h3 className="mt-2 text-2xl font-black">{request.product}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveRequestId(request.id);
                  setSubmitted(false);
                }}
                className="rounded-lg bg-[#214536] px-4 py-2 text-sm font-black text-white"
              >
                تسعير الطلب
              </button>
            </div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-[#fffaf1] p-4">
                <dt className="text-sm font-bold text-[#766b5d]">الكمية</dt>
                <dd className="mt-1 font-black">
                  {request.quantity} {request.unit}
                </dd>
              </div>
              <div className="rounded-lg bg-[#fffaf1] p-4">
                <dt className="text-sm font-bold text-[#766b5d]">نطاق الموقع</dt>
                <dd className="mt-1 font-black">{request.locationHint}</dd>
              </div>
              <div className="rounded-lg bg-[#fffaf1] p-4">
                <dt className="text-sm font-bold text-[#766b5d]">المهلة</dt>
                <dd className="mt-1 font-black">{request.deadline}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm font-bold text-[#5a3a1f]">
              الطلب مجهول الهوية: لا يظهر اسم العميل أو المقاول، ولا تظهر عروض
              التجار المنافسين.
            </p>
          </article>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="h-fit rounded-lg border border-[#5a3a1f]/15 bg-[#fffaf1] p-6 shadow-sm lg:sticky lg:top-28"
      >
        <p className="text-sm font-black text-[#b76734]">إرسال عرض سعر</p>
        <h2 className="mt-2 text-2xl font-black">{activeRequest.product}</h2>
        <p className="mt-3 leading-7 text-[#766b5d]">
          ترسل العرض إلى بُنية فقط. المنصة تقارن داخليا وتعتمد الأرخص المؤهل.
        </p>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-[#766b5d]">السعر الإجمالي</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              className="rounded-lg border border-[#5a3a1f]/20 bg-white px-4 py-3 font-bold outline-none focus:border-[#214536]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-[#766b5d]">مدة التوصيل</span>
            <input
              value={delivery}
              onChange={(event) => setDelivery(event.target.value)}
              className="rounded-lg border border-[#5a3a1f]/20 bg-white px-4 py-3 font-bold outline-none focus:border-[#214536]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-[#766b5d]">ملاحظات اختيارية</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="rounded-lg border border-[#5a3a1f]/20 bg-white px-4 py-3 font-bold outline-none focus:border-[#214536]"
              placeholder="مثال: يشمل التحميل والتوصيل"
            />
          </label>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f2e8] p-4">
            <span className="text-sm font-bold text-[#766b5d]">حالة العرض</span>
            <StatusBadge tone={submitted ? "green" : "sand"}>
              {submitted ? "تم الإرسال Mock" : "مسودة"}
            </StatusBadge>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#b76734] px-5 py-3 text-sm font-black text-white transition hover:bg-[#965227]"
          >
            إرسال العرض إلى بُنية
          </button>
        </div>

        {submitted ? (
          <div className="mt-6 rounded-lg bg-[#dce8d7] p-4 text-[#214536]">
            <p className="font-black">تم تسجيل العرض Mock</p>
            <p className="mt-2 text-sm leading-7">
              السعر {price} ريال، مدة التوصيل {delivery}
              {notes ? `، ملاحظات: ${notes}` : ""}.
            </p>
          </div>
        ) : null}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[#f7f2e8] text-[#5a3a1f]">
              <tr>
                <th className="p-3 text-right">طلب</th>
                <th className="p-3 text-right">منتج</th>
                <th className="p-3 text-right">السعر</th>
                <th className="p-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {sentMerchantQuotes.map((quote) => (
                <tr key={quote.id} className="border-b border-[#5a3a1f]/10">
                  <td className="p-3 font-bold">{quote.requestCode}</td>
                  <td className="p-3">{quote.product}</td>
                  <td className="p-3">{quote.price.toLocaleString("ar-SA")} ريال</td>
                  <td className="p-3">{quote.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
