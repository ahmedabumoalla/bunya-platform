import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const sources = {
  fields: "../src/lib/join/contractor-fields.ts", providerFields: "../src/lib/join/provider-fields.ts",
  validation: "../src/lib/join/contractor-validation.ts", policy: "../src/lib/join/provider-validation.ts",
  security: "../src/lib/join/security.ts", registry: "../src/lib/policies/registry.ts", submit: "../src/lib/join/submit-contractor.ts",
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, path]) => [name,
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
])));
const policy = { id: "policy-1", title: "Contractor joining policy", version: 3, body: ["Published test policy."], updated_at: "2026-10-01T00:00:00.000Z", policy_key: "contractor-join", is_published: true };
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { id: uid(1), document_key: "national_id", document_type: "national_id", object_path: "join-applications/contractor/app/document", original_name: "id.pdf", mime_type: "application/pdf", size_bytes: 3 * 1024 ** 3 };
const batch = { id: "batch", token_hash: "hash", binding_hash: "binding", application_kind: "contractor", application_id: "app", committed_at: null, documents: [document] };
const receipt = { applicationId: "app", status: "pending", submittedAt: "2026-10-01T01:00:00Z" };
function harness(options = {}) {
  const events = [], rpcCalls = [], notices = [], policyFilters = [], errors = [];
  const db = {
    from(table) {
      const filters = [];
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, single() { return this; }, maybeSingle() { return this; },
        then(resolve, reject) {
          events.push(table);
          if (table === "platform_policies") {
            policyFilters.push(filters);
            const current = options.policy === undefined ? policy : options.policy;
            return Promise.resolve({ data: current && filters.every(([key, value]) => current[key] === value) ? current : null, error: null }).then(resolve, reject);
          }
          assert.equal(table, "contractor_applications");
          return Promise.resolve({ data: { id: receipt.applicationId, status: receipt.status, created_at: receipt.submittedAt }, error: null }).then(resolve, reject);
        },
      };
    },
    async rpc(name, args) { events.push("rpc"); assert.equal(name, "commit_contractor_join_upload"); rpcCalls.push(args); return { data: receipt, error: options.rpcError ?? null }; },
  };
  const cache = {}, aliases = { "./contractor-fields": "fields", "./provider-fields": "providerFields", "./contractor-validation": "validation", "./provider-validation": "policy", "./security": "security", "@/lib/policies/registry": "registry" };
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    vm.runInNewContext(compiled[name], { exports, File, FormData, Uint8Array, Date, console: { error: (...args) => errors.push(args) }, require(dependency) {
      if (dependency === "server-only") return {};
      if (dependency === "node:crypto") return crypto;
      if (dependency === "@/lib/supabase/admin") return { createAdminClient: () => db };
      if (dependency === "@/lib/notifications/join-reviewers") return { async notifyJoinReviewers(value) { events.push("notify"); notices.push(value); if (options.notificationError) throw Error("notification unavailable"); } };
      if (dependency === "./provider-upload-batches") return {
        async resolveProviderUpload(data, key, revision, client, kind) { assert.equal(client, db); assert.equal(kind, "contractor"); events.push("resolve"); return { ...batch, ...(options.batch ?? {}) }; },
        async verifyProviderUpload(value, client) { assert.equal(client, db); events.push("verify"); if (options.verifyError) throw Error("incomplete upload"); return value.documents; },
      };
      if (aliases[dependency]) return load(aliases[dependency]);
      throw Error(`Unexpected dependency ${dependency}`);
    } }, { filename: sources[name] });
    return exports;
  }
  return { ...load("validation"), ...load("submit"), events, rpcCalls, notices, policyFilters, errors };
}
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ contractorType: "company", contractorName: "  شركة   المقاولات  ", contractorNameEn: "  Building   Construction Company ", contactName: "", username: "", serviceCities: '[" Riyadh ","riyadh","Jeddah"]', specialties: '["Building"]', email: " CONTRACTOR@INVALID.EXAMPLE ", mobile: "0500000001", policyAccepted: "true", policyId: policy.id, policyVersion: String(policy.version), policyUpdatedAt: policy.updated_at, uploadToken: "capability", ...overrides })) if (value !== null) data.set(key, value);
  return data;
}
const status = code => error => error?.status === code;
let passed = 0;
async function check(label, run) { try { await run(); passed++; } catch (error) { throw Error(`${label}: ${error.message}`, { cause: error }); } }
await check("bilingual fields normalize spaces, cities deduplicate and username falls back at DB", () => {
  const h = harness(), value = h.contractorFields(form());
  assert.equal(value.contractor_name, "شركة المقاولات"); assert.equal(value.contractor_name_en, "Building Construction Company");
  assert.equal(value.requested_username, null); assert.equal(value.contact_name, null); assert.deepEqual(Array.from(value.service_cities), ["Riyadh", "Jeddah"]);
  assert.equal(h.contractorFields(form({ username: "  Custom   Name  " })).requested_username, "Custom Name");
  assert.equal(h.contractorFields(form({ contractorType: "individual", contactName: "Ignored company contact" })).contact_name, null);
});
await check("type, name boundaries and service city structure reject invalid inputs", () => {
  const h = harness();
  for (const overrides of [{ contractorType: "" }, { contractorType: "other" }, { contractorName: "x" }, { contractorNameEn: "x".repeat(161) }, { contractorNameEn: "a\u0000b" }, { contactName: "x".repeat(121) }, { username: "x" }, { serviceCities: "{}" }, { serviceCities: "[1]" }, { serviceCities: "[]" }, { serviceCities: '["x"]' }, { serviceCities: JSON.stringify(Array(51).fill("City")) }]) assert.throws(() => h.contractorFields(form(overrides)), status(400));
  for (const length of [2, 160]) assert.doesNotThrow(() => h.contractorFields(form({ contractorName: "x".repeat(length), contractorNameEn: "x".repeat(length) })));
});
await check("removals validate UUID shape and24 maximum and deduplicate canonical IDs", () => {
  const h = harness();
  for (const removedDocumentIds of ["{", "{}", JSON.stringify(["-".repeat(36)]), JSON.stringify(Array.from({ length: 25 }, (_, i) => uid(i)))]) assert.throws(() => h.contractorRemovedDocuments(form({ removedDocumentIds })), status(400));
  assert.deepEqual(Array.from(h.contractorRemovedDocuments(form({ removedDocumentIds: JSON.stringify([uid(1), uid(1)]) }))), [uid(1)]);
});
await check("submission sends atomic contractor RPC with normalized fields, document metadata and removals", async () => {
  const h = harness(); await h.submitContractor(form({ removedDocumentIds: JSON.stringify([uid(4)]) }), "attempt-00000000001");
  const args = h.rpcCalls[0];
  assert.equal(args.p_token_hash, "hash"); assert.equal(args.p_binding_hash, "binding");
  assert.equal(args.p_fields.email, "contractor@invalid.example"); assert.equal(args.p_fields.mobile, "+966500000001");
  assert.equal(args.p_fields.requested_username, null); assert.equal(args.p_fields.contractor_type, "company");
  assert.equal(args.p_fields.joining_policy_title, policy.title); assert.equal(args.p_fields.public_idempotency_key, "attempt-00000000001");
  assert.deepEqual(Array.from(args.p_regions), ["Riyadh", "Jeddah"]); assert.deepEqual(Array.from(args.p_specialties), ["Building"]);
  assert.deepEqual(Array.from(args.p_removed_document_ids), [uid(4)]); assert.deepEqual(args.p_documents, [document]);
  assert.deepEqual(h.events, ["resolve", "platform_policies", "verify", "rpc", "notify"]);
  assert.equal(h.notices[0].kind, "contractor"); assert.equal(h.notices[0].applicationId, "app"); assert.equal(h.notices[0].submissionKey, "app");
});
await check("raw files are rejected before batch, storage or RPC use", async () => {
  const h = harness(), data = form(); data.set("document", new File(["%PDF-"], "file.pdf", { type: "application/pdf" }));
  await assert.rejects(h.submitContractor(data, "attempt"), status(400)); assert.deepEqual(h.events, []);
});
for (const [label, overrides, expected, options] of [
  ["missing consent", { policyAccepted: "false" }, 400], ["stale version", { policyVersion: "4" }, 409],
  ["stale timestamp", { policyUpdatedAt: "2000-01-01" }, 409], ["wrong policy", { policyId: "provider-policy" }, 409],
  ["unpublished", {}, 503, { policy: { ...policy, is_published: false } }], ["empty body", {}, 503, { policy: { ...policy, body: [] } }],
]) await check(`${label} fails before object verification or commit`, async () => {
  const h = harness(options); await assert.rejects(h.submitContractor(form(overrides), "attempt"), status(expected));
  assert.equal(h.events.includes("verify"), false); assert.equal(h.rpcCalls.length, 0); assert.equal(h.notices.length, 0);
});
await check("committed retry returns receipt without rechecking policy, files or notifying", async () => {
  const h = harness({ batch: { committed_at: "2026-10-01" }, policy: null });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.submitContractor(form(), "attempt"))), receipt);
  assert.deepEqual(h.events, ["resolve", "contractor_applications"]); assert.equal(h.notices.length, 0);
});
await check("revision notifications have a distinct token-bound key and never include raw token", async () => {
  const h = harness(); await h.submitContractor(form(), null, { applicationId: "app", token: "secret-revision-token" });
  assert.match(h.notices[0].submissionKey, /^app-[a-f0-9]{16}$/); assert.equal(JSON.stringify(h.notices).includes("secret-revision-token"), false);
  assert.equal(h.rpcCalls[0].p_fields.public_idempotency_key, null);
});
await check("conflict and stale constraint failures map409 without notification", async () => {
  for (const code of ["23505", "23514"]) {
    const h = harness({ rpcError: { code } }); await assert.rejects(h.submitContractor(form(), "attempt"), status(409)); assert.equal(h.notices.length, 0);
  }
});
await check("upload verification failure prevents transactional write", async () => {
  const h = harness({ verifyError: true }); await assert.rejects(h.submitContractor(form(), "attempt"), /incomplete upload/); assert.equal(h.rpcCalls.length, 0);
});
await check("notification failure does not invalidate committed application", async () => {
  const h = harness({ notificationError: true }); assert.deepEqual(await h.submitContractor(form(), "attempt"), receipt); assert.equal(h.errors.length, 1);
});
console.log(`PASS: ${passed} contractor server validation/submission groups (real modules, mocked DB, upload capabilities and notifications)`);
