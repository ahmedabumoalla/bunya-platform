"use client";

import { useState } from "react";
import { localeOptions, type AppLocale } from "@/lib/i18n/config";
import { useLocale } from "./LocaleProvider";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t, setLocale } = useLocale();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    if (value === locale) return;
    setBusy(true);
    await setLocale(value as AppLocale);
  }

  return (
    <label className={`${styles.switcher} ${compact ? styles.compact : ""}`}>
      <span aria-hidden className={styles.icon}>文</span>
      <span className={styles.label}>{t("language")}</span>
      <select
        aria-label={t("chooseLanguage")}
        value={locale}
        disabled={busy}
        onChange={(event) => void change(event.target.value)}
      >
        {localeOptions.map((option) => (
          <option key={option.code} value={option.code}>{option.nativeName}</option>
        ))}
      </select>
    </label>
  );
}

export function FloatingLanguageSwitcher() {
  return <div className={styles.floating}><LanguageSwitcher compact /></div>;
}

export function MobileHeaderLanguageSwitcher() {
  return <div className={styles.mobileHeader}><LanguageSwitcher compact /></div>;
}
