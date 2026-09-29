// Actual migration084 against isolated PostgreSQL. No live database or messages.
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
const policy = (await db.query("update platform_policies set is_published=true where policy_key='provider-join' returning id,version,updated_at")).rows[0];
const fields = () => ({ company_name: "  شركة   مواد  البناء  ", company_name_en: "  Building   Materials  Company  ", contact_name: null, service_cities: ["الرياض", "المدينة المنورة"], email: "provider@invalid.example", mobile: "0500000001", requested_username: "test_provider", google_maps_url: "https://maps.google.com/?q=24,46", latitude: 24, longitude: 46, delivery_available: false, joining_policy_id: policy.id, joining_policy_version: policy.version, joining_policy_updated_at: policy.updated_at, joining_policy_accepted_at: "2026-09-30T00:00:00Z", public_idempotency_key: "provider-test-idempotency-key" });
const types = ["commercial_registration", "municipal_license", "national_address", "vat_certificate"];
const docs = () => types.map((type, index) => ({ id: uid(100 + index), document_type: type, object_path: `join-applications/provider/${applicationId}/${type}.pdf`, original_name: `${type}.pdf`, mime_type: "application/pdf", size_bytes: 100, checksum_sha256: "a".repeat(64) }));
async function save(overrides = {}, documents = docs(), token = null) {
  return (await db.query("select save_provider_join_application($1,$2::jsonb,$3::text[],$4::text[],$5::jsonb,$6) as result", [applicationId, JSON.stringify({ ...fields(), ...overrides }), ["مواد البناء"], [], JSON.stringify(documents), token])).rows[0].result;
}
async function revision() {
  await save();
  await db.query("update provider_applications set status='needs_changes' where id=$1", [applicationId]);
  await db.query("insert into join_application_revision_tokens(token_hash,application_kind,application_id,expires_at) values('revision-hash','provider',$1,now()+interval '1 day')", [applicationId]);
}

