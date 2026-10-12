import type { ReactNode } from "react";
import Link from "next/link";
import { BunyaLogo } from "./brand/BunyaLogo";
import { PublicLegalFooter } from "./legal/LegalPage";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="public-app-shell">
    <header className="public-app-header">
      <Link href="/" aria-label="بُنية — الرئيسية"><BunyaLogo sizes="140px"/></Link>
      <nav aria-label="التنقل الرئيسي"><Link href="/products">المنتجات</Link><Link href="/contractors">المقاولون</Link><Link href="/join">طلب انضمام</Link><Link href="/login" className="public-app-login">حسابي</Link></nav>
    </header>
    <main>{children}</main>
    <PublicLegalFooter/>
  </div>;
}
