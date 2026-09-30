import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { allowedMimeTypes, normalizeEmail, normalizeMobile, PublicJoinError } from "./security";
import { PROVIDER_DOCUMENT_TYPES } from "./provider-fields";
import { contractorDocumentAllowed, contractorDocumentType, contractorRequiredDocuments, CONTRACTOR_PORTFOLIO_MAX_FILES, type ContractorType } from "./contractor-fields";
import { contractorRemovedDocuments } from "./contractor-validation";

type Admin = ReturnType<typeof createAdminClient>;
export type UploadDocument = { id: string; document_key?: string; document_type: string; object_path: string; original_name: string; mime_type: string; size_bytes: number };
type JoinKind = "provider" | "contractor";
type Batch = { id: string; application_kind?: JoinKind; application_id: string; token_hash: string; binding_hash: string; revision_token_hash: string | null; documents: UploadDocument[]; expires_at: string; committed_at: string | null };
export const uploadHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PublicJoinError("حجم بيانات الطلب غير صالح.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function binding(data: FormData, idempotencyKey: string | null, revisionToken?: string) {
  return uploadHash(JSON.stringify([normalizeEmail(data.get("email")), normalizeMobile(data.get("mobile")), revisionToken ? uploadHash(revisionToken) : idempotencyKey]));
}

export async function beginProviderUpload(data: FormData, idempotencyKey: string | null, admin = createAdminClient(), kind: JoinKind = "provider") {
  const revisionToken = String(data.get("revisionToken") || "");
  const contractorType = String(data.get("contractorType") || "") as ContractorType;
  if (kind === "contractor" && !["company", "individual"].includes(contractorType)) throw new PublicJoinError("حدد نوع المقاول: شركة أو فرد.", 400);
  let applicationId = randomUUID() as string;
  let existing: string[] = [];
  let existingKeys: { document_type: string; document_key: string }[] = [];
  if (revisionToken) {
    const { data: revision, error } = await admin.from("join_application_revision_tokens")
      .select("application_id,attempts,max_attempts").eq("token_hash", uploadHash(revisionToken)).eq("application_kind", kind)
      .is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!revision || revision.attempts >= revision.max_attempts) throw new PublicJoinError("رابط التعديل غير صالح أو منتهي.", 410);
    applicationId = revision.application_id;
    const application = await admin.from(`${kind}_applications`).select("status").eq("id", applicationId).single();
    if (application.error) throw application.error;
    if (application.data.status !== "needs_changes") throw new PublicJoinError("الطلب غير متاح للتعديل.", 410);
    const result = await admin.from(kind === "provider" ? "provider_application_documents" : "contractor_documents").select(kind === "provider" ? "document_type" : "id,document_type,document_key").eq("application_id", applicationId).eq("is_current", true);
    if (result.error) throw result.error;
    const rows = (result.data || []) as unknown as { id: string; document_type: string; document_key: string }[];
    existing = rows.map(row => row.document_type);
    if (kind === "contractor") {
      const removedIds = new Set(contractorRemovedDocuments(data));
      if ([...removedIds].some(id => !rows.some(row => row.id === id))) throw new PublicJoinError("قائمة المستندات المحذوفة غير صالحة.", 400);
      existingKeys = rows.filter(row => !removedIds.has(row.id) && contractorDocumentType(row.document_key) === row.document_type && contractorDocumentAllowed(contractorType, row.document_type));
      existing = existingKeys.map(row => row.document_type);
    }
  } else if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    throw new PublicJoinError("تعذر تأكيد معرّف المحاولة. أعد الإرسال.", 400);
  }
  let input: unknown;
  try { input = JSON.parse(String(data.get("documents") || "[]")); } catch { throw new PublicJoinError("بيانات المستندات غير صالحة.", 400); }
  if (!Array.isArray(input) || input.length > (kind === "provider" ? 4 : 24)) throw new PublicJoinError("بيانات المستندات غير صالحة.", 400);
  const seen = new Set<string>();
  const documents: UploadDocument[] = input.map(value => {
    if (!value || typeof value !== "object") throw new PublicJoinError("بيانات المستند غير صالحة.", 400);
    const { documentType, name, mimeType, size } = value;
    const documentKey = kind === "provider" ? documentType : typeof value.documentKey === "string" && value.documentKey.startsWith("portfolio_") ? value.documentKey.toLowerCase() : value.documentKey;
    const validType = kind === "provider" ? PROVIDER_DOCUMENT_TYPES.some(item => item.key === documentType)
      : typeof documentKey === "string" && contractorDocumentType(documentKey) === documentType && contractorDocumentAllowed(contractorType, documentType);
    const validMime = kind === "contractor" && documentType === "portfolio"
      ? ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"].includes(mimeType) : allowedMimeTypes.has(mimeType);
    if (!validType || seen.has(documentKey)
      || typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)
      || !validMime || !Number.isSafeInteger(size) || size <= 0) throw new PublicJoinError("اختر مستندًا صالحًا وغير فارغ في الخانة المناسبة.", 400);
    seen.add(documentKey);
    return { id: randomUUID(), ...(kind === "contractor" ? { document_key: documentKey } : {}), document_type: documentType, object_path: `join-applications/${kind}/${applicationId}/${randomBytes(24).toString("hex")}`, original_name: name, mime_type: mimeType, size_bytes: size };
  });
  const required = kind === "provider" ? PROVIDER_DOCUMENT_TYPES.map(item => item.key) : contractorRequiredDocuments(contractorType);
  if (required.some(key => !seen.has(key) && !existing.includes(key))) throw new PublicJoinError("أرفق جميع المستندات المطلوبة.", 400);
  if (kind === "contractor" && contractorType === "individual") {
    const portfolios = documents.filter(row => row.document_type === "portfolio").length + existingKeys.filter(row => row.document_type === "portfolio" && !seen.has(row.document_key)).length;
    if (portfolios < 1 || portfolios > CONTRACTOR_PORTFOLIO_MAX_FILES) throw new PublicJoinError("أرفق من صورة أو فيديو واحد إلى 20 ملفًا لأعمال سابقة.", 400);
  }
  const token = randomBytes(32).toString("hex");
  const batch = { id: randomUUID(), application_kind: kind, application_id: applicationId, token_hash: uploadHash(token), binding_hash: binding(data, idempotencyKey, revisionToken),
    revision_token_hash: revisionToken ? uploadHash(revisionToken) : null, documents, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  const insert = await admin.from("provider_upload_batches").insert(batch);
  if (insert.error) throw insert.error;
  const files = [];
  for (const document of documents) {
    const signed = await admin.storage.from("join-applications").createSignedUploadUrl(document.object_path, { upsert: false });
    if (signed.error) throw signed.error;
    files.push({ documentType: document.document_type, ...(document.document_key ? { documentKey: document.document_key } : {}), path: document.object_path, token: signed.data.token });
  }
  const url = new URL(getSupabasePublicEnv().url);
  if (url.hostname.endsWith(".supabase.co")) url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  return { uploadToken: token, endpoint: `${url.origin}/storage/v1/upload/resumable/sign`, bucket: "join-applications", files };
}

