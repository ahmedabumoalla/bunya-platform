import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { File as BufferFile } from "node:buffer";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Executes the real validation/submission modules with exclusively in-memory
// database, Storage, image-processing and messaging dependencies.
const FileClass = globalThis.File ?? BufferFile;
const sources = {
  fields: "../src/lib/join/provider-fields.ts",
  security: "../src/lib/join/security.ts",
  registry: "../src/lib/policies/registry.ts",
  username: "../src/lib/join/username.ts",
  validation: "../src/lib/join/provider-validation.ts",
  submit: "../src/lib/join/submit-provider.ts",
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, path]) => [name,
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
])));
const publishedPolicy = { id: "policy-1", title: "Test policy", version: 3, body: ["Test content only."], updated_at: "2026-09-30T10:00:00.000Z", policy_key: "provider-join", is_published: true };

function harness(options = {}) {
  const uploads = [], removals = [], rpcCalls = [], notifications = [], logs = [], policyQueries = [];
  let policy = options.policy === undefined ? publishedPolicy : options.policy;
  const db = {
    from(table) {
      const filters = [];
      const query = {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, maybeSingle() { return this; },
        then(resolve, reject) {
          if (table === "platform_policies") {
            policyQueries.push(filters);
            return Promise.resolve({ data: policy && filters.every(([key, value]) => policy[key] === value) ? policy : null, error: options.policyError ?? null }).then(resolve, reject);
          }
          if (table === "provider_application_documents") return Promise.resolve({ data: (options.existingTypes ?? []).map(document_type => ({ document_type })), error: null }).then(resolve, reject);
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "join-applications");
      return {
        async upload(path, bytes, settings) {
          uploads.push({ path, bytes, settings });
          return { error: options.failUploadAt === uploads.length ? { message: "mock storage failure" } : null };
        },
        async remove(paths) { removals.push([...paths]); return { error: null }; },
      };
    } },
    async rpc(name, args) {
      assert.equal(name, "save_provider_join_application");
      rpcCalls.push(args);
      return { error: options.rpcError ?? null, data: { applicationId: args.p_application_id, status: "pending", submittedAt: "2026-09-30T10:01:00.000Z" } };
    },
  };
  const cache = {};
  const aliases = { "./provider-fields": "fields", "./security": "security", "@/lib/policies/registry": "registry", "./username": "username", "./provider-validation": "validation" };
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {};
    cache[name] = exports;
    vm.runInNewContext(compiled[name], {
      exports, File: FileClass, FormData, Uint8Array, TextDecoder, Date, console: { error: (...values) => logs.push(values) },
      require(dependency) {
        if (dependency === "server-only") return {};
        if (dependency === "node:crypto") return crypto;
        if (dependency === "@/lib/supabase/admin") return { createAdminClient: () => db };
        if (dependency === "@/lib/uploads/server") return { async prepareUpload(file) { return { bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type, fileName: file.name, size: file.size }; } };
        if (dependency === "@/lib/notifications/join-reviewers") return { async notifyJoinReviewers(value) { notifications.push(value); if (options.notificationError) throw new Error("mock messaging failure"); } };
        if (aliases[dependency]) return load(aliases[dependency]);
        throw new Error(`Unexpected dependency: ${dependency}`);
      },
    }, { filename: sources[name] });
    return exports;
  }
  return { ...load("validation"), ...load("submit"), uploads, removals, rpcCalls, notifications, logs, policyQueries, setPolicy(next) { policy = next; } };
}

const keys = ["commercial_registration", "municipal_license", "national_address", "vat_certificate"];
function form(overrides = {}) {
  const data = new FormData();
  const fields = {
    companyName: "  شركة   مواد  البناء  العربية  ", companyNameEn: "  Arabian   Building  Materials Company  ", contactName: "",
    serviceCities: JSON.stringify(["  الرياض  ", "خميس   مشيط", "Riyadh", "riyadh"]), email: "provider@invalid.example", mobile: "0500000001", username: "provider_test",
    mapsUrl: "https://maps.google.com/?q=24,46", latitude: "24", longitude: "46", deliveryAvailable: "false", categories: JSON.stringify(["الحديد"]),
    policyAccepted: "true", policyId: publishedPolicy.id, policyVersion: String(publishedPolicy.version), policyUpdatedAt: publishedPolicy.updated_at,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) if (value !== null) data.set(key, value);
  return data;
}
function documents(data = form()) {
  for (const key of keys) data.set(`document:${key}`, new FileClass(["%PDF-1.7\nmock document"], `${key}.pdf`, { type: "application/pdf" }));
  return data;
}
const status = expected => error => error?.status === expected;
let checks = 0;
async function check(label, run) {
  try { await run(); checks++; }
  catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
}

