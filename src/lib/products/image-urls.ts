import type { SupabaseClient } from "@supabase/supabase-js";

type ProductImageSize = {
  width?: number;
  height?: number;
  quality?: number;
};

const signedImageCache = new Map<string, { url: string; expiresAt: number }>();

export async function signProductImage(
  db: SupabaseClient,
  storagePath: string | null | undefined,
  fallback = "",
  size: ProductImageSize = {},
) {
  const path = storagePath?.trim();
  if (!path) return fallback;
  const width = size.width ?? 640;
  const height = size.height ?? 640;
  const quality = size.quality ?? 70;
  const key = `${path}:${width}:${height}:${quality}`;
  const cached = signedImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const signed = await db.storage.from("provider-product-images").createSignedUrl(path, 21600, {
    transform: { width, height, resize: "cover", quality },
  });
  const url = signed.data?.signedUrl || fallback;
  if (url) signedImageCache.set(key, { url, expiresAt: Date.now() + 19_800_000 });
  return url;
}

export async function signProductImageMap(
  db: SupabaseClient,
  paths: Iterable<string>,
  size: ProductImageSize = {},
) {
  const unique = [...new Set([...paths].map((path) => path.trim()).filter(Boolean))];
  const urls = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += 8) {
    const chunk = unique.slice(offset, offset + 8);
    await Promise.all(
      chunk.map(async (path) => {
        const url = await signProductImage(db, path, "", size);
        if (url) urls.set(path, url);
      }),
    );
  }
  return urls;
}
