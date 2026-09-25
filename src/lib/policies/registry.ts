export type PolicyAudience = "customer" | "provider" | "contractor" | "driver";
export const policyDestinations = [
  { key: "terms", label: "شروط الاستخدام", location: "صفحة الشروط وجميع الحسابات", href: "/terms", audiences: ["customer", "provider", "contractor", "driver"] },
  { key: "privacy", label: "سياسة الخصوصية", location: "صفحة الخصوصية وجميع الحسابات", href: "/privacy", audiences: ["customer", "provider", "contractor", "driver"] },
  { key: "account-deletion", label: "حذف الحساب والبيانات", location: "صفحة حذف الحساب وجميع الحسابات", href: "/account-deletion", audiences: ["customer", "provider", "contractor", "driver"] },
  { key: "customer", label: "سياسة العملاء", location: "حساب العميل ومركز السياسات", href: "/customer/policies", audiences: ["customer"] },
  { key: "provider", label: "سياسة المزودين", location: "حساب المزود وصفحة الانضمام", href: "/merchant/policies", audiences: ["provider"] },
  { key: "contractor", label: "سياسة المقاولين", location: "حساب المقاول وصفحة الانضمام", href: "/contractor/policies", audiences: ["contractor"] },
  { key: "delivery", label: "سياسة التوصيل والاستلام", location: "مركز السياسات وحسابات العميل والمزود والسائق", href: "/policies#delivery", audiences: ["customer", "provider", "driver"] },
  { key: "payments", label: "سياسة الدفع", location: "صفحة الدفع ومركز السياسات", href: "/policies#payments", audiences: ["customer", "provider", "contractor"] },
  { key: "returns", label: "سياسة الإلغاء والاسترجاع", location: "صفحة الدفع ومركز السياسات", href: "/policies#returns", audiences: ["customer", "provider", "contractor"] },
  { key: "general", label: "سياسة عامة", location: "جميع الحسابات ومركز السياسات", href: "/policies#general", audiences: ["customer", "provider", "contractor", "driver"] },
] as const;
export function policyForAudience(key: string, audience: PolicyAudience) {
  const destination = policyDestinations.find(item => item.key === key);
  return !destination || (destination.audiences as readonly string[]).includes(audience);
}
export function policyParagraphs(body: unknown): string[] {
  if (typeof body === "string") return body.split(/\n{2,}/).filter(Boolean);
  if (!Array.isArray(body)) return [];
  return body.flatMap(item => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") return [[item.title, item.content ?? item.text].filter(value => typeof value === "string").join("\n")].filter(Boolean);
    return [];
  });
}
