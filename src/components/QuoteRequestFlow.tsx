"use client";

import { FormEvent, useMemo, useState } from "react";
import { productCategories, products } from "@/lib/bunya-data";
import { defaultMockQuoteWindow, getQuoteWindow } from "@/lib/bunya-order";
import type { ProductCategory } from "@/lib/bunya-types";
import { ProductCard } from "./ProductCard";
import { ProductFilters } from "./ProductFilters";
import { StatusBadge } from "./StatusBadge";

type RequestStatus = {
  requestCode: string;
  productName: string;
  quantity: string;
  unit: string;
  location: string;
  quoteDuration: string;
  quoteLabel: string;
  quoteDescription: string;
};

export function QuoteRequestFlow() {
  const [selectedProductId, setSelectedProductId] = useState(products[0].id);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ProductCategory | "الكل">("الكل");
  const [quantity, setQuantity] = useState("420");
  const [location, setLocation] = useState("حي النرجس، الرياض");
  const [capturedLocation, setCapturedLocation] = useState(false);
  const [status, setStatus] = useState<RequestStatus | null>(null);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesQuery =
        product.name.includes(query) ||
        product.description.includes(query) ||
        product.category.includes(query);
      const matchesCategory = category === "الكل" || product.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, query]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? products[0],
    [selectedProductId],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quoteWindow = getQuoteWindow(new Date().getHours());

    setStatus({
      requestCode: "BUN-MOCK-3021",
      productName: selectedProduct.name,
      quantity,
      unit: selectedProduct.unit,
      location,
      quoteDuration: quoteWindow.duration,
      quoteLabel: quoteWindow.label,
      quoteDescription: quoteWindow.description,
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div>
        <ProductFilters
          query={query}
          category={category}
          categories={productCategories}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
        />

        <div className="mb-5 glass-card rounded-lg p-4 text-[#214536]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-black">السعر لا يظهر مباشرة</p>
            <StatusBadge tone="green">تجميع عروض</StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-7">
            بُنية تجمع عروض التجار ثم تعتمد الأرخص المؤهل، وبعدها يظهر للعميل عرض
            نهائي باسم المنصة فقط.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onRequest={(productId) => {
                setSelectedProductId(productId);
                document.getElementById("quote-panel")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          ))}
        </div>
      </div>

      <aside
        id="quote-panel"
        className="glass-card-strong h-fit rounded-lg p-6 shadow-sm xl:sticky xl:top-28"
      >
        <p className="text-sm font-black text-[#b76734]">لوحة طلب عرض السعر</p>
        <h2 className="mt-2 text-2xl font-black">طلب توريد مباشر</h2>
        <ol className="mt-4 grid gap-2 text-sm font-bold text-[#5a3a1f]">
          {["اختيار المنتج", "تحديد الكمية والموقع", "تجميع عروض التجار", "عرض نهائي باسم بُنية"].map(
            (step, index) => (
              <li key={step} className="rounded-lg bg-[#f7f2e8]/80 px-3 py-2">
                {index + 1}. {step}
              </li>
            ),
          )}
        </ol>

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">المنتج</span>
            <select
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-bold text-[var(--muted)]">الكمية</span>
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]"
                inputMode="numeric"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-bold text-[var(--muted)]">الوحدة</span>
              <input
                value={selectedProduct.unit}
                readOnly
                className="rounded-lg border border-[#5a3a1f]/20 bg-[#f7f2e8]/80 px-4 py-3 font-bold text-[#5a3a1f]"
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">الموقع</span>
            <textarea
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              rows={3}
              className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]"
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setCapturedLocation(true);
              setLocation("موقع Mock: حي النرجس، الرياض - 24.8467, 46.6891");
            }}
            className="premium-button rounded-lg border border-[#214536]/25 bg-[#dce8d7]/90 px-4 py-3 text-sm font-black text-[#214536] transition hover:bg-[#cfe0ca]"
          >
            التقاط الموقع الحالي Mock
          </button>

          <div className="rounded-lg bg-[#f7f2e8]/80 p-4">
            <p className="text-sm font-black text-[#5a3a1f]">نافذة الوقت المتوقعة</p>
            <p className="mt-2 text-sm leading-7 text-[#766b5d]">
              {defaultMockQuoteWindow.label}، مدة التجميع {defaultMockQuoteWindow.duration}.
            </p>
          </div>

          <button
            type="submit"
            className="premium-button rounded-lg bg-[#b76734] px-5 py-3 text-sm font-black text-white transition hover:bg-[#965227]"
          >
            إرسال الطلب للتجار المؤهلين
          </button>
        </form>

        {status ? (
          <section className="mt-6 rounded-lg border border-[#214536]/20 bg-[#dce8d7]/90 p-5 text-[#214536]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-black">تم إرسال الطلب</p>
              <StatusBadge tone="green">Cinematic status</StatusBadge>
            </div>
            <h3 className="mt-2 text-2xl font-black">{status.requestCode}</h3>
            <div className="progress-bar mt-4 h-2 rounded-full bg-[#214536]" />
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="font-bold opacity-75">المنتج والكمية</dt>
                <dd className="mt-1 font-black">
                  {status.productName} | {status.quantity} {status.unit}
                </dd>
              </div>
              <div>
                <dt className="font-bold opacity-75">الموقع</dt>
                <dd className="mt-1 font-black">{status.location}</dd>
              </div>
              <div>
                <dt className="font-bold opacity-75">حالة التجميع</dt>
                <dd className="mt-1 font-black">
                  {status.quoteLabel} | {status.quoteDuration}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-7">{status.quoteDescription}</p>
          </section>
        ) : capturedLocation ? (
          <p className="mt-4 rounded-lg bg-[#f7f2e8]/80 p-3 text-sm font-bold text-[#5a3a1f]">
            تم التقاط موقع Mock بنجاح. أرسل الطلب لبدء تجميع العروض.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
