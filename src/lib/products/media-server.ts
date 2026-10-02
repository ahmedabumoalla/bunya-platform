import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedBytes, validDocumentHeader } from "@/lib/join/provider-upload-batches";
import { PublicJoinError } from "@/lib/join/security";
import { MAX_PRODUCT_MEDIA, PRODUCT_MEDIA_BUCKET, validProductMedia, type UploadedProductMedia } from "./media";

export async function verifiedProductMedia(form: FormData, providerId: string, productId: string): Promise<UploadedProductMedia[]> {
  const input = String(form.get("uploaded_media") || "[]");
  if (input.length > 16000) throw new PublicJoinError("بيانات المرفقات أكبر من الحد المسموح.", 400);
  let values: unknown;
  try { values = JSON.parse(input); } catch { throw new PublicJoinError("بيانات المرفقات غير صالحة.", 400); }
  if (!Array.isArray(values) || values.length > MAX_PRODUCT_MEDIA) throw new PublicJoinError("بيانات المرفقات غير صالحة.", 400);
  const seen = new Set<string>();
  const media = values.map((value): UploadedProductMedia => {
    if (!value || typeof value !== "object") throw new PublicJoinError("بيانات المرفق غير صالحة.", 400);
    const { path, name, mimeType, size } = value;
    const prefix = `${providerId}/${productId}/uploads/`;
    if (typeof path !== "string" || !path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$/.test(path.slice(prefix.length))
      || seen.has(path) || typeof name !== "string" || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)
      || typeof mimeType !== "string" || !validProductMedia(mimeType, size)) throw new PublicJoinError("أحد المرفقات غير صالح لهذا المنتج.", 400);
    seen.add(path);
    return { path, name, mimeType, size };
  });
  if (!media.length) return [];
  const bucket = createAdminClient().storage.from(PRODUCT_MEDIA_BUCKET);
  for (const item of media) {
    const info = await bucket.info(item.path);
    if (info.error || Number(info.data?.size) !== item.size || info.data?.contentType !== item.mimeType) throw new PublicJoinError("رفع أحد المرفقات غير مكتمل. أعد المحاولة.", 400);
    const signed = await bucket.createSignedUrl(item.path, 60);
    if (signed.error || !signed.data) throw new Error("product_media_sign_failed");
    const response = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-11" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (response.status !== 206 || !response.body) { await response.body?.cancel(); throw new PublicJoinError("تعذر التحقق من المرفق. أعد المحاولة.", 503); }
    const header = await readBoundedBytes(response.body, 12);
    if (!validDocumentHeader(header, item.mimeType)) throw new PublicJoinError("محتوى المرفق لا يطابق نوع الملف.", 400);
  }
  return media;
}
