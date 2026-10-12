import type { Metadata } from "next";
import Link from "next/link";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import { Icon } from "@/components/home/HomeStorefrontUi";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "طلب انضمام | بُنية" };

export default function JoinPage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="بُنية — الرئيسية"><BunyaLogo priority sizes="144px" /></Link>
      <Link href="/" className={styles.back}>الرئيسية <span aria-hidden="true">←</span></Link>
    </header>
    <section className={styles.content} aria-labelledby="join-title">
      <h1 id="join-title">طلب انضمام</h1>
      <p>اختر نوع نشاطك للمتابعة.</p>
      <div className={styles.choices}>
        <Link href="/contractors/join" className={styles.choice} aria-label="طلب انضمام كمقاول">
          <span className={styles.icon}><Icon name="helmet" /></span>
          <span className={styles.copy}><strong>مقاول</strong><span>تنفيذ أعمال ومشاريع البناء</span></span>
          <span className={styles.arrow} aria-hidden="true">←</span>
        </Link>
        <Link href="/providers/join" className={styles.choice} aria-label="طلب انضمام كمورد">
          <span className={styles.icon}><Icon name="box" /></span>
          <span className={styles.copy}><strong>مورد</strong><span>توريد مواد ومنتجات البناء</span></span>
          <span className={styles.arrow} aria-hidden="true">←</span>
        </Link>
      </div>
    </section>
  </main>;
}
