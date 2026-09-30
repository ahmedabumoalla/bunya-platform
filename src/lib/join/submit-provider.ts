import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareUpload } from "@/lib/uploads/server";
import { notifyJoinReviewers } from "@/lib/notifications/join-reviewers";
import { normalizeEmail, normalizeMobile, PublicJoinError, randomObjectName, requiredText, stringArray } from "./security";
import { isValidProviderUsername, resolveProviderUsername } from "./provider-fields";
import { providerDocuments, providerFields, providerPolicyAcceptance } from "./provider-validation";
import { resolveProviderUpload, verifyProviderUpload, validDocumentHeader } from "./provider-upload-batches";

export async function submitProvider(data: FormData, idempotencyKey: string | null, revision?: { applicationId: string; token: string }) {
  const admin = createAdminClient();
  const identity = providerFields(data);
  const acceptance = await providerPolicyAcceptance(data, admin);
  const email = normalizeEmail(data.get("email"));
  const mobile = normalizeMobile(data.get("mobile"));
  const requestedUsername = String(data.get("username") ?? "").trim();
  const username = resolveProviderUsername(requestedUsername, identity.company_name_en);
  if (!isValidProviderUsername(username)) throw new PublicJoinError("اسم المستخدم يجب أن يكون من حرفين إلى 160 حرفًا، والمسافات مسموحة.", 400);
  const delivery = data.get("deliveryAvailable") === "true";
  const categories = stringArray(data, "categories");
  const regions = delivery ? stringArray(data, "regions") : [];
  const fields = { ...identity, ...acceptance, email, mobile, requested_username: requestedUsername ? username : null, delivery_available: delivery,
    google_maps_url: requiredText(data, "mapsUrl", 8, 2000), latitude: coordinate(data.get("latitude"), -90, 90), longitude: coordinate(data.get("longitude"), -180, 180), public_idempotency_key: idempotencyKey };
  let existingTypes: string[] = [];
  if (revision) {
    const result = await admin.from("provider_application_documents").select("document_type").eq("application_id", revision.applicationId).eq("is_current", true);
    if (result.error) throw result.error;
    existingTypes = (result.data ?? []).map(row => row.document_type);
  }
  const batch = data.has("uploadToken") ? await resolveProviderUpload(data, idempotencyKey, revision, admin) : null;
  if (batch?.committed_at) {
    const receipt = await admin.from("provider_applications").select("id,status,created_at").eq("id", batch.application_id).single();
    if (receipt.error) throw receipt.error;
    return { applicationId: receipt.data.id, status: receipt.data.status, submittedAt: receipt.data.created_at };
  }
  const documents = batch ? [] : providerDocuments(data, existingTypes);
  const applicationId = batch?.application_id ?? revision?.applicationId ?? randomUUID();
  const uploaded: string[] = [];
  const records: Record<string, unknown>[] = [];
  let saved = false;
  try {
    if (batch) records.push(...await verifyProviderUpload(batch, admin));
    for (const document of documents) {
      const header = new Uint8Array(await document.file.slice(0, 12).arrayBuffer());
      const valid = validDocumentHeader(header, document.file.type);
      if (!valid) throw new PublicJoinError("محتوى أحد المستندات لا يطابق نوع الملف. ارفع ملف PDF أو صورة صالحة.", 400);
      const file = await prepareUpload(document.file);
      const path = `join-applications/provider/${applicationId}/${randomObjectName()}`;
      const result = await admin.storage.from("join-applications").upload(path, file.bytes, { contentType: file.mimeType, upsert: false });
      if (result.error) throw result.error;
      uploaded.push(path);
      records.push({ id: randomUUID(), object_path: path, original_name: file.fileName, mime_type: file.mimeType, size_bytes: file.size, checksum_sha256: createHash("sha256").update(file.bytes).digest("hex"), document_type: document.type });
    }
    const result = batch
      ? await admin.rpc("commit_provider_join_upload", { p_token_hash: batch.token_hash, p_binding_hash: batch.binding_hash, p_fields: fields, p_categories: categories, p_regions: regions, p_documents: records })
      : await admin.rpc("save_provider_join_application", { p_application_id: applicationId, p_fields: fields, p_categories: categories, p_regions: regions, p_documents: records, p_revision_token_hash: revision ? createHash("sha256").update(revision.token).digest("hex") : null });
    if (result.error) {
      if (result.error.code === "23505") throw new PublicJoinError("يوجد طلب مرتبط بهذه البيانات أو تم تسجيل هذه المحاولة مسبقًا.", 409);
      if (result.error.code === "23514") throw new PublicJoinError("تعذر حفظ الطلب بعد تغير السياسة أو حالة الطلب. حدّث البيانات والسياسة وأعد المحاولة.", 409);
      throw result.error;
    }
    saved = true;
    const receipt = result.data as { applicationId: string; status: string; submittedAt: string };
    await notifyJoinReviewers({ kind: "provider", applicationId, applicantEmail: email, applicantName: identity.contact_name || identity.company_name,
      submissionKey: revision ? `${applicationId}-${createHash("sha256").update(revision.token).digest("hex").slice(0, 16)}` : applicationId,
      submittedAt: revision ? new Date().toISOString() : receipt.submittedAt,
      details: [
        { label: "اسم الشركة بالعربية", value: identity.company_name }, { label: "اسم الشركة بالإنجليزية", value: identity.company_name_en },
        { label: "اسم المسؤول", value: identity.contact_name || "غير محدد" }, { label: "الجوال", value: mobile }, { label: "البريد الإلكتروني", value: email },
        { label: "المدن المخدومة", value: identity.service_cities.join("، ") }, { label: "التصنيفات", value: categories.join("، ") },
        { label: "الموقع", value: fields.google_maps_url }, { label: "التوصيل", value: delivery ? regions.join("، ") : "غير متاح" },
        { label: "الموافقة على السياسة", value: `${acceptance.joining_policy_title} — الإصدار ${acceptance.joining_policy_version}` },
        ...(revision ? [{ label: "حالة التقديم", value: "أعيد إرسال الطلب بعد التعديل" }] : []),
      ],
    }).catch(() => { console.error("provider_join_notification_failed", { applicationId }); });
    return receipt;
  } finally {
    if (!saved && uploaded.length) {
      const cleanup = await admin.storage.from("join-applications").remove(uploaded);
      if (cleanup.error) console.error("provider_join_upload_cleanup_failed", { applicationId, count: uploaded.length });
    }
  }
}

function coordinate(value: FormDataEntryValue | null, min: number, max: number) {
  if (value === null || String(value).trim() === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new PublicJoinError("الإحداثيات غير صالحة.", 400);
  return result;
}
