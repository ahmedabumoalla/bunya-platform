import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./glass-theme.css";
import {PwaRuntime} from "@/components/PwaRuntime";

export const metadata: Metadata = {
  title: "بُنية | منصة توريد مواد البناء",
  description:
    "منصة عربية لإدارة طلبات مواد البناء، جمع عروض التجار، اعتماد السعر الأرخص المؤهل، وإدارة التوصيل بكود المصافحة الرقمية.",
  manifest:"/manifest.webmanifest",
  appleWebApp:{capable:true,statusBarStyle:"default",title:"بُنية"},
  icons:{icon:[{url:"/pwa/icon-192.png",sizes:"192x192",type:"image/png"}],apple:[{url:"/pwa/icon-192.png",sizes:"192x192",type:"image/png"}]},
};

export const viewport:Viewport={themeColor:"#0b3976",colorScheme:"light"};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body><PwaRuntime/>{children}</body>
    </html>
  );
}
