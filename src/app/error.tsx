"use client";
import Link from "next/link";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="system-state-page" role="alert"><BunyaLogo/><h1>لم تكتمل هذه الخطوة</h1><p>أعد المحاولة للمتابعة.</p><div className="system-state-actions"><button type="button" className="portal-primary-button" onClick={() => retry()}>إعادة المحاولة</button><Link href="/">الصفحة الرئيسية</Link></div></main>;
}
