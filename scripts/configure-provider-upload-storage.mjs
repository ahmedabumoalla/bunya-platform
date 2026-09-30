// Run with server credentials: node --env-file=.env.local scripts/configure-provider-upload-storage.mjs [--apply] [--max-project-size] [--contractor-videos]
// The optional project setting additionally requires SUPABASE_ACCESS_TOKEN (management API).
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
const bucketId = 'join-applications';
if (process.argv.includes('--max-project-size')) {
  if (!process.argv.includes('--apply') || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Project configuration requires --apply and management credentials');
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const url = `https://api.supabase.com/v1/projects/${ref}/config/storage`;
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  const updated = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fileSizeLimit: 500 * 1024 ** 3 }) });
  if (!updated.ok) throw new Error(`Storage project configuration refused (HTTP ${updated.status})`);
  const checked = await fetch(url, { headers });
  if (!checked.ok) throw new Error('Cannot verify project storage limit');
  const config = await checked.json();
  if (config.fileSizeLimit !== 500 * 1024 ** 3) throw new Error('Unexpected project storage limit');
  console.log(JSON.stringify({ projectFileSizeLimit: config.fileSizeLimit }));
}
const before = await client.storage.getBucket(bucketId);
if (before.error) throw new Error('Cannot inspect provider document bucket');
if (before.data.public) throw new Error('Provider documents must remain private');
if (process.argv.includes('--apply')) {
  const allowedMimeTypes = process.argv.includes('--contractor-videos')
    ? [...new Set([...(before.data.allowed_mime_types || ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']), 'video/mp4', 'video/webm', 'video/quicktime'])]
    : before.data.allowed_mime_types;
  const result = await client.storage.updateBucket(bucketId, { public: false, fileSizeLimit: null, allowedMimeTypes });
  if (result.error) throw new Error('Cannot update provider document bucket');
}
const after = await client.storage.getBucket(bucketId);
if (after.error) throw new Error('Cannot verify provider document bucket');
console.log(JSON.stringify({ bucket: bucketId, applied: process.argv.includes('--apply'), public: after.data.public, fileSizeLimit: after.data.file_size_limit, allowedMimeTypes: after.data.allowed_mime_types }));
