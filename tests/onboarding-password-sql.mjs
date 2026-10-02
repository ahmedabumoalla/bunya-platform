// Actual onboarding migrations and finalizers, isolated PostgreSQL; no live users or messages.
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
await db.exec(`
create role supabase_auth_admin;
alter table auth.users add column encrypted_password text;
update auth.users set encrypted_password='synthetic-issued-password-hash';
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table provider_drivers(id uuid primary key,must_change_password boolean,status text,updated_at timestamptz);
create table provider_driver_accounts(driver_id uuid,auth_user_id uuid);
alter table profiles enable row level security;
insert into auth.users values('${uid(800)}','existing-issued-hash'),('${uid(801)}','driver-issued-hash'),('${uid(802)}','short-window-hash');
insert into profiles(id,full_name,role,must_change_password,temporary_password_issued_at,temporary_password_expires_at)
values('${uid(800)}','Existing contractor','contractor',true,now()-interval '30 hours',now()+interval '42 hours'),
('${uid(801)}','Driver','driver',true,now(),now()+interval '72 hours'),
('${uid(802)}','Existing provider short window','provider',true,now()-interval '1 hour',now()+interval '8 hours');
insert into provider_drivers values('${uid(803)}',true,'must_change_password',now());
insert into provider_driver_accounts values('${uid(803)}','${uid(801)}');
alter table profiles add constraint profiles_temporary_password_window check (
  not must_change_password or (temporary_password_issued_at is not null and temporary_password_expires_at is not null and temporary_password_expires_at>temporary_password_issued_at)
);
`);
await db.exec(await readFile(new URL("../supabase/migrations/089_onboarding_temporary_password_24_hours.sql", import.meta.url), "utf8"));
const profile = async (id = applicantId) => (await db.query("select * from profiles where id=$1", [id])).rows[0];
const fingerprint = async (id = applicantId) => (await db.query("select * from onboarding_password_fingerprints where profile_id=$1", [id])).rows[0];
const loginAs = async id => db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
const expire = async (id = applicantId) => db.query("update profiles set temporary_password_expires_at=temporary_password_issued_at+interval '1 microsecond' where id=$1", [id]);
const authChange = async (value = "synthetic-new-password-hash", id = applicantId) => db.query("update auth.users set encrypted_password=$1 where id=$2", [value, id]);
const complete = async () => db.query("select complete_temporary_password_change()");
async function issue(kind = "contractor") {
  await db.query("update profiles set role=$1,must_change_password=true,temporary_password_issued_at=now(),temporary_password_expires_at=now()+interval '72 hours' where id=$2", [kind, applicantId]);
}
const event = (id = applicantId, exp = Math.floor(Date.now() / 1000) + 48 * 3600) => ({ user_id: id, claims: { sub: id, exp, role: "authenticated", aud: "authenticated", custom: "unchanged" } });
const hook = async (value = event()) => (await db.query("select onboarding_access_token_hook($1::jsonb) as result", [JSON.stringify(value)])).rows[0].result;
await test("existing pending credentials capped from original issuance without extending or changing Auth passwords", async () => {
  const old = await profile(uid(800)), short = await profile(uid(802));
  assert.equal(Date.parse(old.temporary_password_expires_at) - Date.parse(old.temporary_password_issued_at), 24 * 3600000);
  assert.ok(Date.parse(old.temporary_password_expires_at) < Date.now());
  assert.equal(Date.parse(short.temporary_password_expires_at) - Date.parse(short.temporary_password_issued_at), 9 * 3600000);
  assert.equal((await db.query("select encrypted_password from auth.users where id=$1", [uid(800)])).rows[0].encrypted_password, "existing-issued-hash");
  assert.match((await fingerprint(uid(800))).password_fingerprint, /^[a-f0-9]{64}$/);
});
for (const kind of ["provider", "contractor"]) await test(`${kind} issuance is exactly24h and fingerprints only the Auth hash`, async () => {
  await issue(kind); const p = await profile();
  assert.equal(Date.parse(p.temporary_password_expires_at) - Date.parse(p.temporary_password_issued_at), 24 * 3600000);
  const fp = await fingerprint(); assert.match(fp.password_fingerprint, /^[a-f0-9]{64}$/); assert.notEqual(fp.password_fingerprint, "synthetic-issued-password-hash");
  await rejected(() => db.query("insert into onboarding_password_fingerprints values($1,'not-a-fingerprint',now())", [uid(4)]), /check constraint/);
});
for (const kind of ["provider", "contractor"]) await test(`actual ${kind} approval finalizer72h literal is safely normalized to24h`, async () => {
  if (kind === "contractor") {
    // Existing legacy fixture exercises the real087 finalizer without inventing new consent.
    await db.query("select finalize_contractor_application_approval($1,$2,$3,'Reviewed legacy application')", [uid(900), applicantId, reviewerId]);
  } else {
    const policy = (await db.query("update platform_policies set is_published=true where policy_key='provider-join' returning *")).rows[0];
    const fields = { company_name: "شركة مواد البناء", company_name_en: "Building Materials", contact_name: null, service_cities: ["Riyadh"], email: "provider@invalid.example", mobile: "0500000001", requested_username: null, delivery_available: false, joining_policy_id: policy.id, joining_policy_version: policy.version, joining_policy_updated_at: policy.updated_at, joining_policy_accepted_at: new Date().toISOString() };
    const docs = ["commercial_registration", "municipal_license", "national_address", "vat_certificate"].map((type, i) => ({ id: uid(100 + i), document_type: type, object_path: `join-applications/provider/${applicationId}/${type}`, original_name: type, mime_type: "application/pdf", size_bytes: 100 }));
    await db.query("select save_provider_join_application($1,$2::jsonb,$3::text[],$4::text[],$5::jsonb)", [applicationId, JSON.stringify(fields), ["Building"], [], JSON.stringify(docs)]);
    await db.query("select finalize_provider_application_approval($1,$2,$3,'Approved')", [applicationId, applicantId, reviewerId]);
  }
  const p = await profile(); assert.equal(Date.parse(p.temporary_password_expires_at) - Date.parse(p.temporary_password_issued_at), 24 * 3600000); assert.ok(await fingerprint());
});
await test("issuance rolls back if Auth has no password", async () => {
  await authChange(""); await rejected(() => issue(), /Auth password is required/); assert.equal((await profile()).must_change_password, null);
});
await test("direct client updates cannot clear gate, extend expiry or forge completion", async () => {
  await issue(); await db.exec("grant select,update on profiles to authenticated; create policy test_profile_edit on profiles for update to authenticated using(true) with check(true); create policy test_profile_read on profiles for select to authenticated using(true)");
  await db.exec("set local role authenticated");
  for (const assignment of ["must_change_password=false", "temporary_password_expires_at=now()+interval '1 year'", "temporary_password_issued_at=now()+interval '1 hour'", "password_changed_at=now()"]) {
    await rejected(() => db.query(`update profiles set ${assignment} where id=$1`, [applicantId]), /requires server workflow/);
  }
  await db.query("update profiles set full_name='Allowed ordinary edit' where id=$1", [applicantId]);
  await db.exec("reset role"); assert.equal((await profile()).must_change_password, true);
});
await test("completion rejects unchanged password and expired credentials after a password change", async () => {
  await issue(); await loginAs(applicantId);
  await rejected(complete, /Change the Auth password/); assert.equal((await profile()).must_change_password, true);
  await authChange(); await expire(); await rejected(complete, /Temporary password has expired/);
  assert.equal((await profile()).must_change_password, true); assert.ok(await fingerprint());
});
await test("valid password change completes once, clears fingerprint and records audit", async () => {
  await issue(); await authChange(); await loginAs(applicantId); await complete();
  const p = await profile(); assert.equal(p.must_change_password, false); assert.equal(p.temporary_password_expires_at, null); assert.ok(p.password_changed_at); assert.equal(await fingerprint(), undefined);
  assert.equal((await db.query("select count(*)::int as n from audit_logs where action='temporary_password_changed'")).rows[0].n, 1);
  await rejected(complete, /not pending/);
});
await test("missing fingerprint fails closed rather than allowing completion", async () => {
  await issue(); await authChange(); await loginAs(applicantId); await db.query("delete from onboarding_password_fingerprints where profile_id=$1", [applicantId]);
  await rejected(complete, /Change the Auth password/);
});
await test("resend captures replacement Auth credential and restarts exactly24h", async () => {
  await issue(); const old = (await fingerprint()).password_fingerprint;
  await expire(); await authChange("replacement-issued-hash");
  await db.query("update profiles set must_change_password=true,temporary_password_issued_at=now()+interval '1 second',temporary_password_expires_at=now()+interval '72 hours',password_changed_at=null where id=$1", [applicantId]);
  const p = await profile(); assert.equal(Date.parse(p.temporary_password_expires_at) - Date.parse(p.temporary_password_issued_at), 24 * 3600000);
  assert.notEqual((await fingerprint()).password_fingerprint, old); await loginAs(applicantId);
  await rejected(complete, /Change the Auth password/); await authChange("new-permanent-hash"); await complete();
});
await test("driver TTL, existing completion and activation remain unchanged", async () => {
  const p = await profile(uid(801)); assert.equal(Date.parse(p.temporary_password_expires_at) - Date.parse(p.temporary_password_issued_at), 72 * 3600000);
  assert.equal(await fingerprint(uid(801)), undefined);
  await loginAs(uid(801)); await complete(); assert.equal((await profile(uid(801))).must_change_password, false);
  assert.equal((await db.query("select status from provider_drivers")).rows[0].status, "active");
});
await test("hook refuses expired provider/contractor across auth methods and refresh", async () => {
  for (const kind of ["provider", "contractor"]) {
    await issue(kind); await expire();
    for (const method of ["password", "token_refresh", "otp", "recovery"]) {
      const result = await hook({ ...event(), authentication_method: method }); assert.equal(result.error.http_code, 403); assert.equal(result.claims, undefined);
    }
  }
});
await test("hook fails closed for missing deadline and clamps valid tokens to credential expiry", async () => {
  await issue(); const p = await profile(); const expected = Math.floor(Date.parse(p.temporary_password_expires_at) / 1000);
  const result = await hook(); assert.equal(result.claims.exp, expected); assert.equal(result.claims.custom, "unchanged");
  const short = event(applicantId, Math.floor(Date.now() / 1000) + 60); assert.deepEqual((await hook(short)).claims, short.claims);
  // Deliberately bypass normal invariants to exercise a corrupt/missing deadline.
  await db.exec("alter table profiles drop constraint profiles_temporary_password_window");
  await db.exec("alter table profiles disable trigger profiles_guard_onboarding_password");
  await db.query("update profiles set temporary_password_expires_at=null where id=$1", [applicantId]);
  await db.exec("alter table profiles enable trigger profiles_guard_onboarding_password");
  assert.equal((await hook()).error.http_code, 403);
});
await test("driver, customer and completed users keep unchanged Auth claims", async () => {
  const driver = event(uid(801)); assert.deepEqual((await hook(driver)).claims, driver.claims);
  await db.query("update profiles set role='customer',must_change_password=false where id=$1", [applicantId]);
  assert.deepEqual((await hook()).claims, event().claims);
  await issue(); await authChange(); await loginAs(applicantId); await complete();
  assert.deepEqual((await hook()).claims, event().claims);
});
await test("hook grants are Auth-only, profiles grants minimal and fingerprints stay private", async () => {
  await issue();
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set local role ${role}`); await rejected(() => hook(), /permission denied/);
    if (role !== "service_role") await rejected(() => db.query("select * from onboarding_password_fingerprints"), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set local role supabase_auth_admin");
  assert.ok((await hook()).claims);
  await rejected(() => db.query("select full_name from profiles"), /permission denied/);
  await rejected(() => db.query("select * from onboarding_password_fingerprints"), /permission denied/);
  await db.exec("reset role");
});
console.log(`${passed} onboarding temporary password migration regression checks passed.`);
await db.close();
