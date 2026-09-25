import type { Metadata } from "next";
import { LegalPage, LegalSection, legalIdentity } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "حذف الحساب والبيانات | بُنية",
  description: "المسار الرسمي لطلب حذف حساب بُنية والبيانات المرتبطة به.",
};

const deletionSubject = encodeURIComponent("طلب حذف حساب بُنية والبيانات المرتبطة به");

export default function AccountDeletionPage() {
  return (
    <LegalPage eyebrow="ACCOUNT & DATA DELETION" title="حذف الحساب والبيانات">
      <LegalSection title="اطلب حذف حسابك">
        <p>أرسل الطلب من البريد المرتبط بحسابك إلى <a href={`mailto:${legalIdentity.email}?subject=${deletionSubject}`}>{legalIdentity.email}</a>، واكتب رقم الجوال المرتبط بالحساب ونوع الحساب فقط. لا ترسل كلمة المرور أو رمز التحقق أو بيانات البطاقة.</p>
      </LegalSection>
      <LegalSection title="ماذا يحدث بعد الطلب؟">
        <ol>
          <li>نؤكد استلام الطلب ونتحقق من ملكية الحساب بطريقة آمنة.</li>
          <li>نوقف الوصول إلى الحساب ونعالج حذف البيانات المرتبطة به من الأنظمة التشغيلية ومقدمي الخدمة المعنيين.</li>
          <li>نرسل تأكيدًا بعد الإكمال، أو نوضح أي بيانات يجب الاحتفاظ بها مؤقتًا لالتزام محاسبي أو نظامي أو لحماية الحقوق ومنع الاحتيال.</li>
        </ol>
      </LegalSection>
      <LegalSection title="البيانات المشمولة">
        <p>يشمل الطلب بيانات الملف الشخصي ووسائل الاتصال والعناوين والمحتوى المرتبط بالحساب حيثما لا يوجد موجب مشروع للاحتفاظ به. قد تبقى سجلات مالية أو تعاقدية محدودة للمدة التي تفرضها الأنظمة، ثم تزال أو تُخفى هويتها عند انتهاء الحاجة.</p>
      </LegalSection>
    </LegalPage>
  );
}
