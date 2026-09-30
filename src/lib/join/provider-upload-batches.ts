import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { allowedMimeTypes, normalizeEmail, normalizeMobile, PublicJoinError } from "./security";
import { PROVIDER_DOCUMENT_TYPES } from "./provider-fields";

type Admin = ReturnType<typeof createAdminClient>;
export type UploadDocument = { id: string; document_type: string; object_path: string; original_name: string; mime_type: string; size_bytes: number };
type Batch = { id: string; application_id: string; token_hash: string; binding_hash: string; revision_token_hash: string | null; documents: UploadDocument[]; expires_at: string; committed_at: string | null };
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

export async function beginProviderUpload(data: FormData, idempotencyKey: string | null, admin = createAdminClient()) {
  const revisionToken = String(data.get("revisionToken") || "");
  let applicationId = randomUUID() as string;
  let existing: string[] = [];
  if (revisionToken) {
    const { data: revision, error } = await admin.from("join_application_revision_tokens")
      .select("application_id,attempts,max_attempts").eq("token_hash", uploadHash(revisionToken)).eq("application_kind", "provider")
      .is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!revision || revision.attempts >= revision.max_attempts) throw new PublicJoinError("رابط التعديل غير صالح أو منتهي.", 410);
    applicationId = revision.application_id;
    const application = await admin.from("provider_applications").select("status").eq("id", applicationId).single();
    if (application.error) throw application.error;
    if (application.data.status !== "needs_changes") throw new PublicJoinError("الطلب غير متاح للتعديل.", 410);
    const result = await admin.from("provider_application_documents").select("document_type").eq("application_id", applicationId).eq("is_current", true);
    if (result.error) throw result.error;
    existing = (result.data || []).map(row => row.document_type);
  } else if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    throw new PublicJoinError("تعذر تأكيد معرّف المحاولة. أعد الإرسال.", 400);
  }
  let input: unknown;
  try { input = JSON.parse(String(data.get("documents") || "[]")); } catch { throw new PublicJoinError("بيانات المستندات غير صالحة.", 400); }
  if (!Array.isArray(input) || input.length > 4) throw new PublicJoinError("بيانات المستندات غير صالحة.", 400);
  const seen = new Set<string>();
  const documents: UploadDocument[] = input.map(value => {
    if (!value || typeof value !== "object") throw new PublicJoinError("بيانات المستند غير صالحة.", 400);
    const { documentType, name, mimeType, size } = value;
    if (!PROVIDER_DOCUMENT_TYPES.some(item => item.key === documentType) || seen.has(documentType)
      || typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)
      || !allowedMimeTypes.has(mimeType) || !Number.isSafeInteger(size) || size <= 0) throw new PublicJoinError("اختر مستند PDF أو صورة صالحة وغير فارغة لكل خانة.", 400);
    seen.add(documentType);
    return { id: randomUUID(), document_type: documentType, object_path: `join-applications/provider/${applicationId}/${randomBytes(24).toString("hex")}`, original_name: name, mime_type: mimeType, size_bytes: size };
  });
  if (PROVIDER_DOCUMENT_TYPES.some(item => !seen.has(item.key) && !existing.includes(item.key))) throw new PublicJoinError("أرفق المستندات الأربعة المطلوبة.", 400);
  const token = randomBytes(32).toString("hex");
  const batch = { id: randomUUID(), application_id: applicationId, token_hash: uploadHash(token), binding_hash: binding(data, idempotencyKey, revisionToken),
    revision_token_hash: revisionToken ? uploadHash(revisionToken) : null, documents, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  const insert = await admin.from("provider_upload_batches").insert(batch);
  if (insert.error) throw insert.error;
  const files = [];
  for (const document of documents) {
    const signed = await admin.storage.from("join-applications").createSignedUploadUrl(document.object_path, { upsert: false });
    if (signed.error) throw signed.error;
    files.push({ documentType: document.document_type, path: document.object_path, token: signed.data.token });
  }
  const url = new URL(getSupabasePublicEnv().url);
  if (url.hostname.endsWith(".supabase.co")) url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  return { uploadToken: token, endpoint: `${url.origin}/storage/v1/upload/resumable/sign`, bucket: "join-applications", files };
}

export async function resolveProviderUpload(data: FormData, idempotencyKey: string | null, revision?: { applicationId: string; token: string }, admin = createAdminClient()) {
  const token = String(data.get("uploadToken") || "");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new PublicJoinError("جلسة رفع المستندات غير صالحة. أعد الرفع.", 400);
  const { data: row, error } = await admin.from("provider_upload_batches").select("*").eq("token_hash", uploadHash(token)).maybeSingle();
  if (error) throw error;
  const batch = row as Batch | null;
  if (!batch || batch.binding_hash !== binding(data, idempotencyKey, revision?.token)
    || batch.revision_token_hash !== (revision ? uploadHash(revision.token) : null)
    || (revision && batch.application_id !== revision.applicationId)) throw new PublicJoinError("جلسة رفع المستندات غير صالحة لهذا الطلب.", 403);
  if (!batch.committed_at && Date.parse(batch.expires_at) <= Date.now()) throw new PublicJoinError("انتهت جلسة الرفع. أعد رفع المستندات.", 410);
  return batch;
}

export function validDocumentHeader(header: Uint8Array, mime: string) {
  const ascii = new TextDecoder().decode(header);
  return mime === "application/pdf" ? ascii.startsWith("%PDF-")
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