export async function resolveProviderUpload(data: FormData, idempotencyKey: string | null, revision?: { applicationId: string; token: string }, admin = createAdminClient(), kind: JoinKind = "provider") {
  const token = String(data.get("uploadToken") || "");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new PublicJoinError("جلسة رفع المستندات غير صالحة. أعد الرفع.", 400);
  const { data: row, error } = await admin.from("provider_upload_batches").select("*").eq("token_hash", uploadHash(token)).maybeSingle();
  if (error) throw error;
  const batch = row as Batch | null;
  if (!batch || (batch.application_kind || "provider") !== kind || batch.binding_hash !== binding(data, idempotencyKey, revision?.token)
    || batch.revision_token_hash !== (revision ? uploadHash(revision.token) : null)
    || (revision && batch.application_id !== revision.applicationId)) throw new PublicJoinError("جلسة رفع المستندات غير صالحة لهذا الطلب.", 403);
  if (!batch.committed_at && Date.parse(batch.expires_at) <= Date.now()) throw new PublicJoinError("انتهت جلسة الرفع. أعد رفع المستندات.", 410);
  return batch;
}

export function validDocumentHeader(header: Uint8Array, mime: string) {
  const ascii = new TextDecoder().decode(header);
  const videoAtom = new TextDecoder().decode(header.subarray(4, 8));
  return mime === "application/pdf" ? ascii.startsWith("%PDF-")
    : mime === "video/mp4" ? videoAtom === "ftyp"
    : mime === "video/quicktime" ? ["ftyp", "moov", "mdat", "wide"].includes(videoAtom)
    : mime === "video/webm" ? header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3
    : mime === "image/jpeg" ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    : mime === "image/png" ? header[0] === 0x89 && ascii.slice(1, 4) === "PNG"
    : mime === "image/webp" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
}

export async function verifyProviderUpload(batch: Batch, admin: Admin) {
  for (const document of batch.documents) {
    const info = await admin.storage.from("join-applications").info(document.object_path);
    if (info.error || Number(info.data?.size) !== document.size_bytes || info.data?.contentType !== document.mime_type) throw new PublicJoinError("رفع أحد المستندات غير مكتمل. أعد المحاولة.", 400);
    const signed = await admin.storage.from("join-applications").createSignedUrl(document.object_path, 60);
    if (signed.error) throw signed.error;
    const response = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-11" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    // Never buffer an entire large object if a proxy fails to honor Range.
    if (response.status !== 206 || !response.body) { await response.body?.cancel(); throw new PublicJoinError("تعذر التحقق من المستند. أعد المحاولة.", 503); }
    const header = await readBoundedBytes(response.body, 12);
    if (header.length > 12 || !validDocumentHeader(header, document.mime_type)) throw new PublicJoinError("محتوى أحد المستندات لا يطابق نوع الملف.", 400);
  }
  return batch.documents;
}

export async function cleanupProviderUploads(admin = createAdminClient()) {
  // Batch lasts 24h; add 3h so all two-hour signed tokens plus 24h TUS URLs expire.
  const result = await admin.from("provider_upload_batches").select("id,documents").is("committed_at", null)
    .lt("expires_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()).limit(25);
  if (result.error) throw result.error;
  let removed = 0;
  for (const batch of result.data || []) {
    const paths = (batch.documents as UploadDocument[]).map(document => document.object_path);
    if (paths.length) {
      const referenced = await admin.from("files").select("object_path").eq("bucket_id", "join-applications").in("object_path", paths);
      if (referenced.error) throw referenced.error;
      if (referenced.data?.length) continue;
      const contractorReferences = await admin.from("contractor_documents").select("id").in("storage_path", paths).limit(1);
      if (contractorReferences.error) throw contractorReferences.error;
      if (contractorReferences.data?.length) continue;
      const deletion = await admin.storage.from("join-applications").remove(paths);
      if (deletion.error) throw deletion.error;
    }
    const deletion = await admin.from("provider_upload_batches").delete().eq("id", batch.id).is("committed_at", null);
    if (deletion.error) throw deletion.error;
    removed++;
  }
  const completed = await admin.from("provider_upload_batches").delete().lt("committed_at", new Date(Date.now() - 7 * 86400000).toISOString());
  if (completed.error) throw completed.error;
  return removed;
}
