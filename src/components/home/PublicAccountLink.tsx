import Link from "next/link";
import type { PublicAccount } from "@/lib/auth/public-account";
import styles from "./PublicAccountHeader.module.css";

export function PublicAccountLink({ account, onNavigate }: { account: PublicAccount; onNavigate?: () => void }) {
  return <Link className={styles.accountLink} href={account.href} onClick={onNavigate} aria-label={`ملفي الشخصي — ${account.roleLabel} — ${account.displayName}`} title={`${account.displayName} · ${account.roleLabel}`}>
    <span className={styles.avatar} aria-hidden="true">
      {account.initials || <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>}
    </span>
    <span className={styles.accountCopy}><strong>ملفي الشخصي</strong><small>{account.roleLabel}</small></span>
    <svg className={styles.accountArrow} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
  </Link>;
}
