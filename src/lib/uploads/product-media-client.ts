"use client";

import { optimizeUploadFile } from "./client";
import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { PRODUCT_MEDIA_BUCKET, type UploadedProductMedia } from "@/lib/products/media";

/** Call only after an explicit rejected submission, never an unknown network outcome. */
export async function discardProductMedia(form: FormData) {
  const media = JSON.parse(String(form.get("uploaded_media") || "[]")) as UploadedProductMedia[];
  if (media.length) await createClient().storage.from(PRODUCT_MEDIA_BUCKET).remove(media.map(file => file.path)).catch(() => undefined);
}

/** Direct resumable uploads keep video bytes out of the application request and database. */
export async function uploadProductMedia(form: FormData, options: { productId?: string; onProgress?: (percent: number) => void } = {}) {
  const input = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
  if (!input.length) return;
  const files: File[] = [];
  for (const file of input) files.push(file.type.startsWith("image/") ? await optimizeUploadFile(file) : file);
  const response = await fetch("/api/provider/products/uploads", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: options.productId, files: files.map(file => ({ name: file.name, mimeType: file.type, size: file.size })) }) });
  const batch = await response.json() as { error?: string; productId: string; bucket: string; endpoint: string; files: (UploadedProductMedia & { token: string })[] };
  if (!response.ok) throw new Error(batch.error || "تعذر تجهيز رفع المرفقات.");
  const storageUrl = new URL(getSupabasePublicEnv().url);
  if (storageUrl.hostname.endsWith(".supabase.co")) storageUrl.hostname = storageUrl.hostname.replace(".supabase.co", ".storage.supabase.co");
  if (batch.bucket !== PRODUCT_MEDIA_BUCKET || batch.endpoint !== `${storageUrl.origin}/storage/v1/upload/resumable/sign` || batch.files?.length !== files.length) throw new Error("تعذر التحقق من وجهة الرفع.");
  const { Upload } = await import("tus-js-client");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index], target = batch.files[index];
      await new Promise<void>((resolve, reject) => {
        new Upload(file, {
          endpoint: batch.endpoint, chunkSize: 6 * 1024 ** 2, retryDelays: [0, 1000, 3000, 5000, 10000], uploadDataDuringCreation: true,
          storeFingerprintForResuming: false, headers: { "x-signature": target.token, "x-upsert": "false" },
          metadata: { bucketName: PRODUCT_MEDIA_BUCKET, objectName: target.path, contentType: file.type, cacheControl: "3600" },
          onProgress: bytes => options.onProgress?.(Math.min(100, Math.floor((completed + bytes) / total * 100))),
          onError: () => reject(new Error("تعذر رفع المرفقات. تحقق من اتصال الإنترنت وأعد المحاولة.")), onSuccess: () => resolve(),
        }).start();
      });
      completed += file.size;
    }
  } catch (error) {
    // No submission happened yet, so these new objects cannot be referenced by this form.
    await createClient().storage.from(PRODUCT_MEDIA_BUCKET).remove(batch.files.map(file => file.path)).catch(() => undefined);
    throw error;
  }
  form.delete("images");
  form.set("product_id", batch.productId);
  form.set("uploaded_media", JSON.stringify(batch.files.map(({ path, name, mimeType, size }) => ({ path, name, mimeType, size }))));
}
