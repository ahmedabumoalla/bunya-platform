import { AnimatedPage } from "@/components/AnimatedPage";
import { AppShell } from "@/components/AppShell";
import { RolePageHeader } from "@/components/RolePageHeader";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { subscriptionPlans } from "@/lib/bunya-subscriptions";

export default function SubscriptionsPage() {
  return (
    <AppShell>
      <AnimatedPage>
        <section className="px-5 py-10">
          <div className="mx-auto max-w-7xl">
            <RolePageHeader
              eyebrow="الاشتراكات"
              title="خطتان واضحتان للتجار والمقاولين"
              description="اشتراكات Mock داخل الواجهة فقط: التاجر يدير عروض السعر، والمقاول يظهر للمستخدمين الباحثين عن خدمات تنفيذ."
            />

            <div className="grid gap-6 lg:grid-cols-2">
              {subscriptionPlans.map((plan) => (
                <SubscriptionCard key={plan.id} plan={plan} />
              ))}
            </div>

            <div className="glass-card mt-8 overflow-x-auto rounded-lg">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-[#f7f2e8] text-[#5a3a1f]">
                  <tr>
                    <th className="p-4 text-right">البند</th>
                    <th className="p-4 text-right">التاجر</th>
                    <th className="p-4 text-right">المقاول</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#5a3a1f]/10">
                    <td className="p-4 font-black">السعر الشهري</td>
                    <td className="p-4">99 ريال</td>
                    <td className="p-4">49 ريال</td>
                  </tr>
                  <tr className="border-b border-[#5a3a1f]/10">
                    <td className="p-4 font-black">الهدف</td>
                    <td className="p-4">استقبال RFQ وإرسال عروض سعر</td>
                    <td className="p-4">الظهور للمستخدمين الباحثين عن مقاول</td>
                  </tr>
                  <tr>
                    <td className="p-4 font-black">الخصوصية</td>
                    <td className="p-4">لا يرى العميل أو المقاول أو عروض المنافسين</td>
                    <td className="p-4">يعرض بياناته للمستخدمين بشكل اختياري</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </AnimatedPage>
    </AppShell>
  );
}
