"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminGroups } from "@/lib/admin/navigation";
import { AdminIcon } from "./AdminIcon";

export function AdminSectionNav() {
  const pathname = usePathname();
  const group = adminGroups.find(([, items]) => items.some(([, href]) => href !== "/admin" && (pathname === href || pathname.startsWith(`${href}/`))));
  if (!group || pathname === "/admin") return null;
  return <nav className="admin-section-nav" aria-label={`أقسام ${group[0]}`}><span>{group[0]}</span><div>{group[1].map(([label, href, icon]) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><AdminIcon name={icon} size={17}/>{label}</Link>)}</div></nav>;
}
