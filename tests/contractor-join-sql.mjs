// Actual contractor migration087 against isolated PostgreSQL. No live database or messages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const applicationId = uid(1), reviewerId = uid(2), applicantId = uid(3);
let passed = 0;
async function test(name, fn) {
  await db.exec("begin");
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  finally { await db.exec("rollback"); }
}
async function rejected(fn, pattern) {
  await db.exec("savepoint rejected_call");
  try { await assert.rejects(fn, pattern); } finally { await db.exec("rollback to savepoint rejected_call"); }
}
async function count(table) { return (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n; }

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create table platform_policies(id uuid primary key default gen_random_uuid(),policy_key text unique not null,title text not null,summary text,body jsonb,version integer,is_published boolean,updated_at timestamptz not null default now());
create table provider_applications(id uuid primary key,company_name text not null,contact_name text not null constraint provider_applications_contact_not_blank check(length(btrim(contact_name))>0),discount_code text,email text not null,mobile text not null,requested_username text,google_maps_url text,latitude numeric,longitude numeric,delivery_available boolean,status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now(),reviewed_by uuid,reviewed_at timestamptz,review_notes text,applicant_profile_id uuid,public_idempotency_key text unique);
create table providers(id uuid primary key default gen_random_uuid(),owner_profile_id uuid,application_id uuid references provider_applications,company_name text not null,contact_name text not null,mobile text,email text,google_maps_url text,latitude numeric,longitude numeric,status text,reviewed_by uuid,reviewed_at timestamptz,review_notes text);
create table files(id uuid primary key,owner_profile_id uuid,bucket_id text not null,object_path text not null unique,purpose text,original_name text not null,mime_type text not null,size_bytes bigint not null,checksum_sha256 text,uploaded_at timestamptz);
create table provider_application_documents(id uuid primary key default gen_random_uuid(),application_id uuid not null references provider_applications,file_id uuid not null references files,document_type text not null);
create table provider_application_categories(application_id uuid references provider_applications,custom_category text);
create table provider_delivery_regions(application_id uuid references provider_applications,region_name text);
create table join_application_revision_tokens(id uuid primary key default gen_random_uuid(),token_hash text unique,application_kind text,application_id uuid,used_at timestamptz,expires_at timestamptz,attempts integer default 0,max_attempts integer default 5);
create table profiles(id uuid primary key,role text,username text,full_name text not null,mobile text,email text,is_active boolean,must_change_password boolean,temporary_password_issued_at timestamptz,temporary_password_expires_at timestamptz,password_changed_at timestamptz,updated_at timestamptz);
create table admin_roles(id uuid primary key,role_key text);
create table admin_users(id uuid primary key,profile_id uuid,role_id uuid references admin_roles,is_active boolean);
create table admin_permissions(id uuid primary key,permission_key text);
create table admin_role_permissions(role_id uuid,permission_id uuid);
create table customer_profiles(profile_id uuid);
create table user_roles(profile_id uuid,role text,is_primary boolean,granted_by uuid,revoked_at timestamptz);
create unique index user_roles_active on user_roles(profile_id,role) where revoked_at is null;
create table provider_profiles(provider_id uuid,username text,delivery_available boolean);
create table provider_members(provider_id uuid,profile_id uuid,member_role text,is_active boolean);
create table provider_settings(provider_id uuid,delivery_available boolean);
create table account_onboarding_deliveries(application_kind text,application_id uuid,auth_user_id uuid,provisioning_status text,provisioned_at timestamptz);
create table join_request_reviews(admin_user_id uuid,request_kind text,request_id uuid,outcome text,reason text);
create table audit_logs(actor_profile_id uuid,entity_table text,entity_id uuid,action text,new_data jsonb);
create table outbox_events(aggregate_type text,aggregate_id uuid,event_type text,payload jsonb);
insert into auth.users values('${applicantId}');
insert into profiles(id,full_name) values('${applicantId}','Existing applicant');
insert into admin_roles values('${uid(4)}','super_admin');
insert into admin_users values('${uid(5)}','${reviewerId}','${uid(4)}',true);
`);
const original = await readFile(new URL("../supabase/migrations/002_provider_contractor_onboarding.sql", import.meta.url), "utf8");
const finalize = original.match(/create or replace function public\.finalize_provider_application_approval\([\s\S]*?\n\$\$;/)?.[0];
assert.ok(finalize);
await db.exec(finalize);
await db.exec("revoke all on function finalize_provider_application_approval(uuid,uuid,uuid,text) from public,anon,authenticated; grant execute on function finalize_provider_application_approval(uuid,uuid,uuid,text) to service_role");
await db.exec(await readFile(new URL("../supabase/migrations/084_provider_join_details_and_policy.sql", import.meta.url), "utf8"));
await db.exec(`alter table profiles add constraint profiles_username_format check(username is null or char_length(username) between 4 and 40);
alter table provider_profiles add constraint provider_profiles_username_format check(username is null or username ~ '^[^[:space:]]{4,40}$');`);
await db.exec(await readFile(new URL("../supabase/migrations/085_provider_optional_username.sql", import.meta.url), "utf8"));
await db.exec("alter table files add constraint files_size_bytes_check check(size_bytes>0 and size_bytes<=52428800)");
await db.exec(await readFile(new URL("../supabase/migrations/086_provider_resumable_documents.sql", import.meta.url), "utf8"));
const base = await readFile(new URL("../supabase/migrations/001_bunya_production_schema.sql", import.meta.url), "utf8");
for (const name of ["application_status", "contractor_document_status", "contractor_availability_status"]) {
  await db.exec(base.match(new RegExp(`create type public\\.${name} as enum[^;]+;`))[0]);
}
for (const name of ["contractor_applications", "contractor_work_regions", "contractor_specialties", "contractor_documents", "contractor_profiles", "contractor_profile_specialties", "contractor_profile_regions"]) {
  await db.exec(base.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
  await db.exec(`alter table ${name} enable row level security`);
}
await db.exec(`alter table contractor_applications add column public_idempotency_key text unique;
alter table customer_profiles add primary key(profile_id);
create unique index user_roles_primary on user_roles(profile_id) where is_primary and revoked_at is null;
insert into profiles(id,full_name) values('${reviewerId}','Reviewer');
create function auth.uid() returns uuid language sql as $$ select '${reviewerId}'::uuid $$;
create function public.admin_has_permission(text) returns boolean language sql as $$ select true $$;
insert into contractor_applications(id,contractor_name,email,mobile) values('${uid(900)}','Legacy Name','legacy@invalid.example','0500000999');
insert into contractor_documents(id,application_id,document_type,storage_path,file_name,mime_type,size_bytes)
values('${uid(901)}','${uid(900)}','supporting_document','legacy/file.pdf','file.pdf','application/pdf',100);`);
await db.exec(await readFile(new URL("../supabase/migrations/087_contractor_company_individual_onboarding.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/088_contractor_approval_document_boundary.sql", import.meta.url), "utf8"));
const draft = (await db.query("select * from platform_policies where policy_key='contractor-join'")).rows[0];
assert.equal(draft.is_published, false);
const policy = (await db.query("update platform_policies set is_published=true where policy_key='contractor-join' returning *")).rows[0];
const fields = () => ({ contractor_type: "company", contractor_name: "  شركة   المقاولات  ", contractor_name_en: "  Building   Construction Company  ", contact_name: null, email: "contractor@invalid.example", mobile: "0500000001", requested_username: null, joining_policy_id: policy.id, joining_policy_version: policy.version, joining_policy_updated_at: policy.updated_at, joining_policy_accepted_at: "2026-10-01T00:00:00Z", public_idempotency_key: "contractor-test-idempotency" });
const official = ["commercial_registration", "municipal_license", "national_address", "vat_certificate"];
const doc = (type, n, mime = "application/pdf") => ({ id: uid(n), document_type: type, document_key: type === "portfolio" ? `portfolio_${uid(n)}` : type, object_path: `join-applications/contractor/${applicationId}/${uid(n)}`, original_name: `${type}-${n}`, mime_type: mime, size_bytes: 100 });
const docs = () => official.map((type, i) => doc(type, 100 + i));
const individualDocs = () => [doc("national_id", 200), doc("portfolio", 201, "video/mp4")];
async function save(overrides = {}, documents = docs(), token = null, removed = [], cities = ["الرياض", "جدة"], specialties = ["بناء"]) {
  return (await db.query("select save_contractor_join_application($1,$2::jsonb,$3::text[],$4::text[],$5::jsonb,$6,$7::uuid[]) as result", [applicationId, JSON.stringify({ ...fields(), ...overrides }), specialties, cities, JSON.stringify(documents), token, removed])).rows[0].result;
}
async function revision(type = "company") {
  await save({ contractor_type: type }, type === "company" ? docs() : individualDocs());
  await db.query("update contractor_applications set status='needs_changes' where id=$1", [applicationId]);
  await db.query("insert into join_application_revision_tokens(token_hash,application_kind,application_id,expires_at) values('revision-hash','contractor',$1,now()+interval '1 day')", [applicationId]);
}
const application = async () => (await db.query("select * from contractor_applications where id=$1", [applicationId])).rows[0];
const currentDocs = async () => (await db.query("select * from contractor_documents where application_id=$1 and is_current", [applicationId])).rows;
await test("legacy application and document preserved without invented contractor type", async () => {
  const legacy = (await db.query("select * from contractor_applications where id=$1", [uid(900)])).rows[0];
  assert.equal(legacy.contractor_type, null); assert.equal(legacy.joining_policy_id, null);
  const document = (await db.query("select * from contractor_documents where id=$1", [uid(901)])).rows[0];
  assert.equal(document.is_current, true); assert.equal(document.document_key, `legacy_${uid(901)}`);
  await db.query("update contractor_applications set status='rejected' where id=$1", [uid(900)]);
});
await test("company submission normalizes names and snapshots only the authoritative published policy", async () => {
  await save({ joining_policy_title: "forged", joining_policy_body: ["forged"] });
  const a = await application();
  assert.equal(a.contractor_name, "شركة المقاولات"); assert.equal(a.contractor_name_en, "Building Construction Company");
  assert.equal(a.requested_username, "Building Construction Company"); assert.equal(a.username_is_custom, false);
  assert.equal(a.contact_name, null); assert.equal(a.joining_policy_title, policy.title); assert.deepEqual(a.joining_policy_body, policy.body);
  assert.equal((await currentDocs()).length, 4);
});
await test("individual accepts video portfolio and clears company contact", async () => {
  await save({ contractor_type: "individual", contact_name: "Company contact" }, individualDocs());
  assert.equal((await application()).contact_name, null); assert.equal((await currentDocs()).length, 2);
});
for (const [name, overrides, pattern] of [
  ["missing type", { contractor_type: null }, /Invalid contractor names/],
  ["blank English name", { contractor_name_en: " " }, /Invalid contractor names/],
  ["absent consent", { joining_policy_accepted_at: null }, /must be accepted/],
  ["stale policy version", { joining_policy_version: 999 }, /changed or is unavailable/],
  ["stale policy timestamp", { joining_policy_updated_at: "2000-01-01T00:00:00Z" }, /changed or is unavailable/],
]) await test(`rejects ${name} atomically`, async () => {
  await rejected(() => save(overrides), pattern); assert.equal(await application(), undefined); assert.equal((await currentDocs()).length, 0);
});
await test("unpublished contractor policy blocks submission and provider policy cannot substitute", async () => {
  await db.exec("update platform_policies set is_published=false where policy_key='contractor-join'");
  await rejected(() => save(), /changed or is unavailable/);
  const provider = (await db.query("update platform_policies set is_published=true where policy_key='provider-join' returning *")).rows[0];
  await rejected(() => save({ joining_policy_id: provider.id, joining_policy_version: provider.version, joining_policy_updated_at: provider.updated_at }), /changed or is unavailable/);
});
await test("empty specialties or cities are rejected before inserts", async () => {
  await rejected(() => save({}, docs(), null, [], []), /Service cities required/);
  await rejected(() => save({}, docs(), null, [], ["Riyadh"], []), /Invalid specialties/);
});
await test("official requirements enforced for both types", async () => {
  await rejected(() => save({}, docs().slice(1)), /All four company documents/);
  await rejected(() => save({ contractor_type: "individual" }, individualDocs().slice(0, 1)), /National ID and 1 to 20/);
  await rejected(() => save({ contractor_type: "individual" }, individualDocs().slice(1)), /National ID and 1 to 20/);
});
await test("company profile is optional and may contain PDF", async () => {
  await save({}, [...docs(), doc("company_profile", 110)]); assert.equal((await currentDocs()).length, 5);
});
await test("individual portfolio accepts images and all allowed video types", async () => {
  await save({ contractor_type: "individual" }, [doc("national_id", 200), ...["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"].map((mime, i) => doc("portfolio", 210 + i, mime))]);
  assert.equal((await currentDocs()).length, 7);
});
for (const [name, mutate] of [
  ["wrong namespace", d => { d.object_path = `join-applications/provider/${applicationId}/wrong`; }],
  ["traversal", d => { d.object_path += "/../wrong"; }],
  ["noncanonical singleton", d => { d.document_key = "custom"; }],
  ["missing MIME", d => { delete d.mime_type; }],
  ["zero bytes", d => { d.size_bytes = 0; }],
]) await test(`rejects ${name} document`, async () => {
  const list = docs(); mutate(list[0]); await rejected(() => save({}, list), /Invalid contractor document/);
  assert.equal(await application(), undefined);
});
await test("individual rejects PDF portfolio, invalid key and company documents", async () => {
  await rejected(() => save({ contractor_type: "individual" }, [doc("national_id", 200), doc("portfolio", 201)]), /Invalid contractor document/);
  const badKey = individualDocs(); badKey[1].document_key = "portfolio_fake";
  await rejected(() => save({ contractor_type: "individual" }, badKey), /Invalid contractor document/);
  await rejected(() => save({ contractor_type: "individual" }, docs()), /Invalid contractor document/);
});
await test("duplicate keys cannot silently overwrite same-batch official documents", async () => {
  await rejected(() => save({}, [...docs(), doc("commercial_registration", 120)]), /Duplicate document keys/);
});
await test("20 portfolio maximum enforced across retained and uploaded documents", async () => {
  const list = [doc("national_id", 200), ...Array.from({ length: 20 }, (_, i) => doc("portfolio", 300 + i, "image/jpeg"))];
  await save({ contractor_type: "individual" }, list);
  assert.equal((await currentDocs()).length, 21);
  await db.query("update contractor_applications set status='needs_changes' where id=$1", [applicationId]);
  await db.query("insert into join_application_revision_tokens(token_hash,application_kind,application_id,expires_at) values('revision-hash','contractor',$1,now()+interval '1 day')", [applicationId]);
  await rejected(() => save({ contractor_type: "individual" }, [doc("portfolio", 330, "image/png")], "revision-hash"), /National ID and 1 to 20/);
  assert.equal((await currentDocs()).length, 21);
});
await test("application-linked documents have no old size cap; profile-only limit remains", async () => {
  await save({}, docs().map(d => ({ ...d, size_bytes: 3 * 1024 ** 3 })));
  await rejected(() => db.query("insert into contractor_documents(contractor_profile_id,storage_path,file_name,mime_type,size_bytes) values($1,'profile-only/file','file','application/pdf',6000000)", [uid(500)]), /contractor_documents_size_bytes_check/);
});
await test("revision replaces document and retains history, explicit username survives", async () => {
  await revision();
  await save({ requested_username: "  Chosen   Name " }, [doc("commercial_registration", 130)], "revision-hash");
  assert.equal((await application()).requested_username, "Chosen Name"); assert.equal((await application()).username_is_custom, true);
  assert.equal((await currentDocs()).length, 4);
  assert.equal((await db.query("select is_current from contractor_documents where id=$1", [uid(100)])).rows[0].is_current, false);
  await rejected(() => save({}, [], "revision-hash"), /Revision token is unavailable/);
});
await test("type switch retires incompatible documents and preserves all historical files", async () => {
  await revision();
  await save({ contractor_type: "individual", contact_name: "Old company contact" }, individualDocs(), "revision-hash");
  assert.equal((await currentDocs()).length, 2);
  assert.equal((await db.query("select count(*)::int as n from contractor_documents where application_id=$1", [applicationId])).rows[0].n, 6);
  assert.equal((await application()).contact_name, null);
});
await test("invalid switch rolls back type, file retirement and revision consumption", async () => {
  await revision();
  await rejected(() => save({ contractor_type: "individual" }, [doc("national_id", 200)], "revision-hash"), /National ID and 1 to 20/);
  assert.equal((await application()).contractor_type, "company"); assert.equal((await application()).status, "needs_changes");
  assert.equal((await currentDocs()).length, 4);
  assert.equal((await db.query("select used_at from join_application_revision_tokens")).rows[0].used_at, null);
});
await test("explicit removal retains history and requires sufficient remaining documents", async () => {
  await revision("individual");
  await rejected(() => save({ contractor_type: "individual" }, [], "revision-hash", [uid(201)]), /National ID and 1 to 20/);
  await save({ contractor_type: "individual" }, [doc("portfolio", 202, "image/png")], "revision-hash", [uid(201)]);
  assert.equal((await currentDocs()).length, 2);
  assert.equal((await db.query("select is_current from contractor_documents where id=$1", [uid(201)])).rows[0].is_current, false);
});
await test("foreign or missing removal ID cannot mutate any document", async () => {
  await revision(); await rejected(() => save({}, [], "revision-hash", [uid(901)]), /Invalid document removals/);
});
await test("expired or wrong-kind revision token fails before mutation", async () => {
  await revision(); await db.exec("update join_application_revision_tokens set application_kind='provider'");
  await rejected(() => save({}, [], "revision-hash"), /Revision token is unavailable/);
  await db.exec("update join_application_revision_tokens set application_kind='contractor',expires_at=now()-interval '1 hour'");
  await rejected(() => save({}, [], "revision-hash"), /Revision token is unavailable/);
});
await test("accepted policy title, body and metadata are immutable outside revision", async () => {
  await save();
  for (const assignment of ["joining_policy_title='forged'", "joining_policy_body='[]'", "joining_policy_version=123", "joining_policy_accepted_at=null"]) {
    await rejected(() => db.query(`update contractor_applications set ${assignment} where id=$1`, [applicationId]), /snapshot is immutable/);
  }
});
for (const alternate of [false, true]) await test(`${alternate ? "alternate" : "provisioning"} approval preserves customer and makes contractor primary`, async () => {
  await save({ contractor_name_en: "AB" });
  await db.query("insert into customer_profiles(profile_id) values($1)", [applicantId]);
  await db.query("insert into user_roles(profile_id,role,is_primary) values($1,'customer',true)", [applicantId]);
  if (alternate) {
    await db.query("update contractor_applications set applicant_profile_id=$2 where id=$1", [applicationId, applicantId]);
    await db.query("select approve_contractor_application($1,'Approved after review')", [applicationId]);
  } else await db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
  const profile = (await db.query("select * from contractor_profiles")).rows[0];
  assert.equal(profile.contractor_type, "company"); assert.equal(profile.display_name_en, "AB"); assert.equal(profile.username, "AB");
  assert.equal((await db.query("select username from profiles where id=$1", [applicantId])).rows[0].username, "AB");
  assert.equal(await count("customer_profiles"), 1);
  assert.deepEqual((await db.query("select role,is_primary from user_roles where revoked_at is null order by role")).rows, [{ role: "contractor", is_primary: true }, { role: "customer", is_primary: false }]);
});
await test("approval creates missing customer profile and active role", async () => {
  await save(); await db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
  assert.equal(await count("customer_profiles"), 1); assert.equal(await count("user_roles"), 2);
});
await test("approval rejects unauthorized reviewer and duplicate provisioning", async () => {
  await save(); await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, uid(999)]), /Reviewer is not authorized/);
  await db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
  await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]), /not approvable|already provisioned/);
});
async function stage(kind = "contractor", expires = "2099-01-01T00:00:00Z") {
  await db.query("insert into provider_upload_batches(id,application_id,application_kind,token_hash,binding_hash,documents,expires_at) values($1,$2,$3,$4,$5,$6::jsonb,$7)", [uid(700), applicationId, kind, "a".repeat(64), "b".repeat(64), JSON.stringify(docs()), expires]);
}
const commit = (binding = "b".repeat(64), list = docs()) => db.query("select commit_contractor_join_upload($1,$2,$3::jsonb,$4::text[],$5::text[],$6::jsonb)", ["a".repeat(64), binding, JSON.stringify(fields()), ["Building"], ["Riyadh"], JSON.stringify(list)]);
await test("contractor upload commit and retry preserve one application and document set", async () => {
  await stage(); await commit(); await commit(); assert.equal((await currentDocs()).length, 4);
  assert.ok((await db.query("select committed_at from provider_upload_batches")).rows[0].committed_at);
});
await test("wrong binding, expired metadata or changed documents cannot consume batch", async () => {
  await stage(); await rejected(() => commit("c".repeat(64)), /Invalid upload batch/);
  await rejected(() => commit("b".repeat(64), docs().slice(1)), /Expired or changed/);
  await db.exec("update provider_upload_batches set expires_at=now()-interval '1 hour'");
  await rejected(() => commit(), /Expired or changed/); assert.equal(await application(), undefined);
});
await test("upload capabilities cannot cross provider and contractor application kinds", async () => {
  await stage("provider"); await rejected(() => commit(), /Invalid upload batch/);
  await db.exec("update provider_upload_batches set application_kind='contractor'");
  await rejected(() => db.query("select commit_provider_join_upload($1,$2,'{}','{}','{}','[]')", ["a".repeat(64), "b".repeat(64)]), /Invalid upload batch/);
});
await test("provider submission and capability retry still work after migration087", async () => {
  const providerPolicy = (await db.query("update platform_policies set is_published=true where policy_key='provider-join' returning *")).rows[0];
  const providerFields = { ...fields(), company_name: "شركة مواد البناء", company_name_en: "Building Supply Company", service_cities: ["Riyadh"], delivery_available: false, joining_policy_id: providerPolicy.id, joining_policy_version: providerPolicy.version, joining_policy_updated_at: providerPolicy.updated_at };
  const providerDocs = docs().map(d => ({ ...d, object_path: d.object_path.replace("/contractor/", "/provider/") }));
  await db.query("insert into provider_upload_batches(id,application_id,token_hash,binding_hash,documents,expires_at) values($1,$2,$3,$4,$5::jsonb,'2099-01-01')", [uid(700), applicationId, "a".repeat(64), "b".repeat(64), JSON.stringify(providerDocs)]);
  for (let retry = 0; retry < 2; retry++) await db.query("select commit_provider_join_upload($1,$2,$3::jsonb,$4::text[],$5::text[],$6::jsonb)", ["a".repeat(64), "b".repeat(64), JSON.stringify(providerFields), ["Building supplies"], [], JSON.stringify(providerDocs)]);
  assert.equal(await count("provider_applications"), 1); assert.equal(await count("provider_application_documents"), 4);
  assert.equal((await db.query("select requested_username from provider_applications")).rows[0].requested_username, "Building Supply Company");
});
await test("approval preserves revoked customer history and grants a fresh active customer role", async () => {
  await save({ contractor_name_en: "International Building Construction and Finishing Company" });
  await db.query("insert into user_roles(profile_id,role,is_primary,revoked_at) values($1,'customer',false,now())", [applicantId]);
  await db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
  assert.equal((await db.query("select count(*)::int as n from user_roles where role='customer'")).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int as n from user_roles where role='customer' and revoked_at is null")).rows[0].n, 1);
});
await test("client roles cannot submit, commit or read upload capabilities; RLS remains enabled", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set local role ${role}`);
    await rejected(() => save(), /permission denied/); await rejected(() => commit(), /permission denied/);
    await rejected(() => db.query("select * from provider_upload_batches"), /permission denied/);
    await db.exec("reset role");
  }
  assert.equal((await db.query("select has_function_privilege('service_role','save_contractor_join_application(uuid,jsonb,text[],text[],jsonb,text,uuid[])','EXECUTE') as allowed")).rows[0].allowed, true);
  assert.equal((await db.query("select bool_and(relrowsecurity) as secured from pg_class where relname in ('contractor_applications','contractor_documents','contractor_profiles','provider_upload_batches')")).rows[0].secured, true);
});
await test("backfill restores active approved contractors only and preserves revoked role history", async () => {
  const migration = await readFile(new URL("../supabase/migrations/087_contractor_company_individual_onboarding.sql", import.meta.url), "utf8");
  const backfill = migration.split("-- Restore customer capability")[1].replace(/commit;\s*$/, "");
  const sql = "-- Restore customer capability" + backfill;
  await save(); await db.query("select finalize_contractor_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
  await db.exec("delete from customer_profiles; update user_roles set revoked_at=now() where role='customer'; update profiles set is_active=false");
  await db.exec(sql); assert.equal(await count("customer_profiles"), 0);
  await db.query("update profiles set is_active=true where id=$1", [applicantId]);
  await db.exec("update contractor_profiles set approval_status='rejected'");
  await db.exec(sql); assert.equal(await count("customer_profiles"), 0);
  await db.exec("update contractor_profiles set approval_status='approved'");
  await db.exec(sql); await db.exec(sql);
  assert.equal(await count("customer_profiles"), 1);
  assert.equal((await db.query("select count(*)::int as n from user_roles where role='customer'")).rows[0].n, 2);
  assert.equal((await db.query("select role from user_roles where is_primary and revoked_at is null")).rows[0].role, "contractor");
});
for (const alternate of [false, true]) await test(`${alternate ? "alternate" : "provisioning"} approval rejects incomplete direct application state atomically`, async () => {
  await save(); await db.query("delete from contractor_documents where id=$1", [uid(100)]);
  await db.query("update contractor_applications set applicant_profile_id=$2 where id=$1", [applicationId, applicantId]);
  await rejected(() => alternate ? db.query("select approve_contractor_application($1,'Reviewed')", [applicationId]) : db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]), /All four company documents are required for approval/);
  assert.equal(await count("contractor_profiles"), 0); assert.equal(await count("customer_profiles"), 0);
  assert.equal((await application()).status, "pending");
});
for (const missing of ["contractor_specialties", "contractor_work_regions"]) await test(`approval requires ${missing} even for direct database rows`, async () => {
  await save(); await db.query(`delete from ${missing} where application_id=$1`, [applicationId]);
  await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]), /specialties and service cities/);
});
await test("approval rejects current legacy keys and missing individual portfolio", async () => {
  await save({ contractor_type: "individual" }, individualDocs());
  await db.query("update contractor_documents set document_key='legacy_fake' where id=$1", [uid(201)]);
  await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]), /Invalid contractor documents/);
  await db.query("delete from contractor_documents where id=$1", [uid(201)]);
  await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]), /National ID and 1 to 20/);
});
await test("approval preserves previously accepted policy snapshot after publication changes", async () => {
  await save(); await db.exec("update platform_policies set version=version+1,is_published=false where policy_key='contractor-join'");
  await db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]);
  assert.equal((await application()).status, "approved");
});
await test("untyped legacy application remains approvable without fabricated new documents", async () => {
  await db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed legacy application')", [uid(900), applicantId, reviewerId]);
  assert.equal((await db.query("select contractor_type from contractor_profiles")).rows[0].contractor_type, null);
});
await test("typed legacy row cannot enter new approval without policy acceptance", async () => {
  await db.query("update contractor_applications set contractor_type='company' where id=$1", [uid(900)]);
  await rejected(() => db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [uid(900), applicantId, reviewerId]), /Valid contractor policy acceptance/);
});
await test("client direct application writes and approved onboarding document mutation are blocked despite permissive table grants", async () => {
  await save(); await db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed')", [applicationId, applicantId, reviewerId]);
  const contractorId = (await db.query("select id from contractor_profiles")).rows[0].id;
  await db.exec("grant select,insert,update,delete on contractor_applications,contractor_documents to authenticated; create policy test_client_application on contractor_applications for all to authenticated using(true) with check(true); create policy test_client_document on contractor_documents for all to authenticated using(true) with check(true)");
  await db.exec("set local role authenticated");
  await rejected(() => db.query("delete from contractor_documents where id=$1", [uid(100)]), /require server workflow/);
  await rejected(() => db.query("update contractor_documents set storage_path='tampered' where id=$1", [uid(100)]), /require server workflow/);
  await rejected(() => db.query("update contractor_documents set application_id=null where id=$1", [uid(100)]), /require server workflow/);
  await rejected(() => db.query("insert into contractor_applications(contractor_name,email,mobile) values('Bypass','bypass@invalid.example','0500000991')"), /require server workflow/);
  await rejected(() => db.query("update contractor_applications set contractor_name='Tampered' where id=$1", [applicationId]), /require server workflow/);
  await db.query("insert into contractor_documents(id,contractor_profile_id,storage_path,file_name,mime_type,size_bytes) values($1,$2,'profile-only/file.pdf','file.pdf','application/pdf',100)", [uid(888), contractorId]);
  await rejected(() => db.query("update contractor_documents set application_id=$1 where id=$2", [applicationId, uid(888)]), /require server workflow/);
  await rejected(() => db.query("insert into contractor_documents(application_id,storage_path,file_name,mime_type,size_bytes) values($1,'direct-application/file.pdf','file.pdf','application/pdf',100)", [applicationId]), /require server workflow/);
  await db.query("delete from contractor_documents where id=$1", [uid(888)]);
  await db.exec("reset role");
  assert.equal((await currentDocs()).length, 4);
});
console.log(`${passed} contractor join migration regression checks passed.`);
await db.close();
