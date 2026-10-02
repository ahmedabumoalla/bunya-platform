// Actual catalog table definitions, RLS, base-unit trigger and073/090 RPCs.
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
create table outbox_events(id uuid primary key default gen_random_uuid(),aggregate_type text,aggregate_id uuid,event_type text,payload jsonb,idempotency_key text);
create table notifications(id uuid primary key default gen_random_uuid(),profile_id uuid,actor_profile_id uuid,type text,title text,message text,action_url text,entity_type text,entity_id uuid,metadata jsonb,event_key text);
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
let passed = 0;
async function test(name, run) { await db.exec("begin"); try { await login(owner); await run(); passed++; console.log(`PASS ${name}`); } finally { await db.exec("rollback"); } }
async function rejected(run, pattern) { await db.exec("savepoint rejected_call"); try { await assert.rejects(run, pattern); } finally { await db.exec("rollback to savepoint rejected_call"); } }
async function proposed(overrides = {}, id = product) { const value = await snapshot(id); delete value.core.unit_price; delete value.core.vat_inclusive; value.core.name = "Updated catalog name"; Object.assign(value.core, overrides); return value; }

await test("migration preserves historical product prices and accepted quote values", async () => {
  assert.equal(Number((await row()).unit_price), 123.45); assert.equal((await row()).vat_inclusive, false);
  const accepted = (await db.query("select * from accepted_quote_fixture")).rows[0]; assert.equal(Number(accepted.unit_price), 150.75); assert.equal(accepted.vat_inclusive, true);
});
await test("new provider product without price persists NULL rather than zero", async () => {
  await db.exec("set local role authenticated"); await insertProduct(uid(30), { review_status: "draft", is_published: false }); await db.exec("reset role");
  assert.equal((await row(uid(30))).unit_price, null); assert.equal((await row(uid(30))).vat_inclusive, true);
});
await test("legacy native direct INSERT cannot inject unit price or VAT choice", async () => {
  await db.exec("set local role authenticated"); await insertProduct(uid(31), { unit_price: 777, vat_inclusive: false }); await db.exec("reset role");
  assert.equal((await row(uid(31))).unit_price, null); assert.equal((await row(uid(31))).vat_inclusive, true);
});
await test("direct provider UPDATE retains historical price and VAT while saving metadata", async () => {
  await db.exec("set local role authenticated");
  await db.query("update products set name='New metadata',unit_price=0,vat_inclusive=true where id=$1", [product]);
  await db.exec("reset role"); const p = await row(); assert.equal(p.name, "New metadata"); assert.equal(Number(p.unit_price), 123.45); assert.equal(p.vat_inclusive, false);
});
await test("unpriced product stays NULL through direct full-payload update", async () => {
  await insertProduct(uid(32)); await db.query("update products set unit_price=99,vat_inclusive=false,description='Updated description' where id=$1", [uid(32)]);
  assert.equal((await row(uid(32))).unit_price, null); assert.equal((await row(uid(32))).vat_inclusive, true);
});
await test("non-provider catalog product behavior is unchanged", async () => {
  await insertProduct(uid(33), { provider_id: null, unit_price: 42, vat_inclusive: false });
  await db.query("update products set unit_price=84,vat_inclusive=true where id=$1", [uid(33)]);
  assert.equal(Number((await row(uid(33))).unit_price), 84); assert.equal((await row(uid(33))).vat_inclusive, true);
});
await test("RLS still blocks inserting or changing another provider product", async () => {
  await db.exec("set local role authenticated"); await rejected(() => insertProduct(uid(34), { provider_id: otherProvider }), /row-level security/);
  await login(stranger); const result = await db.query("update products set name='Cross-provider attack' where id=$1 returning id", [product]); assert.equal(result.rows.length, 0);
  await db.exec("reset role"); assert.equal((await row()).name, "Catalog product");
});
await test("new change request accepts price-free core and excludes obsolete fields from proposed changes", async () => {
  const result = await submit(await proposed());
  const request = (await db.query("select * from product_change_requests where id=$1", [result.request_id])).rows[0];
  assert.equal("unit_price" in request.proposed_snapshot.core, false); assert.equal("vat_inclusive" in request.proposed_snapshot.core, false);
  assert.equal(Number(request.before_snapshot.core.unit_price), 123.45, "historical audit snapshot preserved");
  const coreChange = request.changes.find(change => change.field === "core"); assert.equal("unit_price" in coreChange.before, false); assert.equal("vat_inclusive" in coreChange.after, false);
  assert.equal((await row()).name, "Catalog product", "request does not mutate published product");
});
await test("obsolete change-RPC price/VAT keys are ignored even when not castable", async () => {
  const result = await submit(await proposed({ unit_price: "obsolete not a number", vat_inclusive: "obsolete not a boolean" }));
  await login(admin); await review(result.request_id);
  const p = await row(); assert.equal(p.name, "Updated catalog name"); assert.equal(Number(p.unit_price), 123.45); assert.equal(p.vat_inclusive, false);
});
await test("price-only and VAT-only attempts are not meaningful catalog changes", async () => {
  const value = await snapshot(); value.core.unit_price = 987; value.core.vat_inclusive = true;
  await rejected(() => submit(value), /No product data was changed/);
});
await test("price-free NULL product remains NULL after approved catalog changes", async () => {
  await insertProduct(uid(35)); await imageFor(uid(35));
  const result = await submit(await proposed({}, uid(35)), "null-product-change", uid(35)); await login(admin); await review(result.request_id);
  assert.equal((await row(uid(35))).unit_price, null); assert.equal((await row(uid(35))).name, "Updated catalog name");
});
await test("pre-migration pending change approves description but never obsolete pricing", async () => {
  await login(admin); await review(legacyRequest.request_id);
  const p = await row(legacyProduct); assert.equal(p.name, "Legacy changed name"); assert.equal(Number(p.unit_price), 88); assert.equal(p.vat_inclusive, false);
  const request = (await db.query("select * from product_change_requests where id=$1", [legacyRequest.request_id])).rows[0];
  assert.equal(Number(request.proposed_snapshot.core.unit_price), 999, "legacy request history not rewritten"); assert.equal(request.status, "approved");
});
await test("review remains admin-only and rejects unauthorized provider decisions", async () => {
  const request = await submit(await proposed()); await rejected(() => review(request.request_id), /permission required/);
  await login(stranger); await rejected(async () => submit(await proposed()), /membership required/);
  await login(null); await rejected(async () => submit(await proposed()), /Authentication required/);
});
await test("request and review idempotency preserve one approved change", async () => {
  const value = await proposed(); const request = await submit(value); const retry = await submit(value); assert.equal(retry.request_id, request.request_id); assert.equal(retry.replayed, true);
  await login(admin); await review(request.request_id); const repeated = await review(request.request_id); assert.equal(repeated.replayed, true);
  assert.equal(Number((await row()).unit_price), 123.45);
});
for (const [name, overrides, pattern] of [["invalid quantity", { minimum_order: 0 }, /Invalid product quantity/], ["limited stock", { availability_status: "limited", stock_quantity: 0 }, /Limited stock quantity/], ["missing rental duration", { offer_type: "rental", rental_duration_value: null, rental_duration_unit: null }, /Rental duration/], ["missing category", { category_id: null, custom_category: null }, /Choose a standard/], ["short description", { description: "short" }, /Complete the product/]]) await test(`nonpricing validation retained: ${name}`, async () => {
  await rejected(async () => submit(await proposed(overrides)), pattern);
});
await test("quantity, rental, images and specifications continue through approved changes", async () => {
  const value = await proposed({ minimum_order: 2, stock_quantity: 8, availability_status: "limited", offer_type: "rental", rental_duration_value: 3, rental_duration_unit: "days" });
  value.specifications = [{ value: "Durable finish", sort_order: 0 }]; value.measurements = [{ label: "Large", sort_order: 0, is_default: true }];
  const request = await submit(value); await login(admin); await review(request.request_id);
  const p = await row(); assert.equal(Number(p.minimum_order), 2); assert.equal(Number(p.stock_quantity), 8); assert.equal(p.offer_type, "rental"); assert.equal(Number(p.rental_duration_value), 3); assert.equal(Number(p.unit_price), 123.45);
  assert.equal((await db.query("select value from product_specifications where product_id=$1", [product])).rows[0].value, "Durable finish");
  assert.equal((await db.query("select label from product_measurements where product_id=$1", [product])).rows[0].label, "Large");
  assert.equal((await db.query("select count(*)::int as n from product_images where product_id=$1", [product])).rows[0].n, 1);
});
await test("anonymous RPC execution denied and rejected review leaves product untouched", async () => {
  await db.exec("set local role anon"); await rejected(() => submit({}), /permission denied/); await db.exec("reset role");
  const request = await submit(await proposed()); await login(admin); await review(request.request_id, "rejected");
  assert.equal((await row()).name, "Catalog product"); assert.equal(Number((await row()).unit_price), 123.45);
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='products'")).rows[0].relrowsecurity, true);
});
console.log(`${passed} provider catalog price-free migration regression checks passed.`);
await db.close();
