import type { SupabaseClient } from "@supabase/supabase-js";

type ProductImageSize = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain";
};

export type ProductMediaSource = {
  storage_path?: string | null;
  image_url?: string | null;
  mime_type?: string | null;
};

export function isProductVideo(media: ProductMediaSource) {
  return media.mime_type?.toLowerCase().startsWith("video/") === true
    || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(media.storage_path || media.image_url || "");
}

const signedImageCache = new Map<string, { url: string; expiresAt: number }>();

export async function signProductImage(
  db: SupabaseClient,
  storagePath: string | null | undefined,
  fallback = "",
  size: ProductImageSize = {},
  mimeType?: string | null,
) {
  const path = storagePath?.trim();
  if (!path) return fallback;
  const width = size.width ?? 640;
  const height = size.height ?? 640;
  const quality = size.quality ?? 70;
  const resize = size.resize ?? "cover";
  const video = isProductVideo({ storage_path: path, mime_type: mimeType });
  const key = video ? `${path}:video` : `${path}:${width}:${height}:${quality}:${resize}`;
  const cached = signedImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const signed = await db.storage.from("provider-product-images").createSignedUrl(path, 21600, video ? undefined : {
    transform: { width, height, resize, quality },
  });
  const url = signed.data?.signedUrl || fallback;
  if (url) signedImageCache.set(key, { url, expiresAt: Date.now() + 19_800_000 });
  return url;
}

export async function signProductImageMap(
  db: SupabaseClient,
  paths: Iterable<string | ProductMediaSource>,
  size: ProductImageSize = {},
) {
  const sources = new Map<string, string | null | undefined>();
  for (const source of paths) {
    const path = (typeof source === "string" ? source : source.storage_path)?.trim();
    if (path) sources.set(path, typeof source === "string" ? sources.get(path) : source.mime_type);
  }
  const unique = [...sources.keys()];
  const urls = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += 8) {
    const chunk = unique.slice(offset, offset + 8);
    await Promise.all(
      chunk.map(async (path) => {
        const url = await signProductImage(db, path, "", size, sources.get(path));
        if (url) urls.set(path, url);
      }),
    );
  }
  return urls;
}
