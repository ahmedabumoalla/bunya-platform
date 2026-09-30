import { PROVIDER_DOCUMENT_TYPES } from "./provider-fields";

export { normalizeProviderText as normalizeContractorText, normalizeServiceCities, resolveProviderUsername as resolveContractorUsername, isValidProviderUsername as isValidContractorUsername } from "./provider-fields";

export const CONTRACTOR_TYPES = ["company", "individual"] as const;
export type ContractorType = (typeof CONTRACTOR_TYPES)[number];
export const CONTRACTOR_PORTFOLIO_MAX_FILES = 20;
export const CONTRACTOR_COMPANY_DOCUMENT_TYPES = [
  ...PROVIDER_DOCUMENT_TYPES.map((item) => ({ ...item, required: true })),
  { key: "company_profile", label: "ملف تعريفي للشركة", required: false },
] as const;
export const CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES = [
  { key: "national_id", label: "الهوية الوطنية", required: true },
  { key: "portfolio", label: "أعمال سابقة", required: true },
] as const;
export type ContractorDocumentType = (typeof CONTRACTOR_COMPANY_DOCUMENT_TYPES)[number]["key"] | (typeof CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES)[number]["key"];
export const CONTRACTOR_DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const CONTRACTOR_PORTFOLIO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"] as const;

export function contractorDocumentType(key: string): ContractorDocumentType | undefined {
  if (/^portfolio_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return "portfolio";
  return [...CONTRACTOR_COMPANY_DOCUMENT_TYPES, ...CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES].find((item) => item.key !== "portfolio" && item.key === key)?.key;
}
export function contractorDocumentAllowed(type: ContractorType, documentType: string) {
  return (type === "company" ? CONTRACTOR_COMPANY_DOCUMENT_TYPES : CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES).some((item) => item.key === documentType);
}
export function contractorRequiredDocuments(type: ContractorType): ContractorDocumentType[] {
  return (type === "company" ? CONTRACTOR_COMPANY_DOCUMENT_TYPES : CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES).filter((item) => item.required && item.key !== "portfolio").map((item) => item.key);
}
export function contractorDocumentLabel(value: string) {
  return [...CONTRACTOR_COMPANY_DOCUMENT_TYPES, ...CONTRACTOR_INDIVIDUAL_DOCUMENT_TYPES].find((item) => item.key === value)?.label ?? (value === "supporting_document" ? "مستند سابق" : value);
}
