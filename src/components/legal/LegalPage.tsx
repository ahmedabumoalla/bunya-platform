import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./LegalPage.module.css";

type LegalPageProps = { title: string; eyebrow: string; children: ReactNode };

export const legalIdentity = {
  brandAr: "بُنية",
  brandEn: "Bunya",
  companyAr: "شركة ضفاف الإبداع التجارية",
  companyEn: "Dafaf Alebda Trading Company LLC",
  unifiedNumber: "7041070603",
  email: "support@buniahksa.com",
} as const;

export function LegalPage({ title, eyebrow, children }: LegalPageProps) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/">العودة إلى بُنية ←</Link>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.updated}>آخر تحديث: 2 سبتمبر 2026</p>
          <div className={styles.identity}>
            <strong>{legalIdentity.brandAr} — علامة ومنصة تديرها {legalIdentity.companyAr}</strong>
            <span dir="ltr">{legalIdentity.brandEn} is operated by {legalIdentity.companyEn}</span>
            <span>الرقم الوطني الموحد: {legalIdentity.unifiedNumber}</span>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section}><h2>{title}</h2>{children}</section>;
}

export function PublicLegalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <div>
          <h2>بُنية</h2>
          <p>منصة بُنية مملوكة ومدارة قانونيًا بواسطة شركة ضفاف الإبداع التجارية، شركة سعودية ذات مسؤولية محدودة.</p>
          <p dir="ltr">Bunya is operated by Dafaf Alebda Trading Company LLC · Unified Number {legalIdentity.unifiedNumber}</p>
        </div>
        <nav className={styles.footerNav} aria-label="الروابط القانونية">
          <Link href="/privacy">سياسة الخصوصية</Link>
          <Link href="/terms">شروط الاستخدام</Link>
          <Link href="/account-deletion">حذف الحساب والبيانات</Link>
          <a href={`mailto:${legalIdentity.email}`}>الدعم</a>
        </nav>
      </div>
      <small className={styles.copyright}>© 2026 {legalIdentity.companyAr}. جميع الحقوق محفوظة.</small>
    </footer>
  );
}
