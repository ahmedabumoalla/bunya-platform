// Actual091 resubmission, primary-media selection, review history and RLS regressions.
// Isolated PostgreSQL only: no live objects, credentials or messages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uid(1), admin = uid(2), stranger = uid(3), provider = uid(10), otherProvider = uid(11), product = uid(20), legacyProduct = uid(21);
const base = (await readFile(new URL("../supabase/migrations/001_bunya_production_schema.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
await db.exec(`
create schema auth; create schema storage; create schema extensions;
create role anon; create role authenticated; create role service_role bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(id uuid primary key);
create table providers(id uuid primary key,owner_profile_id uuid references profiles,company_name text);
create table admin_users(id uuid primary key,profile_id uuid references profiles,is_active boolean);
create table product_categories(id uuid primary key,name text,is_active boolean default true);
create table product_brands(id uuid primary key);
create table files(id uuid primary key);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function public.is_provider_member(p_id uuid) returns boolean language sql security definer set search_path=public,pg_temp as $$ select exists(select 1 from providers where id=p_id and owner_profile_id=auth.uid()) $$;
create function public.is_admin() returns boolean language sql security definer set search_path=public,pg_temp as $$ select exists(select 1 from admin_users where profile_id=auth.uid() and is_active) $$;
create function public.admin_has_permission(text) returns boolean language sql security definer set search_path=public,pg_temp as $$ select public.is_admin() $$;
create function public.safe_storage_folder_uuid(text) returns uuid language sql immutable as $$ select nullif(split_part($1,'/',1),'')::uuid $$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;
create table audit_logs(id uuid primary key default gen_random_uuid(),actor_profile_id uuid,provider_id uuid,entity_table text,entity_id text,action text,old_data jsonb,new_data jsonb);
create table outbox_events(id uuid primary key default gen_random_uuid(),aggregate_type text,aggregate_id uuid,event_type text,payload jsonb,idempotency_key text,status text default 'pending',processed_at timestamptz);
create table notifications(id uuid primary key default gen_random_uuid(),profile_id uuid,actor_profile_id uuid,type text,title text,message text,action_url text,entity_type text,entity_id uuid,metadata jsonb,event_key text);
create unique index outbox_events_idempotency on outbox_events(idempotency_key) where idempotency_key is not null;
create unique index notifications_event_unique on notifications(event_key) where event_key is not null;
insert into profiles values('${owner}'),('${admin}'),('${stranger}');
insert into providers values('${provider}','${owner}','Fixture provider'),('${otherProvider}','${stranger}','Other provider');
insert into admin_users values('${uid(4)}','${admin}',true);
insert into product_categories values('${uid(5)}','Building',true);
`);
for (const name of ["product_availability_status", "product_image_tone", "product_review_status", "product_offer_type"]) await db.exec(base.match(new RegExp(`create type public\\.${name} as enum[^;]+;`))[0]);
for (const name of ["products", "product_variants", "product_images", "product_units", "product_measurements", "product_specifications", "product_warranties", "product_availability_regions", "product_delivery_configs", "product_delivery_regions"]) await db.exec(base.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
await db.exec(base.match(/alter table public\.products\n  add column provider_id[\s\S]*?\n  \);/)[0]);
await db.exec(base.match(/alter table public\.product_images\n  add column storage_path[\s\S]*?;/)[0]);
await db.exec(base.match(/alter table public\.product_warranties\n[\s\S]*?\n  \);/)[0]);
await db.exec(`alter table products add column custom_category text; alter table products alter column category_id drop not null;
alter table products add constraint products_category_shape check((category_id is not null and custom_category is null) or(category_id is null and custom_category is not null and length(btrim(custom_category)) between 2 and 80));
alter table product_units add column is_base boolean not null default false;
create unique index product_units_one_base_idx on product_units(product_id) where is_base;
alter table products enable row level security;
grant select,insert,update,delete on products to authenticated;
grant usage on schema auth to authenticated;
`);
await db.exec(base.match(/create policy products_provider_manage[\s\S]*?;/)[0]);
await db.exec(await migration("033_sync_product_base_units.sql"));
await db.exec(await migration("073_product_change_request_workflow.sql"));
const login = id => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ""]);
async function insertProduct(id, extra = {}) {
  const row = { id, category_id: uid(5), provider_id: provider, slug: `fixture-${id}`, name: "Catalog product", base_unit: "piece", short_description: "Product description", description: "Product description", full_description: "Product description", availability_summary: "Available", lead_time_label: "One day", delivery_label: "Agreed delivery", delivery_window: "Two days", delivery_notes: "Site access required", is_published: true, review_status: "approved", ...extra };
  const keys = Object.keys(row);
  await db.query(`insert into products(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
}
async function imageFor(id) { await db.query("insert into product_images(product_id,label,alt_text,tone,image_url,is_primary) values($1,'Photo','Product photo','tools','https://example.invalid/fixture.webp',true)", [id]); }
const snapshot = async (id = product) => (await db.query("select capture_product_change_snapshot($1) as snapshot", [id])).rows[0].snapshot;
const row = async (id = product) => (await db.query("select * from products where id=$1", [id])).rows[0];
const submit = async (proposal, key = "change-request-0001", id = product) => (await db.query("select submit_product_change_request($1,$2::jsonb,'Update catalog description',$3) as result", [id, JSON.stringify(proposal), key])).rows[0].result;
const review = async (id, decision = "approved", key = "decision-0001") => (await db.query("select review_product_change_request($1,$2,'Reviewed catalog changes',$3) as result", [id, decision, key])).rows[0].result;
await login(owner);
await insertProduct(product, { unit_price: 123.45, vat_inclusive: false }); await imageFor(product);
await insertProduct(legacyProduct, { unit_price: 88, vat_inclusive: false }); await imageFor(legacyProduct);
const legacy = await snapshot(legacyProduct); legacy.core.name = "Legacy changed name"; legacy.core.unit_price = 999; legacy.core.vat_inclusive = true;
const legacyRequest = await submit(legacy, "legacy-change-0001", legacyProduct);
await db.exec(`create table accepted_quote_fixture(id uuid primary key,product_id uuid references products,unit_price numeric,vat_inclusive boolean); insert into accepted_quote_fixture values('${uid(99)}','${product}',150.75,true);`);
await db.exec(await migration("090_provider_catalog_without_prices.sql"));

const correction = uid(22);
await insertProduct(correction,{review_status:'needs_changes',is_published:false}); await imageFor(correction);
await db.exec(base.match(/create table public\.product_review_decisions \([\s\S]*?\n\);/)[0]);
await db.exec(base.match(/create table public\.product_review_history \([\s\S]*?\n\);/)[0]);
await db.exec(`alter table product_review_decisions enable row level security; grant select,insert,update,delete on product_review_decisions to authenticated;
alter table product_images enable row level security; grant select,insert,update,delete on product_images to authenticated;
grant usage on schema storage to authenticated; grant select on storage.objects to authenticated;
create unique index product_images_one_primary_idx on product_images(product_id) where is_primary;`);
await db.exec(base.match(/create policy product_reviews_manage[^;]+;/)[0]);
await db.exec(base.match(/create policy product_images_provider_manage[\s\S]*?;/)[0]);
await db.exec(base.match(/create or replace function public\.log_product_review_status\(\)[\s\S]*?\$\$;/)[0]);
await db.exec(base.match(/create trigger products_log_review_status[^;]+;/)[0]);
await db.exec(await migration('022_notify_admins_product_review.sql'));
await db.exec(await migration('023_allow_internal_product_review_notifications.sql'));
await db.exec(await migration('024_enqueue_product_review_whatsapp.sql'));
await db.exec(await migration('032_product_review_actions.sql'));
await db.query("insert into product_review_decisions(product_id,admin_user_id,outcome,reason,before_data,after_data) values($1,$2,'needs_changes','Improve the product description','{}','{}')",[correction,uid(4)]);
await db.exec(await migration('091_provider_product_correction_resubmission.sql'));
const asClient = async () => db.exec('set local role authenticated');
const asOwner = async () => { await db.exec('reset role'); await login(owner); };
const normalReview = async (decision='needs_changes',key='normal-review-0001') => (await db.query("select review_product($1,$2,'Please improve the supplied details',$3) as result",[correction,decision,key])).rows[0].result;
let passed = 0;
async function test(name, run) { await db.exec('begin'); try { await login(owner); await run(); passed++; console.log(`PASS ${name}`); } finally { await db.exec('rollback'); } }
async function rejected(run, pattern) { await db.exec('savepoint rejected_call'); try { await assert.rejects(run, pattern); } finally { await db.exec('rollback to savepoint rejected_call'); } }
async function proposed(overrides = {}, id = correction) { const value=await snapshot(id); delete value.core.unit_price; delete value.core.vat_inclusive; value.core.name='Corrected catalog name'; Object.assign(value.core,overrides); return value; }
const submitCorrection = async (value,key='correct-request-0001') => submit(value,key,correction);
const image = (primary=false) => ({image_url:'https://example.invalid/alternate.webp',mime_type:'image/webp',file_size_bytes:20,is_primary:primary});
const video = (type='video/mp4',primary=false) => ({image_url:'https://example.invalid/video.mp4',mime_type:type,file_size_bytes:104857600,is_primary:primary});
const count = async (table,where='true') => (await db.query(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n;

await test('correction applies full snapshot atomically to same UUID, unpublished and pending review',async()=>{
 const value=await proposed(); value.core.stock_quantity=8; value.measurements=[{label:'Large'}]; value.variants=[{name:'Blue',attributes:{color:'blue'},is_active:true}]; value.specifications=[{value:'Weather resistant'}]; value.warranty={duration_value:2,duration_unit:'years',details:'Manufacturer coverage'}; value.availability_regions=[{city:'Riyadh',scope:'city'}]; value.delivery_regions=[{region_name:'Riyadh'}]; value.delivery_config={is_available:true,maximum_duration:3,duration_unit:'days',price_per_km:2,maximum_distance_km:50,notes:'Site access'}; value.images=[image(false),image(true),video()];
 await asClient(); const result=await submitCorrection(value); await db.exec('reset role');
 assert.equal(result.product_id,correction); assert.equal(result.review_status,'pending_review'); assert.equal(result.replayed,false);
 const p=await row(correction); assert.equal(p.name,'Corrected catalog name'); assert.equal(p.is_published,false); assert.equal(p.review_status,'pending_review'); assert.equal(p.unit_price,null);
 for(const table of ['product_measurements','product_variants','product_specifications','product_warranties','product_availability_regions','product_delivery_regions','product_delivery_configs']) assert.equal(await count(table,`product_id='${correction}'`),1,table);
 assert.equal((await db.query('select sort_order from product_images where product_id=$1 and is_primary',[correction])).rows[0].sort_order,1);
 assert.equal(await count('product_change_requests',`product_id='${correction}'`),0);
 const audit=(await db.query("select old_data,new_data from audit_logs where action='product_resubmitted'")).rows[0]; assert.equal(audit.old_data.core.name,'Catalog product'); assert.equal(audit.new_data.snapshot.core.name,value.core.name);
 assert.equal(await count('product_review_decisions',`product_id='${correction}'`),1); assert.equal(await count('product_review_history',`product_id='${correction}' and to_status='pending_review'`),1);
 assert.equal(await count('notifications',`entity_id='${correction}' and type='admin.product_pending_review'`),1);
 assert.equal(await count('outbox_events',`aggregate_id='${correction}' and event_type='admin.product_pending_review'`),1);
 assert.equal(await count('outbox_events',`id='${result.event_id}' and status='processed' and event_type='product.resubmitted'`),1);
});
await test('retry returns receipt without applying or notifying twice',async()=>{
 const value=await proposed(); const first=await submitCorrection(value); value.core.name='Retry must not change data'; const replay=await submitCorrection(value);
 assert.equal(replay.replayed,true); assert.equal(replay.event_id,first.event_id); assert.equal((await row(correction)).name,'Corrected catalog name'); assert.equal(await count('audit_logs',"action='product_resubmitted'"),1); assert.equal(await count('notifications',`entity_id='${correction}'`),1);
});
await test('another review correction round emits fresh notification and preserves earlier decisions',async()=>{
 await submitCorrection(await proposed()); await login(admin); await asClient(); await normalReview(); await asOwner(); await submitCorrection(await proposed({name:'Second corrected name'}),'correct-request-0002');
 assert.equal(await count('product_review_decisions',`product_id='${correction}'`),2); assert.equal(await count('outbox_events',`aggregate_id='${correction}' and event_type='admin.product_pending_review'`),2); assert.equal(await count('notifications',`entity_id='${correction}'`),2);
 await login(admin); await asClient(); await normalReview('approved','normal-review-0002'); await db.exec('reset role'); assert.equal((await row(correction)).is_published,true);
});
await test('review reasons readable only for owning provider and admin, providers cannot rewrite or delete them',async()=>{
 await asClient(); assert.equal(await count('product_review_decisions'),1);
 await db.exec("update product_review_decisions set reason='Forged reason'"); assert.equal((await db.query('select reason from product_review_decisions')).rows[0].reason,'Improve the product description'); await db.exec('delete from product_review_decisions'); assert.equal(await count('product_review_decisions'),1);
 await login(stranger); assert.equal(await count('product_review_decisions'),0); await login(admin); assert.equal(await count('product_review_decisions'),1);
});
await test('foreign provider and anonymous callers cannot submit corrections or inspect replay',async()=>{
 const value=await proposed(); await submitCorrection(value); await login(stranger); await asClient(); await rejected(()=>submitCorrection(value),/membership/); await db.exec('reset role'); await db.exec('set local role anon'); await rejected(()=>submitCorrection(value),/permission denied/);
});
await test('approved product still queues changes without modifying published product until admin review',async()=>{
 const value=await proposed({},product); value.images=[image(false),image(true)]; await asClient(); const request=await submit(value); await db.exec('reset role'); assert.ok(request.request_id); assert.equal((await row()).name,'Catalog product'); assert.equal((await row()).is_published,true);
 await login(admin); await review(request.request_id); assert.equal((await row()).name,value.core.name); assert.equal(Number((await row()).unit_price),123.45); assert.equal((await db.query('select sort_order from product_images where product_id=$1 and is_primary',[product])).rows[0].sort_order,1);
});
await test('old pending request approval keeps historical price and old explicit image cover',async()=>{
 await login(admin); await review(legacyRequest.request_id); assert.equal(Number((await row(legacyProduct)).unit_price),88); assert.equal((await row(legacyProduct)).vat_inclusive,false);
});
await test('legacy images with omitted primary flags choose first image even after a video',async()=>{
 const value=await proposed(); value.images=[video(),image(),image()]; for(const media of value.images) delete media.is_primary; await submitCorrection(value);
 assert.equal((await db.query('select sort_order from product_images where product_id=$1 and is_primary',[correction])).rows[0].sort_order,1);
});
for(const [name,media,pattern] of [
 ['two primary images',[image(true),image(true)],/Exactly one/],
 ['explicitly absent cover',[image(false)],/Exactly one/],
 ['video cover',[image(false),video('video/mp4',true)],/must be an image/],
 ['no image',[video()],/At least one/],
 ['too many media',Array.from({length:7},(_,i)=>image(i===0)),/One to six/],
 ['oversized image',[{...image(true),file_size_bytes:5242881}],/size exceeds/],
 ['oversized video',[image(true),{...video(),file_size_bytes:104857601}],/size exceeds/],
 ['unsupported media',[{...image(true),mime_type:'application/pdf'}],/Unsupported/],
 ['nonboolean primary',[{...image(true),is_primary:'true'}],/Invalid primary/],
]) await test(`rejects ${name} before modifying correction`,async()=>{
 const value=await proposed(); value.images=media; await rejected(()=>submitCorrection(value),pattern); assert.equal((await row(correction)).review_status,'needs_changes'); assert.equal((await row(correction)).name,'Catalog product'); assert.equal(await count('audit_logs',"action='product_resubmitted'"),0);
});
await test('all three accepted video MIME types persist up to 100MiB',async()=>{
 const value=await proposed(); value.images=[image(true),video('video/mp4'),video('video/webm'),video('video/quicktime')]; await submitCorrection(value); assert.equal(await count('product_images',`product_id='${correction}' and mime_type like 'video/%'`),3);
});
await test('late child constraint failure rolls back product, media, receipt, audit and notices',async()=>{
 const value=await proposed(); value.warranty={duration_value:-2,duration_unit:'years'};
 await rejected(()=>submitCorrection(value),/check constraint/); assert.equal((await row(correction)).name,'Catalog product'); assert.equal((await row(correction)).review_status,'needs_changes'); assert.equal(await count('outbox_events',`aggregate_id='${correction}'`),0); assert.equal(await count('product_images',`product_id='${correction}'`),1); assert.equal(await count('audit_logs',"action='product_resubmitted'"),0);
});
await test('pending, rejected and draft products cannot enter correction route',async()=>{
 for(const status of ['pending_review','rejected','draft']) { await db.query('update products set review_status=$1 where id=$2',[status,correction]); const value=await proposed(); await rejected(()=>submitCorrection(value),/Only approved/); }
});
await test('requesting clarification does not require a fake metadata difference to resubmit',async()=>{
 const value=await snapshot(correction); const result=await submitCorrection(value); assert.equal(result.review_status,'pending_review');
});
await test('clients cannot publish products directly, change reviewed metadata or forge a trusted marker',async()=>{
 await asClient(); await db.exec("select set_config('bunya.internal_product_review','on',true)");
 await rejected(()=>db.query("update products set review_status='approved',is_published=true where id=$1",[correction]),/authorized command/);
 await rejected(()=>db.query("update products set name='Bypass name' where id=$1",[product]),/authorized command/);
 await rejected(()=>insertProduct(uid(40)),/authorized review/);
});
await test('reviewed product media rejects direct owner insert, update and delete',async()=>{
 await asClient(); await rejected(()=>db.query('delete from product_images where product_id=$1',[correction]),/authorized command/);
 await rejected(()=>db.query("update product_images set image_url='https://example.invalid/bypass.webp' where product_id=$1",[product]),/authorized command/);
 await rejected(()=>imageFor(correction),/authorized command/);
});
await test('native draft upload and submit remain available, wrong namespace is denied',async()=>{
 const id=uid(41), path=`${provider}/${id}/original.webp`; await db.query("insert into storage.objects(bucket_id,name) values('provider-product-images',$1)",[path]);
 await asClient(); await insertProduct(id,{review_status:'draft',is_published:false});
 await rejected(()=>db.query("insert into product_images(product_id,label,alt_text,tone,storage_path,is_primary) values($1,'Main','Photo','tools',$2,true)",[id,`${otherProvider}/${id}/foreign.webp`]),/owned uploaded object/);
 await db.query("insert into product_images(product_id,label,alt_text,tone,storage_path,mime_type,file_size_bytes,is_primary) values($1,'Main','Photo','tools',$2,'image/webp',5242880,true)",[id,path]);
 await db.query('select submit_product_for_review($1)',[id]); await db.exec('reset role'); assert.equal((await row(id)).review_status,'pending_review');
 await asClient(); await rejected(()=>db.query('select submit_product_for_review($1)',[correction]),/current status/);
});
await test('submission rejects missing or foreign-provider uploaded objects',async()=>{
 const value=await proposed(); value.images=[{...image(true),storage_path:`${otherProvider}/${correction}/foreign.webp`}];
 await db.query("insert into storage.objects(bucket_id,name) values('provider-product-images',$1)",[value.images[0].storage_path]);
 await rejected(()=>submitCorrection(value),/unavailable/); value.images[0].storage_path=`${provider}/${correction}/missing.webp`; await rejected(()=>submitCorrection(value),/unavailable/);
});
await test('changed base unit is synchronized during atomic correction',async()=>{
 const value=await proposed({base_unit:'box'}); await submitCorrection(value); assert.equal((await row(correction)).base_unit,'box'); assert.equal((await db.query('select name from product_units where product_id=$1 and is_base',[correction])).rows[0].name,'box');
});
await test('internal snapshot/media helpers cannot be called by authenticated or anonymous clients',async()=>{
 for(const role of ['authenticated','anon']) {await db.exec(`set local role ${role}`); await rejected(()=>db.query("select apply_product_catalog_snapshot($1,'{}',$1)",[product]),/permission denied/); await rejected(()=>db.query("select normalize_product_catalog_media('[]')"),/permission denied/); await db.exec('reset role');}
});
await test('admin visibility changes preserve approval/data and control public RLS reads',async()=>{
 await db.exec(base.match(/create policy products_public_read[^;]+;/)[0]);
 await db.exec(base.match(/create policy products_admin_manage[^;]+;/)[0]);
 await db.exec(base.match(/alter policy products_admin_manage[^;]+;/)[0]);
 await db.exec('grant select on products to anon; grant usage on schema auth to anon');
 const before=await row();
 await login(admin); await asClient();
 assert.equal((await db.query("update products set is_published=false where id=$1 and review_status='approved' returning id",[product])).rows.length,1);
 await db.exec('reset role');
 const after=await row(); assert.equal(after.is_published,false);
 assert.deepEqual({...after,is_published:true},before,'only publication changes');
 await login(null); await db.exec('set local role anon');
 assert.equal((await db.query('select id from products where id=$1',[product])).rows.length,0);
 await db.exec('reset role'); await login(owner); await asClient();
 await rejected(()=>db.query('update products set is_published=true where id=$1',[product]),/authorized command/);
 await db.exec('reset role'); await login(stranger); await asClient();
 assert.equal((await db.query('update products set is_published=true where id=$1 returning id',[product])).rows.length,0);
 await db.exec('reset role'); await login(admin); await asClient();
 assert.equal((await db.query("update products set is_published=true where id=$1 and review_status='approved' returning id",[product])).rows.length,1);
 await db.exec('reset role'); await login(null); await db.exec('set local role anon');
 assert.equal((await db.query('select id from products where id=$1',[product])).rows.length,1);
});
console.log(`${passed} product correction and media SQL regression checks passed.`);
await db.close();
