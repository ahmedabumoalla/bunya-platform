// Server-only: node --env-file=.env.local scripts/copy-admin-archive-files.mjs [--apply]
// Requires captured data and exposed admin_archive schema. Never activates accounts.
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const bucket = 'admin-archive';
const status = await admin.rpc('admin_archive_actor_status',{p_actor:'7f4152b6-63d2-49ec-866f-681a3308f670'});
if(status.error||!status.data?.capture_complete||status.data.active)throw new Error('An inactive, complete snapshot is required');
const rows = await admin.schema('admin_archive').from('archive_storage_objects').select('id,bucket_id,name,metadata').order('id');
if(rows.error)throw new Error('Cannot read captured file manifest');
const files = rows.data;
const summary = {capturedAt:status.data.captured_at,files:files.length,bytes:files.reduce((n,f)=>n+Number(f.metadata?.size||0),0),applied:false};
if(!process.argv.includes('--apply')){console.log(JSON.stringify(summary));process.exit(0);}
const existing = await admin.storage.getBucket(bucket);
if(existing.error){const created=await admin.storage.createBucket(bucket,{public:false});if(created.error)throw new Error('Cannot create private archive bucket');}
else if(existing.data.public)throw new Error('Refusing to use a public archive bucket');
const digest = bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest = [];
for(const file of files){
  const source = await admin.storage.from(file.bucket_id).download(file.name);
  if(source.error||!source.data)throw new Error('Captured source file is unavailable; archive remains inactive');
  const bytes = Buffer.from(await source.data.arrayBuffer());
  if(file.metadata?.size!=null&&bytes.length!==Number(file.metadata.size))throw new Error('Source file size changed after capture');
  const sha256 = digest(bytes), name = `${file.bucket_id}/${file.name}`;
  let target = await admin.storage.from(bucket).download(name);
  if(target.error){
    const copied = await admin.storage.from(bucket).upload(name,bytes,{contentType:source.data.type||file.metadata?.mimetype||'application/octet-stream',upsert:false});
    if(copied.error)throw new Error('Archive file copy failed');
    target = await admin.storage.from(bucket).download(name);
  }
  if(target.error||!target.data||digest(Buffer.from(await target.data.arrayBuffer()))!==sha256)throw new Error('Archive file checksum mismatch');
  manifest.push({object_id:file.id,bucket_id:bucket,name,sha256});
}
const ready = await admin.rpc('admin_archive_mark_files_ready',{p_expected_cutoff:status.data.captured_at,p_manifest:manifest});
await mkdir('tmp',{recursive:true});
await writeFile('tmp/admin-archive-file-manifest.json',JSON.stringify({capturedAt:status.data.captured_at,manifest},null,2)+'\n');
if(ready.error)throw new Error(`File manifest verification failed (${ready.error.code}: ${ready.error.message}); archive remains inactive`);
console.log(JSON.stringify({...summary,applied:true,checksumsVerified:manifest.length,activated:false}));
