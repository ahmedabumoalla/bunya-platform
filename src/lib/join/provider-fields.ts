export const PROVIDER_DOCUMENT_TYPES = [
  { key: "commercial_registration", label: "سجل تجاري" },
  { key: "municipal_license", label: "رخصة بلدية" },
  { key: "national_address", label: "عنوان وطني" },
  { key: "vat_certificate", label: "شهادة تسجيل الضريبة للقيمة المضافة" },
] as const;

export type ProviderDocumentType = (typeof PROVIDER_DOCUMENT_TYPES)[number]["key"];
export type ProviderJoinPolicy = { id: string; title: string; version: number; body: string[]; updatedAt: string };
export function providerDocumentLabel(value: string) {
  return PROVIDER_DOCUMENT_TYPES.find(item => item.key === value)?.label ?? (value === "supporting_document" ? "مستند إضافي" : value);
}
export function normalizeProviderText(value: string) { return value.normalize("NFC").trim().replace(/\s+/gu, " "); }
export function normalizeServiceCities(values: string[]) {
  const seen = new Set<string>();
  return values.map(normalizeProviderText).filter(value => {
    const key = value.toLocaleLowerCase("en");
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
