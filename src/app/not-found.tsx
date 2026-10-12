import Link from "next/link";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

export default function NotFound() {
  return <main className="system-state-page"><BunyaLogo/><p>404</p><h1>الصفحة غير موجودة</h1><p>قد يكون الرابط تغيّر. يمكنك متابعة التصفح من الصفحة الرئيسية.</p><Link href="/">العودة للرئيسية</Link></main>;
}
