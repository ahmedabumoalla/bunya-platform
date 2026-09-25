import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./bunya-design-system.css";
import "./glass-theme.css";
import "./brand-experience.css";
import "./database.css";
import "./marketplace-catalog.css";
import "./native-mobile.css";
import {LegacyPwaCleanup} from "@/components/LegacyPwaCleanup";
import {NativePushRuntime} from "@/components/NativePushRuntime";
import {BunyaVisualRuntime} from "@/components/BunyaVisualRuntime";
import {cookies} from "next/headers";
import {LocaleProvider} from "@/components/i18n/LocaleProvider";
import {FloatingLanguageSwitcher} from "@/components/i18n/LanguageSwitcher";
import {defaultLocale,isAppLocale,localeCookieName,localeDirection} from "@/lib/i18n/config";

const plexArabic = localFont({
  src: [
    {path: "./fonts/IBMPlexSansArabic-Regular.woff2", weight: "400", style: "normal"},
    {path: "./fonts/IBMPlexSansArabic-Medium.woff2", weight: "500", style: "normal"},
    {path: "./fonts/IBMPlexSansArabic-SemiBold.woff2", weight: "600", style: "normal"},
    {path: "./fonts/IBMPlexSansArabic-Bold.woff2", weight: "700", style: "normal"},
  ],
  style: "normal",
  variable: "--font-plex-arabic",
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "بُنية | منصة توريد مواد البناء",
  description:
    "منصة عربية لإدارة طلبات مواد البناء، جمع عروض التجار، اعتماد السعر الأرخص المؤهل، وإدارة التوصيل بكود المصافحة الرقمية.",
};

export const viewport:Viewport={themeColor:"#b97149",colorScheme:"light"};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const storedLocale=(await cookies()).get(localeCookieName)?.value;
  const locale=isAppLocale(storedLocale)?storedLocale:defaultLocale;
  return (
    <html className={plexArabic.variable} lang={locale} dir={localeDirection(locale)}>
      <body><LocaleProvider initialLocale={locale}><LegacyPwaCleanup/><NativePushRuntime/><BunyaVisualRuntime/><FloatingLanguageSwitcher/>{children}</LocaleProvider></body>
    </html>
  );
}
