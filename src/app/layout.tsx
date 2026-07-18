import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./bunya-design-system.css";
import "./glass-theme.css";
import "./brand-experience.css";
import {PwaRuntime} from "@/components/PwaRuntime";
import {BunyaVisualRuntime} from "@/components/BunyaVisualRuntime";

export const metadata: Metadata = {
  title: "بُنية | منصة توريد مواد البناء",
  description:
    "منصة عربية لإدارة طلبات مواد البناء، جمع عروض التجار، اعتماد السعر الأرخص المؤهل، وإدارة التوصيل بكود المصافحة الرقمية.",
  manifest:"/manifest.webmanifest",
  appleWebApp:{capable:true,statusBarStyle:"default",title:"بُنية"},
  icons:{icon:[{url:"/pwa/icon-192.png",sizes:"192x192",type:"image/png"},{url:"/pwa/icon-512.png",sizes:"512x512",type:"image/png"}],apple:[{url:"/pwa/icon-192.png",sizes:"192x192",type:"image/png"}]},
};

export const viewport:Viewport={themeColor:"#b97149",colorScheme:"light"};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body><PwaRuntime/><BunyaVisualRuntime/>{children}</body>
    </html>
  );
}