await test("valid submission normalizes spaced bilingual names, optional contact, cities and policy snapshot", async () => {
  const result = await save({ joining_policy_title: "Forged title", joining_policy_body: ["Forged body"] });
  assert.equal(result.status, "pending");
  const row = (await db.query("select * from provider_applications")).rows[0];
  assert.equal(row.company_name, "شركة مواد البناء");
  assert.equal(row.company_name_en, "Building Materials Company");
  assert.equal(row.contact_name, null);
  assert.deepEqual(row.service_cities, ["الرياض", "المدينة المنورة"]);
  assert.equal(row.joining_policy_title, "سياسة انضمام مزود الخدمات أو المورد");
  assert.ok(row.joining_policy_body.length > 0 && row.joining_policy_accepted_at);
  assert.equal(await count("provider_application_documents"), 4);
});
for (const [name, overrides, pattern] of [
  ["absent policy consent", { joining_policy_accepted_at: null }, /must be accepted/],
  ["policy version mismatch", { joining_policy_version: 999 }, /changed or is unavailable/],
  ["policy timestamp mismatch", { joining_policy_updated_at: "2020-01-01T00:00:00Z" }, /changed or is unavailable/],
  ["empty English name", { company_name_en: " " }, /Invalid provider names/],
  ["empty service cities", { service_cities: [] }, /Invalid provider names/],
]) await test(`rejects ${name} atomically`, async () => {
  await rejected(() => save(overrides), pattern);
  for (const table of ["provider_applications", "provider_application_documents", "files", "provider_application_categories"]) assert.equal(await count(table), 0, table);
});
await test("rejects unpublished policy", async () => {
  await db.exec("update platform_policies set is_published=false");
  await rejected(() => save(), /changed or is unavailable/);
  assert.equal(await count("provider_applications"), 0);
});
await test("missing required document rolls back application, categories and staged database file records", async () => {
  await rejected(() => save({}, docs().slice(0, 3)), /All four provider documents/);
  for (const table of ["provider_applications", "provider_application_documents", "files", "provider_application_categories"]) assert.equal(await count(table), 0, table);
});
await test("wrong document namespace rolls back submission", async () => {
  const list = docs(); list[3].object_path = `join-applications/provider/${uid(999)}/file.pdf`;
  await rejected(() => save({}, list), /Invalid provider document/);
  assert.equal(await count("provider_applications"), 0); assert.equal(await count("files"), 0);
});
await test("anonymous and authenticated roles cannot execute server-only RPC", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set local role ${role}`);
    await rejected(() => save(), /permission denied/);
    await db.exec("reset role");
  }
  assert.equal((await db.query("select has_function_privilege('service_role','save_provider_join_application(uuid,jsonb,text[],text[],jsonb,text)','EXECUTE') as allowed")).rows[0].allowed, true);
});
await test("revision retains history, replaces current type and consumes token only once", async () => {
  await revision();
  const replacement = { ...docs()[0], id: uid(200), object_path: `join-applications/provider/${applicationId}/replacement.pdf` };
  await save({ company_name_en: "Revised Company" }, [replacement], "revision-hash");
  assert.equal(await count("provider_application_documents"), 5);
  assert.equal((await db.query("select count(*)::int as n from provider_application_documents where is_current")).rows[0].n, 4);
  assert.equal((await db.query("select is_current from provider_application_documents where file_id=$1", [uid(100)])).rows[0].is_current, false);
  const token = (await db.query("select * from join_application_revision_tokens")).rows[0];
  assert.ok(token.used_at); assert.equal(token.attempts, 1);
  await rejected(() => save({}, [], "revision-hash"), /Revision token is unavailable/);
  assert.equal((await db.query("select company_name_en from provider_applications")).rows[0].company_name_en, "Revised Company");
});
await test("invalid revision rolls back changed fields, current-document history and token usage", async () => {
  await revision();
  const invalid = { ...docs()[0], id: uid(200), object_path: `join-applications/provider/${applicationId}/replacement.pdf`, size_bytes: 0 };
  await rejected(() => save({ company_name_en: "Must Roll Back" }, [invalid], "revision-hash"), /Invalid provider document/);
  const row = (await db.query("select status,company_name_en from provider_applications")).rows[0];
  assert.equal(row.status, "needs_changes"); assert.equal(row.company_name_en, "Building Materials Company");
  assert.equal((await db.query("select used_at from join_application_revision_tokens")).rows[0].used_at, null);
  assert.equal(await count("files"), 4);
});
await test("expired revision token cannot mutate request", async () => {
  await revision(); await db.exec("update join_application_revision_tokens set expires_at=now()-interval '1 hour'");
  await rejected(() => save({}, [], "revision-hash"), /Revision token is unavailable/);
});
await test("policy snapshot cannot be edited independently", async () => {
  await save();
  await rejected(() => db.exec("update provider_applications set joining_policy_title='tampered'"), /snapshot is immutable/);
});
await test("approval propagates bilingual company and cities; absent contact uses company profile name", async () => {
  await save();
  const providerId = (await db.query("select finalize_provider_application_approval($1,$2,$3,'Approved after review') as id", [applicationId, applicantId, reviewerId])).rows[0].id;
  const provider = (await db.query("select * from providers where id=$1", [providerId])).rows[0];
  assert.equal(provider.company_name, "شركة مواد البناء"); assert.equal(provider.company_name_en, "Building Materials Company");
  assert.equal(provider.contact_name, null); assert.deepEqual(provider.service_cities, ["الرياض", "المدينة المنورة"]);
  assert.equal((await db.query("select full_name from profiles where id=$1", [applicantId])).rows[0].full_name, "شركة مواد البناء");
  assert.equal((await db.query("select status from provider_applications")).rows[0].status, "approved");
  assert.equal(await count("account_onboarding_deliveries"), 1);
});
for (const companyName of ["Building Supply Company", "AB", "International Building Materials and Construction Supply Company"]) {
  await test(`blank username uses full English company name through approval: ${companyName}`, async () => {
    await save({ requested_username: null, company_name_en: `  ${companyName}  ` });
    const application = (await db.query("select requested_username,username_is_custom from provider_applications")).rows[0];
    assert.equal(application.requested_username, companyName);
    assert.equal(application.username_is_custom, false);
    await db.query("select finalize_provider_application_approval($1,$2,$3,'Approved after review')", [applicationId, applicantId, reviewerId]);
    assert.equal((await db.query("select username from profiles where id=$1", [applicantId])).rows[0].username, companyName);
    assert.equal((await db.query("select username from provider_profiles")).rows[0].username, companyName);
  });
}
await test("explicit username is preserved instead of company fallback", async () => {
  await save({ requested_username: "  My   Chosen Company  " });
  const row = (await db.query("select requested_username,username_is_custom from provider_applications")).rows[0];
  assert.equal(row.requested_username, "My Chosen Company");
  assert.equal(row.username_is_custom, true);
});
await test("revision with blank username follows revised English company name", async () => {
  await revision();
  await save({ requested_username: null, company_name_en: "New English Company" }, [], "revision-hash");
  const row = (await db.query("select requested_username,username_is_custom from provider_applications")).rows[0];
  assert.equal(row.requested_username, "New English Company");
  assert.equal(row.username_is_custom, false);
});
console.log(`${passed} provider join migration regression checks passed.`);
await db.close();
