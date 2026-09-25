import type { Metadata } from "next";
import { publishedPolicy } from "@/lib/policies/server";
import { PublishedPolicyPage } from "@/components/legal/PublishedPolicyPage";
import { LegalPage, LegalSection, legalIdentity } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "سياسة الخصوصية | بُنية",
  description: "سياسة خصوصية منصة وتطبيق بُنية التابع لشركة ضفاف الإبداع التجارية.",
};

export default async function PrivacyPage() {
  const policy = await publishedPolicy("privacy");
  if (policy) return <PublishedPolicyPage policy={policy} />;
  return (
    <LegalPage eyebrow="PRIVACY POLICY" title="سياسة الخصوصية">
      <LegalSection title="1. من نحن">
        <p>بُنية منصة رقمية تديرها {legalIdentity.companyAr}. تنطبق هذه السياسة على موقع buniahksa.com وتطبيق بُنية وخدمات العملاء والموردين والمقاولين والسائقين المرتبطة بهما.</p>
      </LegalSection>
      <LegalSection title="2. البيانات التي نعالجها">
        <ul>
          <li>بيانات الحساب والهوية المهنية، مثل الاسم والبريد ورقم الجوال ونوع المستخدم.</li>
          <li>بيانات الطلبات وعروض الأسعار والمشاريع والعناوين وروابط المواقع ومعلومات التسليم.</li>
          <li>بيانات المورد أو المقاول اللازمة للتحقق وإدارة الخدمات والوثائق.</li>
          <li>سجلات الدفع والفواتير وحالة العملية؛ ولا نخزن بيانات البطاقة الكاملة.</li>
          <li>بيانات الجهاز والإشعارات والسجلات الفنية اللازمة للأمان وتشخيص الأعطال.</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. لماذا نستخدم البيانات">
        <p>نستخدم البيانات لإنشاء الحساب، تنفيذ الطلبات والمدفوعات والتسليم، مطابقة العملاء بمقدمي الخدمة، إرسال الإشعارات، منع الاحتيال، دعم المستخدم، وتحسين موثوقية الخدمة والامتثال للالتزامات النظامية.</p>
      </LegalSection>
      <LegalSection title="4. المشاركة ومقدمو الخدمة">
        <p>نشارك القدر اللازم فقط مع الأطراف المشاركة في تنفيذ الطلب ومع مزودي البنية التقنية والدفع والبريد والرسائل والإشعارات. لا نبيع البيانات الشخصية، ولا نسمح لمقدم الخدمة باستخدامها لغرض مستقل عن تشغيل بُنية.</p>
      </LegalSection>
      <LegalSection title="5. الحفظ والحماية">
        <p>نحفظ البيانات للمدة اللازمة لتقديم الخدمة والوفاء بالمتطلبات المحاسبية والتنظيمية وتسوية النزاعات. نطبق ضوابط وصول وتشفير وسجلات تدقيق مناسبة، مع الإقرار بأنه لا توجد وسيلة إلكترونية خالية تمامًا من المخاطر.</p>
      </LegalSection>
      <LegalSection title="6. حقوقك وحذف الحساب">
        <p>يمكنك طلب الوصول أو التصحيح أو حذف الحساب والبيانات من صفحة <a href="/account-deletion">حذف الحساب والبيانات</a>. قد نحتفظ بسجلات محدودة عندما يوجب النظام ذلك أو لحماية الحقوق ومنع الاحتيال، وسنوضح ذلك عند معالجة الطلب.</p>
      </LegalSection>
      <LegalSection title="7. التواصل">
        <p>للاستفسارات المتعلقة بالخصوصية: <a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a>.</p>
      </LegalSection>
    </LegalPage>
  );
}
