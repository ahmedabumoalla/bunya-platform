import { AnimatedPage } from "@/components/AnimatedPage";
import { AppShell } from "@/components/AppShell";
import { RolePageHeader } from "@/components/RolePageHeader";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import type { SubscriptionPlan } from "@/lib/bunya-types";
import { loadSubscriptionPlans } from "@/lib/subscriptions/server";

export default async function SubscriptionsPage() {
  let subscriptionPlans: SubscriptionPlan[] = [];
  let dataError = false;
  try {
    subscriptionPlans = await loadSubscriptionPlans();
  } catch {
    dataError = true;
  }
  return (
    <AppShell>
      <AnimatedPage>
        <section className="px-5 py-10">
          <div className="mx-auto max-w-7xl">
            <RolePageHeader
              eyebrow="الاشتراكات"
              title="خطتان واضحتان للتجار والمقاولين"
              description="خطط الاشتراك النشطة المتاحة للمزودين والمقاولين في منصة بُنية."
            />

            {dataError ? <div className="glass-card rounded-lg p-8 text-center" role="alert"><h2 className="text-xl font-black">تعذر الاتصال بقاعدة البيانات</h2><p className="mt-2 text-[var(--muted)]">لا يمكن تحميل خطط الاشتراك حاليا. حاول مرة أخرى لاحقا.</p></div> : subscriptionPlans.length ? <div className="grid gap-6 lg:grid-cols-2">
              {subscriptionPlans.map((plan) => (
                <SubscriptionCard key={plan.id} plan={plan} />
              ))}
            </div> : <div className="glass-card rounded-lg p-8 text-center"><h2 className="text-xl font-black">لا توجد خطط اشتراك متاحة حاليا</h2><p className="mt-2 text-[var(--muted)]">ستظهر الخطط هنا بعد تفعيلها من إدارة المنصة.</p></div>}
          </div>
        </section>
      </AnimatedPage>
    </AppShell>
  );
}
