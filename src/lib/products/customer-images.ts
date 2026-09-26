import { createClient } from "@/lib/supabase/client";
import { signProductImage } from "./image-urls";

type PendingImage = { id: string; resolve: (url: string) => void };
const cache = new Map<string, { expiresAt: number; result: Promise<string> }>();
const queue: PendingImage[] = [];
let scheduled = false;

// One query per group of mounted products; repeat appearances reuse the result.
export function customerProductImage(productId: string, viewerId: string): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(productId)) return Promise.resolve("");
  const key = `${viewerId}:${productId}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.result;
  const result = new Promise<string>(resolve => queue.push({ id: productId, resolve }));
  cache.set(key, { expiresAt: Date.now() + 300_000, result });
  if (cache.size > 500) for (const [entry, value] of cache) if (value.expiresAt < Date.now()) cache.delete(entry);
  if (!scheduled) { scheduled = true; queueMicrotask(() => { void flush(); }); }
  return result;
}

async function flush() {
  const pending = queue.splice(0);
  scheduled = false;
  for (let start = 0; start < pending.length; start += 50) {
    const batch = pending.slice(start, start + 50);
    try {
      const db = createClient();
      const result = await db.from("product_images")
        .select("product_id,image_url,storage_path,is_primary,sort_order")
        .in("product_id", [...new Set(batch.map(item => item.id))])
        .order("is_primary", { ascending: false }).order("sort_order");
      if (result.error) throw result.error;
      const firstImages = new Map<string, { storage_path: string | null; image_url: string | null }>();
      for (const image of result.data ?? []) {
        if (!firstImages.has(image.product_id) && (image.storage_path || image.image_url)) firstImages.set(image.product_id, image);
      }
      const urls = new Map<string, string>();
      const images = [...firstImages];
      for (let offset = 0; offset < images.length; offset += 8) {
        await Promise.all(images.slice(offset, offset + 8).map(async ([id, source]) => {
          const url = await signProductImage(db, source.storage_path, source.image_url ?? "", { width: 640, height: 640, quality: 80, resize: "contain" });
          urls.set(id, url);
        }));
      }
      batch.forEach(item => item.resolve(urls.get(item.id) ?? ""));
    } catch { batch.forEach(item => item.resolve("")); }
  }
}
