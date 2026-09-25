import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { policyForAudience, policyParagraphs, type PolicyAudience } from "@/lib/policies/registry";

export const metadata = { title: "السياسات | بُنية" };
export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const { audience } = await searchParams;
  const db = await createClient();
  const { data, error } = await db.from("platform_policies").select("id,policy_key,title,summary,body,version,published_at").eq("is_published", true).order("published_at", { ascending: false });
  const validAudience = ["customer", "provider", "contractor", "driver"].includes(audience ?? "") ? audience as PolicyAudience : null;
  const rows = (data ?? []).filter(row => !validAudience || policyForAudience(row.policy_key, validAudience));
  return <LegalPage eyebrow="سياسات بُنية" title="السياسات وشروط الخدمة">
    <LegalSection title="الوثائق الأساسية"><p><Link href="/terms">شروط الاستخدام</Link> · <Link href="/privacy">سياسة الخصوصية</Link> · <Link href="/account-deletion">حذف الحساب والبيانات</Link></p></LegalSection>
    {error ? <LegalSection title="تعذر تحميل السياسات"><p>حاول تحديث الصفحة. تبقى الوثائق الأساسية متاحة من الروابط أعلاه.</p></LegalSection> : rows.length ? rows.map(row => <div id={row.policy_key} key={row.id}><LegalSection title={row.title}><p>{row.summary}</p><small>الإصدار {row.version}</small>{policyParagraphs(row.body).map((paragraph, index) => <p key={index} style={{ whiteSpace: "pre-line" }}>{paragraph}</p>)}</LegalSection></div>) : <LegalSection title="السياسات المتاحة"><p>يمكنك مراجعة الوثائق الأساسية أعلاه. ستظهر هنا السياسات الإضافية فور نشرها من الإدارة.</p></LegalSection>}
  </LegalPage>;
}
