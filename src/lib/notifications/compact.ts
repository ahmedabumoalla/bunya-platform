/** Human-readable display references only. Always retain full IDs for access and mutations. */
export function shortReference(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(text)
    ? text.slice(0, 8).toUpperCase()
    : text;
}

export function compactText(value: unknown, max = 80): string {
  const text = typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() : "";
  const limit = Math.max(1, Math.floor(max));
  const characters = Array.from(text);
  return characters.length > limit ? characters.slice(0, limit - 1).join("").trimEnd() + "…" : text;
}

/** Compact existing notices at read time; the original record and its action link stay intact. */
export function notificationPreview(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  const lines = value.replace(/https?:\/\/\S+/gi, "").split(/\r?\n/)
    .map(line => line.trim()).filter(Boolean)
    .filter(line => !/^(?:وقت التقديم|بيانات مقدم الطلب|بيانات الطلب|نوع المقاول|الاسم بالإنجليزية|اسم الشركة بالإنجليزية|اسم المستخدم|اسم المسؤول|البريد|المدن|التخصصات|الموافقة على السياسة|المراجعة|التفاصيل|العنوان|الموقع|الوصف|الكمية|السعر|الإجمالي)\s*[:：]/.test(line));
  const name = lines.find(line => /^(?:الاسم بالعربية|اسم الشركة بالعربية|الاسم|العميل)\s*[:：]/.test(line));
  const phone = lines.find(line => /^(?:الجوال|رقم الجوال|الهاتف)\s*[:：]/.test(line));
  const reference = lines.find(line => /^(?:رقم الطلب(?: الفريد)?|مرجع الطلب)\s*[:：]/.test(line));
  const selection = name || phone ? [name, phone, reference].filter(Boolean).join(" · ") : lines.slice(0, 2).join(" · ");
  return compactText(selection.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi, id => shortReference(id)), max);
}
