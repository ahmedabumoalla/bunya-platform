import type { AppLocale } from "./config";

export function localizedSnapshot(
  source: unknown,
  translations: unknown,
  locale: AppLocale,
): string {
  const fallback = String(source ?? "—");
  if (locale === "ar" || !translations || typeof translations !== "object" || Array.isArray(translations)) return fallback;
  const translated = String((translations as Record<string, unknown>)[locale] ?? "").trim();
  return translated || fallback;
}
