"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { defaultLocale, isAppLocale, localeCookieName, localeDirection, type AppLocale } from "@/lib/i18n/config";
import { translate, translateStatus, type MessageKey } from "@/lib/i18n/messages";
import { translateLiteral } from "@/lib/i18n/messages";

type LocaleContextValue = {
  locale: AppLocale;
  direction: "rtl" | "ltr";
  t: (key: MessageKey) => string;
  status: (value: unknown) => string;
  setLocale: (locale: AppLocale) => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale?: string; children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(isAppLocale(initialLocale) ? initialLocale : defaultLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
    document.body.dataset.locale = locale;
  }, [locale]);

  useEffect(() => {
    if (locale === "ar") return;
    const translateElement = (root: ParentNode) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,[data-no-localize]") || !node.nodeValue?.trim()) continue;
        const next = translateLiteral(locale, node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
      if (root instanceof Element) {
        for (const attribute of ["placeholder", "title", "aria-label"] as const) {
          const current = root.getAttribute(attribute);
          if (!current) continue;
          const next = translateLiteral(locale, current);
          if (next !== current) root.setAttribute(attribute, next);
        }
      }
      root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach((element) => {
        for (const attribute of ["placeholder", "title", "aria-label"] as const) {
          const current = element.getAttribute(attribute);
          if (!current) continue;
          const next = translateLiteral(locale, current);
          if (next !== current) element.setAttribute(attribute, next);
        }
      });
    };
    translateElement(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && record.target.parentNode) {
          translateElement(record.target.parentNode);
          continue;
        }
        if (record.type === "attributes" && record.target instanceof Element) {
          translateElement(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) translateElement(node);
          else if (node.nodeType === Node.TEXT_NODE && node.parentNode) translateElement(node.parentNode);
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [locale]);

  const setLocale = useCallback(async (next: AppLocale) => {
    setLocaleState(next);
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try {
      const db = createClient();
      const user = (await db.auth.getUser()).data.user;
      if (user) await db.from("profiles").update({ preferred_locale: next }).eq("id", user.id);
    } catch {
      // The cookie remains the reliable fallback when the profile is unavailable.
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    if (document.cookie.split("; ").some((entry) => entry.startsWith(`${localeCookieName}=`))) return;
    void (async () => {
      try {
        const db = createClient();
        const user = (await db.auth.getUser()).data.user;
        if (!user) return;
        const result = await db.from("profiles").select("preferred_locale").eq("id", user.id).maybeSingle();
        const preferred = result.data?.preferred_locale;
        if (isAppLocale(preferred) && preferred !== locale) await setLocale(preferred);
      } catch {
        // Keep the default locale when the profile cannot be read.
      }
    })();
  }, [locale, setLocale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    direction: localeDirection(locale),
    t: (key) => translate(locale, key),
    status: (raw) => translateStatus(locale, raw),
    setLocale,
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
