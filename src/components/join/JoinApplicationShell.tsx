import type { ReactNode } from "react";
import Link from "next/link";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import styles from "./JoinApplicationShell.module.css";

export function JoinApplicationShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/" className={styles.brand} aria-label="بُنية — الرئيسية"><BunyaLogo priority sizes="144px" /></Link>
      <Link href="/join" className={styles.back}>نوع الطلب <span aria-hidden="true">←</span></Link>
    </header>
    <section className={styles.card} aria-labelledby="application-title">
      <header className={styles.heading}><h1 id="application-title">{title}</h1><p>{description}</p></header>
      {children}
    </section>
  </main>;
}
