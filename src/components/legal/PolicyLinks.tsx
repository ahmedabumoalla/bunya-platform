import Link from "next/link";
import type { PolicyAudience } from "@/lib/policies/registry";
import styles from "./PolicyLinks.module.css";

export function PolicyLinks({ audience, payment = false }: { audience?: PolicyAudience; payment?: boolean }) {
  return <nav className={styles.links} aria-label="الشروط والسياسات">
    <Link href="/terms" target="_blank" rel="noreferrer">شروط الاستخدام</Link>
    <Link href="/privacy" target="_blank" rel="noreferrer">الخصوصية</Link>
    <Link href={audience ? `/policies?audience=${audience}` : "/policies"} target="_blank" rel="noreferrer">السياسات المرتبطة</Link>
    {payment && <><Link href="/policies#payments" target="_blank" rel="noreferrer">سياسة الدفع</Link><Link href="/policies#returns" target="_blank" rel="noreferrer">الإلغاء والاسترجاع</Link></>}
  </nav>;
}
