export const PRODUCT_MEDIA_BUCKET = "provider-product-images";
export const PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const PRODUCT_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const MAX_PRODUCT_MEDIA = 6;

export function validProductMedia(type: string, size: number) {
  return Number.isSafeInteger(size) && size > 0 && (
    PRODUCT_IMAGE_TYPES.has(type) ? size <= 5 * 1024 ** 2
      : PRODUCT_VIDEO_TYPES.has(type) && size <= 100 * 1024 ** 2
  );
}

export function productPrimaryIndex(selection: string, media: { key: string; mimeType: string | null }[]) {
  const index = selection ? media.findIndex(item => item.key === selection)
    : media.findIndex(item => !item.mimeType || PRODUCT_IMAGE_TYPES.has(item.mimeType));
  if (index < 0 || (media[index].mimeType && !PRODUCT_IMAGE_TYPES.has(media[index].mimeType!))) return -1;
  return index;
}

export type UploadedProductMedia = { path: string; name: string; mimeType: string; size: number };
