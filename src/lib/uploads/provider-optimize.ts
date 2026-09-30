const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_EDGE = 2400;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_OPTIMIZATION_BYTES = 32 * 1024 * 1024;

async function optimizeImage(file: File): Promise<File> {
  if (file.size < 128 * 1024 || typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) return file;
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    // Retain more detail in already small scans; never lower resolution again
    // merely to reach an arbitrary byte target.
    const quality = Math.max(width, height) <= 1600 ? 0.8 : 0.72;
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    // Some engines silently return PNG when the WebP encoder is unavailable.
    if (blob.type !== "image/webp" || !blob.size || blob.size >= file.size) return file;
    const name = `${file.name.replace(/\.[^.]+$/, "") || "document"}.webp`;
    return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap?.close();
  }
}

async function optimizePdf(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Preserve byte-sensitive certificates before parsing; the object walk below
  // also catches signature dictionaries inside compressed object streams.
  if (/\/(?:ByteRange|Encrypt|Sig|DocMDP|Perms)\b/.test(new TextDecoder("latin1").decode(bytes))) return file;
  const { PDFDocument, PDFDict, PDFArray, PDFStream, PDFName } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (pdf.isEncrypted) return file;
  const visited = new WeakSet<object>();
  function isSensitive(value: unknown): boolean {
    if (!value || typeof value !== "object" || visited.has(value)) return false;
    visited.add(value);
    if (value instanceof PDFStream) return isSensitive(value.dict);
    if (value instanceof PDFArray) return value.asArray().some(isSensitive);
    if (!(value instanceof PDFDict)) return false;
    for (const [key, child] of value.entries()) {
      if (["ByteRange", "Encrypt", "DocMDP", "Perms", "XFA", "SigFlags"].includes(key.decodeText())) return true;
      if (child instanceof PDFName && ["Sig", "DocTimeStamp"].includes(child.decodeText())) return true;
      if (isSensitive(child)) return true;
    }
    return false;
  }
  if (pdf.context.enumerateIndirectObjects().some(([, value]) => isSensitive(value))) return file;
  // Repack existing objects only. Text, fonts, images, forms and page contents
  // remain intact; scanned pages are never rasterized or recompressed.
  const result = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
  if (!result.length || result.length >= file.size) return file;
  return new File([new Uint8Array(result)], file.name, { type: "application/pdf", lastModified: file.lastModified });
}

/** Run in a dedicated worker so decoding/parsing cannot block the form. */
export async function optimizeProviderDocumentInWorker(file: File): Promise<File> {
  if (!file.size || file.size > MAX_OPTIMIZATION_BYTES) return file;
  try {
    if (file.type === "application/pdf") return await optimizePdf(file);
    if (IMAGE_TYPES.has(file.type)) return await optimizeImage(file);
  } catch {
    // Malformed/protected documents and resource/codec failures retain the
    // original; the upload endpoint remains responsible for validation.
  }
  return file;
}
