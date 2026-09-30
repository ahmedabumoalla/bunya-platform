import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyJoinReviewers } from "@/lib/notifications/join-reviewers";
import { contractorFields, contractorRemovedDocuments } from "./contractor-validation";
import { providerPolicyAcceptance } from "./provider-validation";
import { normalizeEmail, normalizeMobile, PublicJoinError, stringArray } from "./security";
import { resolveProviderUpload, verifyProviderUpload } from "./provider-upload-batches";

export async function submitContractor(data: FormData, idempotencyKey: string | null, revision?: { applicationId: string; token: string }) {
  const admin = createAdminClient();
  const { service_cities, ...identity } = contractorFields(data);
  const email = normalizeEmail(data.get("email"));
  const mobile = normalizeMobile(data.get("mobile"));
  const specialties = stringArray(data, "specialties");
  const removed = contractorRemovedDocuments(data);
  if ([...data.values()].some(value => value instanceof File)) throw new PublicJoinError("ارفع المرفقات أولًا ثم أرسل بيانات الطلب.", 400);
  const batch = await resolveProviderUpload(data, idempotencyKey, revision, admin, "contractor");
  if (batch.committed_at) {
    const receipt = await admin.from("contractor_applications").select("id,status,created_at").eq("id", batch.application_id).single();
    if (receipt.error) throw receipt.error;
    return { applicationId: receipt.data.id, status: receipt.data.status, submittedAt: receipt.data.created_at };
  }
  const acceptance = await providerPolicyAcceptance(data, admin, "contractor");
  const documents = await verifyProviderUpload(batch, admin);
  const result = await admin.rpc("commit_contractor_join_upload", {
    p_token_hash: batch.token_hash, p_binding_hash: batch.binding_hash,
    p_fields: { ...identity, ...acceptance, email, mobile, public_idempotency_key: idempotencyKey },
    p_specialties: specialties, p_regions: service_cities, p_documents: documents, p_removed_document_ids: removed,
  });
  if (result.error) {
    if (result.error.code === "23505") throw new PublicJoinError("يوجد طلب مرتبط بهذه البيانات أو اسم المستخدم مستخدم بالفعل.", 409);
    if (result.error.code === "23514") throw new PublicJoinError("تأكد من المستندات المطلوبة والموافقة على أحدث سياسة، ثم أعد المحاولة.", 409);
    throw result.error;
  }
  const receipt = result.data as { applicationId: string; status: string; submittedAt: string };
  await notifyJoinReviewers({ kind: "contractor", applicationId: receipt.applicationId, applicantEmail: email, applicantName: identity.contractor_name,
    submissionKey: revision ? `${receipt.applicationId}-${createHash("sha256").update(revision.token).digest("hex").slice(0, 16)}` : receipt.applicationId,
    submittedAt: revision ? new Date().toISOString() : receipt.submittedAt,
    details: [
      { label: "نوع المقاول", value: identity.contractor_type === "company" ? "شركة" : "فرد" },
      { label: "الاسم بالعربية", value: identity.contractor_name }, { label: "الاسم بالإنجليزية", value: identity.contractor_name_en },
      { label: "اسم المستخدم", value: identity.requested_username || identity.contractor_name_en },
      { label: "اسم المسؤول", value: identity.contact_name || "غير محدد" }, { label: "الجوال", value: mobile }, { label: "البريد الإلكتروني", value: email },
      { label: "المدن المخدومة", value: service_cities.join("، ") }, { label: "التخصصات", value: specialties.join("، ") },
      { label: "الموافقة على السياسة", value: `${acceptance.joining_policy_title} — الإصدار ${acceptance.joining_policy_version}` },
      ...(revision ? [{ label: "حالة التقديم", value: "أعيد إرسال الطلب بعد التعديل" }] : []),
    ],
  }).catch(() => { console.error("contractor_join_notification_failed", { applicationId: receipt.applicationId }); });
  return receipt;
}
