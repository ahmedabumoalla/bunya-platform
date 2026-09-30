"use client";

import { optimizeProviderDocument } from "./provider-client";

type UploadOptions = {
  idempotencyKey?: string;
  revisionToken?: string;
  onProgress?: (percent: number) => void;
};

type UploadBatch = {
  uploadToken: string;
  endpoint: string;
  bucket: "join-applications";
  files: { documentType: string; path: string; token: string }[];
};

export class ProviderUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProviderUploadError";
  }
}

/** Upload file bytes directly to private Storage; retain only the batch token for submission. */
export async function uploadProviderDocuments(data: FormData, options: UploadOptions = {}): Promise<void> {
  const documents: { documentType: string; file: File }[] = [];
  for (const [key, value] of Array.from(data.entries())) {
    if (!key.startsWith("document:") || !(value instanceof File)) continue;
    // Optimize sequentially so large documents do not compete for decoding memory.
    const file = await optimizeProviderDocument(value);
    data.set(key, file);
    documents.push({ documentType: key.slice("document:".length), file });
  }

  const metadata = new FormData();
  for (const [key, value] of data.entries()) {
    if (typeof value === "string" && !key.startsWith("document:")) metadata.append(key, value);
  }
  metadata.set("documents", JSON.stringify(documents.map(({ documentType, file }) => ({
    documentType, name: file.name, mimeType: file.type, size: file.size,
  }))));
  if (options.revisionToken) metadata.set("revisionToken", options.revisionToken);
  const response = await fetch("/api/public/join/provider/uploads", {
    method: "POST",
    body: metadata,
    headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
  });
  const body = await response.json().catch(() => null) as (UploadBatch & { message?: string }) | null;
  if (!response.ok) throw new ProviderUploadError(body?.message || "تعذر تجهيز رفع المستندات. حاول مرة أخرى.", response.status);
  if (!body?.uploadToken || !body.endpoint || body.bucket !== "join-applications" || !Array.isArray(body.files)
    || body.files.length !== documents.length) throw new Error("تعذر تجهيز رفع المستندات. حاول مرة أخرى.");

  const totalBytes = documents.reduce((sum, { file }) => sum + file.size, 0);
  let completedBytes = 0;
  let lastPercent = -1;
  const report = (uploadedBytes: number) => {
    const percent = totalBytes ? Math.min(100, Math.floor(uploadedBytes / totalBytes * 100)) : 100;
    if (percent !== lastPercent) { lastPercent = percent; options.onProgress?.(percent); }
  };
  report(0);
  // Lazy-load TUS only on submission. Signed object credentials never enter localStorage.
  const { Upload } = documents.length ? await import("tus-js-client") : { Upload: null };
  for (const { documentType, file } of documents) {
    const target = body.files.find((entry) => entry.documentType === documentType);
    if (!target?.path || !target.token || !Upload) throw new Error("تعذر تجهيز رفع المستندات. حاول مرة أخرى.");
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: body.endpoint,
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        uploadDataDuringCreation: true,
        storeFingerprintForResuming: false,
        headers: { "x-signature": target.token, "x-upsert": "false" },
        metadata: { bucketName: body.bucket, objectName: target.path, contentType: file.type, cacheControl: "3600" },
        onProgress: (bytesUploaded) => report(completedBytes + bytesUploaded),
        // Do not surface transport errors containing signed credentials or upload URLs.
        onError: (error) => {
          const status = "originalResponse" in error ? error.originalResponse?.getStatus() : undefined;
          reject(new Error(status === 413
            ? "حجم المستند يتجاوز السعة الحالية لخدمة التخزين. جرّب تقليل حجم الملف مع الحفاظ على وضوحه ثم أعد الإرسال."
            : "تعذر رفع المستندات بعد إعادة المحاولة. تحقق من اتصال الإنترنت وأعد الإرسال."));
        },
        onSuccess: () => resolve(),
      });
      upload.start();
    });
    completedBytes += file.size;
    report(completedBytes);
  }
  for (const { documentType } of documents) data.delete(`document:${documentType}`);
  data.set("uploadToken", body.uploadToken);
}
