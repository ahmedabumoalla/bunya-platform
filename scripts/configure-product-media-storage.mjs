// node --env-file=.env.local scripts/configure-product-media-storage.mjs [--apply]
// Storage bucket settings are changed through the supported API, not internal tables.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const bucket = 'provider-product-images';
const before = await client.storage.getBucket(bucket);
if (before.error || before.data.public) throw new Error('Cannot safely inspect private product media bucket');
if (process.argv.includes('--apply')) {
  const updated = await client.storage.updateBucket(bucket, { public: false, fileSizeLimit: 100 * 1024 ** 2,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'] });
  if (updated.error) throw new Error('Cannot configure product media bucket');
}
const after = await client.storage.getBucket(bucket);
if (after.error) throw new Error('Cannot verify product media bucket');
console.log(JSON.stringify({ bucket, applied: process.argv.includes('--apply'), public: after.data.public,
  fileSizeLimit: after.data.file_size_limit, allowedMimeTypes: after.data.allowed_mime_types }));
