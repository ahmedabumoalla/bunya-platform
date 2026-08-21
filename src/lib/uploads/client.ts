const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_EDGE = 2400;
const WEBP_QUALITY = 0.8;

function webpName(name: string) {
  return `${name.replace(/\.[^.]+$/, "") || "image"}.webp`;
}

async function optimizeVideoUpload(file: File) {
  try {
    const data = new FormData();
    data.set("file", file);
    const response = await fetch("/api/uploads/optimize", { method: "POST", body: data });
    if (!response.ok) return file;
    const blob = await response.blob();
    if (!blob.size || blob.size >= file.size) return file;
    const encodedName = response.headers.get("x-upload-file-name");
    const name = encodedName ? decodeURIComponent(encodedName) : file.name;
    return new File([blob], name, { type: blob.type || "video/mp4", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export async function optimizeUploadFile(file: File): Promise<File> {
  if (file.type === "video/mp4") return optimizeVideoUpload(file);
  if (!IMAGE_TYPES.has(file.type) || file.size < 128 * 1024 || typeof createImageBitmap === "undefined") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], webpName(file.name), { type: "image/webp", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export function optimizeUploadFiles(files: File[]) {
  return Promise.all(files.map(optimizeUploadFile));
}
