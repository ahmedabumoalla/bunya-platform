export const supportedLocales = ["ar", "en", "ur", "hi", "bn", "fil"] as const;

export type AppLocale = (typeof supportedLocales)[number];

export const defaultLocale: AppLocale = "ar";
export const localeCookieName = "bunya_locale";

export const localeOptions: ReadonlyArray<{
  code: AppLocale;
  nativeName: string;
  englishName: string;
}> = [
  { code: "ar", nativeName: "العربية", englishName: "Arabic" },
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "ur", nativeName: "اردو", englishName: "Urdu" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi" },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali" },
  { code: "fil", nativeName: "Filipino", englishName: "Filipino" },
];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && supportedLocales.includes(value as AppLocale);
}

export function localeDirection(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" || locale === "ur" ? "rtl" : "ltr";
}

export function intlLocale(locale: AppLocale): string {
  return ({ ar: "ar-SA", en: "en-SA", ur: "ur-PK", hi: "hi-IN", bn: "bn-BD", fil: "fil-PH" })[locale];
}
