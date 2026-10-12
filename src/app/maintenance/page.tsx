import Link from "next/link";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

export default function MaintenanceExpired() {
  return <main className="system-state-page"><BunyaLogo/><h1>انتهت جلسة الدخول بالنيابة</h1><p>انتهت المدة أو تغيّرت صلاحية الحساب. يمكنك الرجوع إلى الإدارة من الشريط أعلى الصفحة.</p><Link href="/">الصفحة الرئيسية</Link></main>;
}
