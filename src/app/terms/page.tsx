import type { Metadata } from "next";
import { publishedPolicy } from "@/lib/policies/server";
import { PublishedPolicyPage } from "@/components/legal/PublishedPolicyPage";
import { LegalPage, LegalSection, legalIdentity } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "شروط الاستخدام | بُنية",
  description: "شروط استخدام منصة وتطبيق بُنية التابع لشركة ضفاف الإبداع التجارية.",
};

export default async function TermsPage() {
  const policy = await publishedPolicy("terms");
  if (policy) return <PublishedPolicyPage policy={policy} />;
  return (
    <LegalPage eyebrow="TERMS OF USE" title="شروط الاستخدام">
      <LegalSection title="1. قبول الشروط">
        <p>باستخدام موقع أو تطبيق بُنية فإنك توافق على هذه الشروط وسياسة الخصوصية. تدير الخدمة {legalIdentity.companyAr}، ويجب أن تكون بيانات الحساب صحيحة ومحدثة.</p>
      </LegalSection>
      <LegalSection title="2. طبيعة الخدمة">
        <p>توفر بُنية أدوات لطلب مواد البناء، جمع عروض الأسعار، إدارة التوريد والتسليم، والوصول إلى موردين ومقاولين. تظهر تفاصيل السعر والنطاق والأطراف قبل اعتماد الطلب، وتصبح الموافقات المسجلة جزءًا من سجل المعاملة.</p>
      </LegalSection>
      <LegalSection title="3. الحسابات والمسؤوليات">
        <ul>
          <li>يتحمل المستخدم مسؤولية حماية بيانات دخوله والإبلاغ عن أي استخدام غير مصرح.</li>
          <li>يلتزم المورد والمقاول بدقة معلوماته وتراخيصه وعروضه وجودة التنفيذ والمواعيد المتفق عليها.</li>
          <li>يلتزم العميل بصحة بيانات الطلب والموقع وتوفير إمكانية الاستلام أو الوصول إلى موقع المشروع.</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. الأسعار والمدفوعات">
        <p>تظهر الأسعار والضرائب ورسوم التوصيل أو الخدمة قبل التأكيد. تعالج المدفوعات الإلكترونية بواسطة مقدم دفع معتمد، وقد تخضع عمليات الاسترداد أو الإلغاء لحالة الطلب والتكاليف المنفذة والأنظمة المطبقة.</p>
      </LegalSection>
      <LegalSection title="5. الاستخدام المقبول">
        <p>يحظر إساءة استخدام المنصة، التحايل على الصلاحيات، نشر بيانات مضللة، انتهاك حقوق الآخرين، أو محاولة تعطيل الخدمة أو الوصول إلى بيانات غير مصرح بها.</p>
      </LegalSection>
      <LegalSection title="6. التعليق والإنهاء">
        <p>يجوز تقييد الحساب أو تعليقه عند وجود احتيال أو مخالفة أو خطر أمني، مع مراعاة الطلبات والحقوق القائمة. يستطيع المستخدم طلب حذف حسابه وفق مسار الحذف المنشور.</p>
      </LegalSection>
      <LegalSection title="7. الدعم والنظام المطبق">
        <p>تخضع الخدمة للأنظمة السارية في المملكة العربية السعودية. للدعم أو الاعتراض تواصل عبر <a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a>.</p>
      </LegalSection>
    </LegalPage>
  );
}