const validation = harness();
await check("multiword names and city whitespace normalization", () => {
  const fields = validation.providerFields(form());
  assert.equal(fields.company_name, "شركة مواد البناء العربية");
  assert.equal(fields.company_name_en, "Arabian Building Materials Company");
  assert.equal(fields.contact_name, null);
  assert.deepEqual(Array.from(fields.service_cities), ["الرياض", "خميس مشيط", "Riyadh"]);
});
await check("optional missing/blank contact and normalized supplied contact", () => {
  for (const contactName of [null, "", "   "]) assert.equal(validation.providerFields(form({ contactName })).contact_name, null);
  assert.equal(validation.providerFields(form({ contactName: " مسؤول   الشركة " })).contact_name, "مسؤول الشركة");
  assert.equal(validation.providerFields(form({ contactName: "x".repeat(120) })).contact_name.length, 120);
  assert.throws(() => validation.providerFields(form({ contactName: "x".repeat(121) })), status(400));
});
await check("both names enforce inclusive 2–160 boundaries", () => {
  for (const key of ["companyName", "companyNameEn"]) {
    for (const value of [null, " ", "x", "x".repeat(161)]) assert.throws(() => validation.providerFields(form({ [key]: value })), status(400));
    for (const value of ["xx", "x".repeat(160)]) assert.doesNotThrow(() => validation.providerFields(form({ [key]: value })));
  }
});
await check("city list validation, deduplication and limits", () => {
  assert.equal(validation.providerFields(form({ serviceCities: JSON.stringify(Array.from({ length: 50 }, (_, index) => `City ${index}`)) })).service_cities.length, 50);
  for (const value of [null, "bad-json", "null", "{}", "[]", JSON.stringify([1]), JSON.stringify([" "]), JSON.stringify(["a"]), JSON.stringify(["a".repeat(101)]), JSON.stringify(Array.from({ length: 51 }, (_, index) => `City ${index}`))]) assert.throws(() => validation.providerFields(form({ serviceCities: value })), status(400));
  assert.doesNotThrow(() => validation.providerFields(form({ serviceCities: JSON.stringify(["a".repeat(100)]) })));
});
await check("four typed documents are required and valid", () => {
  assert.deepEqual(Array.from(validation.providerDocuments(documents()), item => item.type), keys);
  for (const key of keys) { const data = documents(); data.delete(`document:${key}`); assert.throws(() => validation.providerDocuments(data), status(400)); }
});
await check("revision retains typed documents and replaces one", () => {
  assert.equal(validation.providerDocuments(form(), keys).length, 0);
  const data = form(); data.set(`document:${keys[1]}`, new FileClass(["replacement"], "new.pdf", { type: "application/pdf" }));
  assert.equal(validation.providerDocuments(data, keys).length, 1);
  assert.throws(() => validation.providerDocuments(form(), ["supporting_document"]), status(400));
});
await check("reject duplicate, untyped and unknown document fields", () => {
  for (const field of [`document:${keys[0]}`, "document:unknown", "documents"]) {
    const data = documents(); data.append(field, new FileClass(["%PDF-1.7"], "extra.pdf", { type: "application/pdf" }));
    assert.throws(() => validation.providerDocuments(data), status(400));
  }
});
await check("reject text/empty/disallowed/oversize documents; allow four MIME types", () => {
  const badValues = ["text", new FileClass([], "empty.pdf", { type: "application/pdf" }), new FileClass(["x"], "bad.html", { type: "text/html" }), new FileClass([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" })];
  for (const value of badValues) { const data = documents(); data.set(`document:${keys[0]}`, value); assert.throws(() => validation.providerDocuments(data), status(400)); }
  for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) { const data = documents(); data.set(`document:${keys[0]}`, new FileClass(["x"], "file", { type })); assert.equal(validation.providerDocuments(data).length, 4); }
  const boundary = documents(); boundary.set(`document:${keys[0]}`, new FileClass([new Uint8Array(10 * 1024 * 1024)], "max.pdf", { type: "application/pdf" }));
  assert.equal(validation.providerDocuments(boundary).length, 4);
});
await check("consent must explicitly equal true", async () => {
  for (const value of [null, "", "false", "1", "TRUE"]) await assert.rejects(validation.providerPolicyAcceptance(form({ policyAccepted: value })), status(400));
});
await check("missing/draft/empty policy fails closed", async () => {
  for (const policy of [null, { ...publishedPolicy, is_published: false }, { ...publishedPolicy, body: [] }, { ...publishedPolicy, body: "" }, { ...publishedPolicy, body: ["  ", "\n\t"] }, { ...publishedPolicy, body: "  \n  " }]) {
    validation.setPolicy(policy);
    await assert.rejects(validation.providerPolicyAcceptance(form()), status(503));
  }
  validation.setPolicy(publishedPolicy);
});
await check("policy query requires published join policy", () => {
  assert.ok(validation.policyQueries.length > 0);
  for (const query of validation.policyQueries) {
    assert.ok(query.some(([key, value]) => key === "policy_key" && value === "provider-join"));
    assert.ok(query.some(([key, value]) => key === "is_published" && value === true));
  }
});
await check("stale/missing id, version and timestamp reject", async () => {
  for (const overrides of [{ policyId: null }, { policyId: "other" }, { policyVersion: null }, { policyVersion: "2" }, { policyUpdatedAt: null }, { policyUpdatedAt: "2026-09-29T00:00:00Z" }]) await assert.rejects(validation.providerPolicyAcceptance(form(overrides)), status(409));
});
await check("current consent freezes policy snapshot and timestamp", async () => {
  const acceptance = await validation.providerPolicyAcceptance(form());
  assert.equal(acceptance.joining_policy_id, publishedPolicy.id);
  assert.equal(acceptance.joining_policy_version, 3);
  assert.equal(acceptance.joining_policy_title, publishedPolicy.title);
  assert.equal(acceptance.joining_policy_body, publishedPolicy.body);
  assert.equal(acceptance.joining_policy_updated_at, publishedPolicy.updated_at);
  assert.ok(Number.isFinite(Date.parse(acceptance.joining_policy_accepted_at)));
});
await check("policy database error stops submission before uploads", async () => {
  const sample = harness({ policyError: { message: "mock lookup failure" } });
  await assert.rejects(sample.submitProvider(documents(), "test-key"));
  assert.equal(sample.uploads.length, 0); assert.equal(sample.rpcCalls.length, 0); assert.equal(sample.notifications.length, 0);
});
await check("missing documents stop submission before upload, persistence or messages", async () => {
  const sample = harness(); const data = documents(); data.delete(`document:${keys[3]}`);
  await assert.rejects(sample.submitProvider(data, "test-key"), status(400));
  assert.equal(sample.uploads.length, 0); assert.equal(sample.removals.length, 0);
  assert.equal(sample.rpcCalls.length, 0); assert.equal(sample.notifications.length, 0);
});
await check("successful submit passes typed rows and normalized fields to atomic RPC", async () => {
  const sample = harness();
  const receipt = await sample.submitProvider(documents(), "test-key");
  assert.equal(receipt.status, "pending"); assert.equal(sample.uploads.length, 4); assert.equal(sample.removals.length, 0);
  assert.equal(sample.rpcCalls.length, 1); assert.equal(sample.notifications.length, 1);
  const args = sample.rpcCalls[0];
  assert.equal(args.p_fields.company_name_en, "Arabian Building Materials Company");
  assert.equal(args.p_fields.contact_name, null);
  assert.equal(args.p_fields.joining_policy_version, 3);
  assert.deepEqual(Array.from(args.p_documents, item => item.document_type), keys);
  assert.ok(sample.uploads.every(item => item.path.startsWith(`join-applications/provider/${receipt.applicationId}/`) && item.settings.upsert === false));
});
await check("second upload failure removes only completed upload", async () => {
  const sample = harness({ failUploadAt: 2 });
  await assert.rejects(sample.submitProvider(documents(), "test-key"));
  assert.equal(sample.rpcCalls.length, 0); assert.equal(sample.notifications.length, 0);
  assert.deepEqual(sample.removals, [[sample.uploads[0].path]]);
});
await check("RPC conflict removes all temporary objects and returns conflict", async () => {
  for (const code of ["23505", "23514"]) {
    const sample = harness({ rpcError: { code } });
    await assert.rejects(sample.submitProvider(documents(), "test-key"), status(409));
    assert.equal(sample.notifications.length, 0);
    assert.deepEqual(sample.removals, [sample.uploads.map(item => item.path)]);
  }
});
await check("spoofed MIME content rejected with partial-upload cleanup", async () => {
  const sample = harness(); const data = documents();
  data.set(`document:${keys[1]}`, new FileClass(["<script>bad</script>"], "not-a-pdf.pdf", { type: "application/pdf" }));
  await assert.rejects(sample.submitProvider(data, "test-key"), status(400));
  assert.equal(sample.uploads.length, 1); assert.equal(sample.rpcCalls.length, 0);
  assert.deepEqual(sample.removals, [[sample.uploads[0].path]]);
});
await check("committed application survives notification failure", async () => {
  const sample = harness({ notificationError: true });
  assert.equal((await sample.submitProvider(documents(), "test-key")).status, "pending");
  assert.equal(sample.removals.length, 0); assert.equal(sample.logs.length, 1);
});
await check("revision keeps existing files and hashes revision token", async () => {
  const sample = harness({ existingTypes: keys });
  const receipt = await sample.submitProvider(form(), null, { applicationId: "existing-application", token: "mock-revision-token" });
  assert.equal(receipt.applicationId, "existing-application"); assert.equal(sample.uploads.length, 0);
  assert.equal(sample.rpcCalls[0].p_revision_token_hash, crypto.createHash("sha256").update("mock-revision-token").digest("hex"));
});
console.log(`Provider join validation/submission regression groups passed: ${checks} (mocked database, Storage and messaging only).`);
