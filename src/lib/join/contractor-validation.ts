import "server-only";
import { normalizeContractorText, normalizeServiceCities, resolveContractorUsername, isValidContractorUsername, type ContractorType } from "./contractor-fields";
import { PublicJoinError } from "./security";

export function contractorFields(data: FormData) {
  const contractor_type = String(data.get("contractorType") || "") as ContractorType;
  if (!["company", "individual"].includes(contractor_type)) throw new PublicJoinError("حدد نوع المقاول: شركة أو فرد.", 400);
  const contractor_name = normalizeContractorText(String(data.get("contractorName") || ""));
  const contractor_name_en = normalizeContractorText(String(data.get("contractorNameEn") || ""));
  const contact_name = contractor_type === "company" ? normalizeContractorText(String(data.get("contactName") || "")) || null : null;
  if ([contractor_name, contractor_name_en].some(value => value.length < 2 || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value))) throw new PublicJoinError("أدخل الاسم بالعربية والإنجليزية، من حرفين إلى 160 حرفًا. المسافات مسموحة.", 400);
  if (contact_name && contact_name.length > 120) throw new PublicJoinError("اسم المسؤول لا يتجاوز 120 حرفًا.", 400);
  const custom = normalizeContractorText(String(data.get("username") || ""));
  const username = resolveContractorUsername(custom, contractor_name_en);
  if (!isValidContractorUsername(username)) throw new PublicJoinError("اسم المستخدم يجب أن يكون من حرفين إلى 160 حرفًا، والمسافات مسموحة.", 400);
  let input: unknown;
  try { input = JSON.parse(String(data.get("serviceCities") || "[]")); } catch { throw new PublicJoinError("قائمة المدن غير صالحة.", 400); }
  if (!Array.isArray(input) || !input.length || input.length > 50 || input.some(value => typeof value !== "string")) throw new PublicJoinError("أضف مدينة واحدة على الأقل، وبحد أقصى 50 مدينة.", 400);
  const service_cities = normalizeServiceCities(input);
  if (!service_cities.length || service_cities.some(value => value.length < 2 || value.length > 100)) throw new PublicJoinError("اسم المدينة يجب أن يكون من حرفين إلى 100 حرف.", 400);
  return { contractor_type, contractor_name, contractor_name_en, contact_name, requested_username: custom ? username : null, service_cities };
}

export function contractorRemovedDocuments(data: FormData) {
  let value: unknown;
  try { value = JSON.parse(String(data.get("removedDocumentIds") || "[]")); } catch { throw new PublicJoinError("قائمة المستندات المحذوفة غير صالحة.", 400); }
  if (!Array.isArray(value) || value.length > 24 || value.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new PublicJoinError("قائمة المستندات المحذوفة غير صالحة.", 400);
  return [...new Set((value as string[]).map(id => id.toLowerCase()))];
}
