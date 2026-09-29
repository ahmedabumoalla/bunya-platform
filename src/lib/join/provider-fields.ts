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
export function resolveProviderUsername(username: string, companyNameEn: string) {
  return normalizeProviderText(username.trim() ? username : companyNameEn);
}
export function isValidProviderUsername(value: string) {
  // Company names may contain spaces and must not be truncated or renamed.
  return value.length >= 2 && value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value);
}
export function normalizeServiceCities(values: string[]) {
  const seen = new Set<string>();
  return values.map(normalizeProviderText).filter(value => {
    const key = value.toLocaleLowerCase("en");
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
