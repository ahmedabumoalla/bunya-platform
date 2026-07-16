"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export function ProviderPageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="provider-page-header"><div><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>{action ? <div>{action}</div> : null}</header>;
}

export function ProviderStatus({ value }: { value: string }) {
  const labels: Record<string, string> = {
    draft: "مسودة", pending_review: "بانتظار المراجعة", active: "نشط", rejected: "مرفوض", unavailable: "غير متوفر",
    new: "جديد", viewed: "تم تأكيد الاستلام", quoted: "تم إرسال الاستجابة", expired: "منتهي",
    pending_customer: "بانتظار مراجعة العميل", approved: "تمت الموافقة", modified: "تم التعديل",
    confirmed: "مؤكد", preparing: "قيد التجهيز", ready_for_pickup: "جاهز للاستلام", assigned_driver: "تم إسناده لسائق", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", completed: "مكتمل", cancelled: "ملغي",
    assigned: "تم الإسناد", arrived: "وصل السائق", picked_up: "تم الاستلام من المزود",
    pending: "معلق", available: "متاح", settled: "تمت التصفية", reversed: "معكوسة", transferred: "تم التحويل", transferring: "قيد التحويل", pending_review_settlement: "بانتظار المراجعة",
    valid: "صالح", expiring_soon: "ينتهي قريبًا", needs_confirmation: "يحتاج تأكيدًا", evaluating: "قيد التقييم الداخلي", selected: "تم الفوز داخليًا", not_selected: "لم يتم الاختيار", needs_update: "يحتاج تحديثًا",
    open: "مفتوحة", in_progress: "قيد المعالجة", resolved: "محلولة", closed: "مغلقة", suspended: "موقوف",
  };
  const tone = ["approved", "active", "completed", "delivered", "transferred", "available", "valid", "selected"].includes(value) ? "success" : ["rejected", "cancelled", "expired", "unavailable", "not_selected"].includes(value) ? "danger" : ["new", "confirmed", "out_for_delivery", "evaluating"].includes(value) ? "info" : "warning";
  return <span className={`provider-status provider-status-${tone}`}>{labels[value] ?? value}</span>;
}

export function ProviderEmpty({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <div className="provider-empty"><span>◇</span><h3>{title}</h3><p>{description}</p>{href && action ? <Link className="provider-primary" href={href}>{action}</Link> : null}</div>;
}

export function ProviderSkeleton() {
  return <div className="provider-skeleton" aria-label="جارٍ التحميل"><i /><i /><i /></div>;
}

export function ProviderConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="provider-modal-backdrop" role="presentation" onMouseDown={onCancel}><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}><span className="provider-modal-icon">!</span><h3 id="confirm-title">{title}</h3><p>{description}</p><div><button className="provider-secondary" type="button" onClick={onCancel}>إلغاء</button><button className="provider-danger" type="button" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

export function ProviderToast({ message, tone = "success" }: { message: string; tone?: "success" | "error" }) {
  return message ? <div className={`provider-toast provider-toast-${tone}`} role="status">{tone === "success" ? "✓" : "!"} {message}</div> : null;
}

export function formatMoney(value: number) {
  return `${value.toLocaleString("ar-SA", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })} ر.س`;
}

export function formatProviderDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
