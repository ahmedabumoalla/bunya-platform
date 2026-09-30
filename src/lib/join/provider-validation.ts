import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { policyParagraphs } from "@/lib/policies/registry";
import { allowedMimeTypes, PublicJoinError } from "./security";
import { normalizeProviderText, normalizeServiceCities, PROVIDER_DOCUMENT_TYPES, type ProviderDocumentType } from "./provider-fields";

export function providerFields(data: FormData) {
  const company_name = normalizeProviderText(String(data.get("companyName") ?? ""));
  const company_name_en = normalizeProviderText(String(data.get("companyNameEn") ?? ""));
  const contact_name = normalizeProviderText(String(data.get("contactName") ?? "")) || null;
  if (company_name.length < 2 || company_name.length > 160 || company_name_en.length < 2 || company_name_en.length > 160) throw new PublicJoinError("أدخل اسم الشركة بالعربية والإنجليزية، من حرفين إلى 160 حرفًا لكل اسم. المسافات مسموحة.", 400);
  if (contact_name && contact_name.length > 120) throw new PublicJoinError("اسم المسؤول لا يتجاوز 120 حرفًا.", 400);
  let input: unknown;
  try { input = JSON.parse(String(data.get("serviceCities") ?? "[]")); } catch { throw new PublicJoinError("قائمة المدن غير صالحة.", 400); }
  if (!Array.isArray(input) || !input.length || input.length > 50 || input.some(value => typeof value !== "string")) throw new PublicJoinError("أضف مدينة واحدة على الأقل، وبحد أقصى 50 مدينة.", 400);
  const service_cities = normalizeServiceCities(input as string[]);
  if (!service_cities.length || service_cities.some(value => value.length < 2 || value.length > 100)) throw new PublicJoinError("اسم المدينة يجب أن يكون من حرفين إلى 100 حرف.", 400);
  return { company_name, company_name_en, contact_name, service_cities };
}

export function providerDocuments(data: FormData, existingTypes: string[] = []) {
  const documents: { file: File; type: ProviderDocumentType }[] = [];
  for (const entry of PROVIDER_DOCUMENT_TYPES) {
    const values = data.getAll(`document:${entry.key}`);
    if (values.length > 1) throw new PublicJoinError(`ارفع ملفًا واحدًا فقط: ${entry.label}.`, 400);
    const file = values[0];
    if (file === undefined && existingTypes.includes(entry.key)) continue;
    if (!(file instanceof File) || !file.size) throw new PublicJoinError(`أرفق ${entry.label}.`, 400);
    if (!allowedMimeTypes.has(file.type)) throw new PublicJoinError("يُسمح بملفات PDF أو JPEG أو PNG أو WebP غير الفارغة.", 400);
    documents.push({ file, type: entry.key });
  }
  for (const [key] of data) if ((key.startsWith("document:") && !PROVIDER_DOCUMENT_TYPES.some(type => key === `document:${type.key}`)) || key === "documents") throw new PublicJoinError("ارفع كل مستند في الخانة المخصصة له.", 400);
  return documents;
}

export async function providerPolicyAcceptance(data: FormData, admin = createAdminClient()) {
  if (data.get("policyAccepted") !== "true") throw new PublicJoinError("يجب الموافقة على سياسة التقديم كمزود خدمة في بُنية قبل إرسال الطلب.", 400);
  const { data: policy, error } = await admin.from("platform_policies").select("id,title,version,body,updated_at").eq("policy_key", "provider-join").eq("is_published", true).maybeSingle();
  if (error) throw error;
  if (!policy || !policyParagraphs(policy.body).some(paragraph => paragraph.trim())) throw new PublicJoinError("سياسة انضمام المزود غير منشورة حاليًا. يرجى المحاولة بعد نشرها.", 503);
  if (data.get("policyId") !== policy.id || Number(data.get("policyVersion")) !== policy.version || data.get("policyUpdatedAt") !== policy.updated_at) throw new PublicJoinError("تم تحديث سياسة الانضمام. أعد تحميل السياسة واقرأها ثم وافق عليها مجددًا.", 409);
  return { joining_policy_id: policy.id, joining_policy_version: policy.version, joining_policy_title: policy.title, joining_policy_body: policy.body, joining_policy_updated_at: policy.updated_at, joining_policy_accepted_at: new Date().toISOString() };
}
