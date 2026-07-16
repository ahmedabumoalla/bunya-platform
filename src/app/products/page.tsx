import { AnimatedPage } from "@/components/AnimatedPage";
import { AppShell } from "@/components/AppShell";
import { QuoteRequestFlow } from "@/components/QuoteRequestFlow";
import { RolePageHeader } from "@/components/RolePageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { productCategories } from "@/lib/bunya-data";

export default function ProductsPage() {
  return (
    <AppShell>
      <AnimatedPage>
        <section className="px-5 py-10">
          <div className="mx-auto max-w-7xl">
            <RolePageHeader
              eyebrow="Marketplace"
              title="سوق مواد بناء جاهز للطلب"
              description="بحث، فلاتر، كروت منتجات 3D، ولوحة طلب عرض سعر تجمع المنتج والكمية والموقع ونافذة التجميع."
            />

            <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
              {["كل الفئات", ...productCategories].map((category) => (
                <span
                  key={category}
                  className="glass-card shrink-0 rounded-lg px-4 py-2 text-sm font-black text-[var(--foreground)]"
                >
                  {category}
                </span>
              ))}
            </div>

            <QuoteRequestFlow />

            <div className="mt-8 glass-card rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-[#b76734]">تسعير المنصة</p>
                  <h2 className="mt-2 text-2xl font-black">القرار بعد تجميع العروض</h2>
                </div>
                <StatusBadge tone="green">الأرخص المؤهل فقط</StatusBadge>
              </div>
              <p className="mt-3 leading-7 text-[var(--muted)]">
                لا تعرض بُنية سعرا مباشرا على المنتج. يبدأ التدفق بطلب عرض سعر،
                ثم تقارن المنصة داخليا وتعيد عرضا نهائيا باسم بُنية.
              </p>
            </div>
          </div>
        </section>
      </AnimatedPage>
    </AppShell>
  );
}
