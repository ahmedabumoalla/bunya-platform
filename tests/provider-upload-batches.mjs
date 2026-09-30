import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Real upload/session code, in-memory query semantics, and no external requests.
const paths = {
  batches: "../src/lib/join/provider-upload-batches.ts",
  security: "../src/lib/join/security.ts",
  fields: "../src/lib/join/provider-fields.ts",
  route: "../src/app/api/public/join/provider/uploads/route.ts",
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name,
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
])));
const documentTypes = ["commercial_registration", "municipal_license", "national_address", "vat_certificate"];
const key = "provider-test-attempt-0001";
const revisionToken = "revision-test-token";
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const descriptors = () => documentTypes.map(documentType => ({ documentType, name: `${documentType}.pdf`, mimeType: "application/pdf", size: 11 * 1024 * 1024 }));
function form(documents = descriptors(), fields = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries({ email: "provider@invalid.example", mobile: "0500000001", documents: JSON.stringify(documents), ...fields })) data.set(name, value);
  return data;
}
const status = expected => error => error?.status === expected;

function harness(options = {}) {
  const rows = { provider_upload_batches: [], provider_applications: [], provider_application_documents: [], join_application_revision_tokens: [], files: [], ...options.rows };
  const queries = [], signedUploads = [], signedReads = [], removals = [], requests = [], bodies = [];
  const db = {
    from(table) {
      assert.ok(table in rows, `Unexpected table ${table}`);
      const filters = [];
      let operation = "select", values, single = false, limit = Infinity;
      const query = {
        select() { return this; }, insert(value) { operation = "insert"; values = value; return this; }, delete() { operation = "delete"; return this; },
        eq(field, value) { filters.push(["eq", field, value]); return this; }, is(field, value) { filters.push(["is", field, value]); return this; },
        gt(field, value) { filters.push(["gt", field, value]); return this; }, lt(field, value) { filters.push(["lt", field, value]); return this; },
        in(field, value) { filters.push(["in", field, value]); return this; }, limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; }, single() { single = true; return this; },
        then(resolve, reject) {
          queries.push({ table, operation, filters: [...filters], limit });
          if (options.queryError?.table === table && options.queryError.operation === operation) return Promise.resolve({ data: null, error: new Error("mock DB failure") }).then(resolve, reject);
          const matches = row => filters.every(([operator, field, value]) => operator === "eq" ? row[field] === value
            : operator === "is" ? (row[field] ?? null) === value
              : operator === "in" ? value.includes(row[field])
                : row[field] != null && (operator === "gt" ? row[field] > value : row[field] < value));
          let data;
          if (operation === "insert") { rows[table].push(structuredClone(values)); data = null; }
          else if (operation === "delete") { rows[table] = rows[table].filter(row => !matches(row)); data = null; }
          else { data = rows[table].filter(matches).slice(0, limit); if (single) data = data[0] ?? null; }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "join-applications");
      return {
        async createSignedUploadUrl(path, settings) { signedUploads.push({ path, settings }); return { data: { token: "signed-upload-token" }, error: null }; },
        async info(path) {
          const document = rows.provider_upload_batches.flatMap(batch => batch.documents).find(document => document.object_path === path);
          assert.ok(document);
          return { data: { size: document.size_bytes, contentType: document.mime_type, ...options.info }, error: options.infoError ? new Error("incomplete") : null };
        },
        async createSignedUrl(path, duration) { signedReads.push({ path, duration }); return { data: { signedUrl: `https://storage.invalid/${encodeURIComponent(path)}` }, error: null }; },
        async remove(paths) { removals.push([...paths]); return { error: options.removeError ? new Error("mock removal failure") : null }; },
      };
    } },
  };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {};
    cache[name] = exports;
    vm.runInNewContext(compiled[name], {
      exports, File, FormData, Uint8Array, TextDecoder, Date, URL, Response, AbortSignal,
      async fetch(url, settings) {
        requests.push({ url, settings });
        const state = { arrayBuffers: 0, cancelled: false, pulls: 0 };
        bodies.push(state);
        const bytes = options.header ?? new TextEncoder().encode("%PDF-1.7\n   ");
        const body = new ReadableStream({
          pull(controller) { state.pulls++; controller.enqueue(bytes); controller.close(); },
          cancel() { state.cancelled = true; },
        });
        const response = new Response(body, { status: options.responseStatus ?? 206 });
        const arrayBuffer = response.arrayBuffer.bind(response);
        response.arrayBuffer = () => { state.arrayBuffers++; return arrayBuffer(); };
        return response;
      },
      require(dependency) {
        if (dependency === "server-only") return {};
        if (dependency === "node:crypto") return crypto;
        if (dependency === "@/lib/supabase/admin") return { createAdminClient: () => db };
        if (dependency === "@/lib/supabase/env") return { getSupabasePublicEnv: () => ({ url: "https://example.supabase.co" }) };
        if (dependency === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (dependency === "@/lib/join/provider-validation") return { providerFields() {}, async providerPolicyAcceptance() {} };
        if (dependency.endsWith("provider-upload-batches")) return load("batches");
        if (dependency.endsWith("provider-fields")) return load("fields");
        if (dependency === "./security") return load("security");
        if (dependency === "@/lib/join/security") return { ...load("security"), verifyTurnstile: async () => {} };
        throw new Error(`Unexpected dependency ${dependency}`);
      },
    }, { filename: paths[name] });
    return exports;
  }
  return { ...load("batches"), route: load("route"), db, rows, queries, signedUploads, signedReads, removals, requests, bodies };
}

let checks = 0;
async function check(label, run) {
  try { await run(); checks++; }
  catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
}

await check("large-file descriptors produce private server-generated paths and non-upsert signatures", async () => {
  const h = harness(), input = descriptors();
  input[0].name = "../../caller-path.pdf";
  input[0].path = "caller-controlled";
  input[0].id = "caller-controlled";
  const batch = await h.beginProviderUpload(form(input), key, h.db);
  assert.equal(batch.endpoint, "https://example.storage.supabase.co/storage/v1/upload/resumable/sign");
  assert.equal(batch.bucket, "join-applications");
  assert.match(batch.uploadToken, /^[a-f0-9]{64}$/);
  const stored = h.rows.provider_upload_batches[0];
  assert.equal(stored.token_hash, h.uploadHash(batch.uploadToken));
  assert.equal(JSON.stringify(stored).includes(batch.uploadToken), false);
  assert.ok(Date.parse(stored.expires_at) > Date.now());
  assert.equal(new Set(batch.files.map(file => file.path)).size, 4);
  for (const [index, target] of batch.files.entries()) {
    assert.match(target.path, new RegExp(`^join-applications/provider/${stored.application_id}/[a-f0-9]{48}$`));
    assert.equal(target.token, "signed-upload-token");
    assert.equal(h.signedUploads[index].settings.upsert, false);
    assert.notEqual(stored.documents[index].id, "caller-controlled");
  }
});

await check("missing, duplicate, invalid descriptor types and unsafe sizes fail before storage", async () => {
  const invalid = [[], descriptors().slice(1), [...descriptors(), descriptors()[0]], [descriptors()[0], descriptors()[0]], null, {}, [null], ["file"]];
  for (const patch of [{ documentType: "supporting_document" }, { documentType: 1 }, { name: "" }, { name: "x\n.pdf" }, { name: "x".repeat(201) }, { name: 2 }, { mimeType: "text/html" }, { size: 0 }, { size: -1 }, { size: 1.5 }, { size: "100" }, { size: Number.MAX_SAFE_INTEGER + 1 }]) {
    const docs = descriptors(); docs[0] = { ...docs[0], ...patch }; invalid.push(docs);
  }
  for (const docs of invalid) {
    const h = harness();
    await assert.rejects(h.beginProviderUpload(form(docs), key, h.db), status(400));
    assert.equal(h.rows.provider_upload_batches.length, 0);
    assert.equal(h.signedUploads.length, 0);
  }
  for (const documents of ["{", "", "null"]) {
    const h = harness(); await assert.rejects(h.beginProviderUpload(form([], { documents }), key, h.db), status(400));
  }
  for (const attempt of [null, "short", "!".repeat(20), "a".repeat(129)]) {
    const h = harness(); await assert.rejects(h.beginProviderUpload(form(), attempt, h.db), status(400));
  }
});

await check("real initialization route rejects binary files and oversized metadata before batch creation", async () => {
  for (const mode of ["binary", "oversize", "stream-oversize"]) {
    const h = harness();
    const data = form();
    if (mode === "binary") data.set("document:commercial_registration", new File(["%PDF-"], "document.pdf", { type: "application/pdf" }));
    if (mode === "stream-oversize") data.set("oversized", "x".repeat(128 * 1024));
    const request = new Request("https://bunya.invalid/api/public/join/provider/uploads", { method: "POST", body: data, headers: mode === "oversize" ? { "content-length": String(128 * 1024 + 1) } : {} });
    request.nextUrl = new URL(request.url);
    const response = await h.route.POST(request);
    assert.equal(response.status, mode === "binary" ? 400 : 413);
    assert.equal(h.rows.provider_upload_batches.length, 0);
    assert.equal(h.signedUploads.length, 0);
  }
});

await check("real initialization route accepts metadata only without document bytes", async () => {
  const h = harness();
  const request = new Request("https://bunya.invalid/api/public/join/provider/uploads", { method: "POST", body: form(descriptors(), { categories: '["building materials"]' }), headers: { "Idempotency-Key": key } });
  request.nextUrl = new URL(request.url);
  const response = await h.route.POST(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).files.length, 4);
  assert.equal(h.rows.provider_upload_batches.length, 1);
});

async function initialized(options = {}, revision = false) {
  const h = harness(options);
  if (revision) {
    h.rows.join_application_revision_tokens.push({ token_hash: h.uploadHash(revisionToken), application_kind: "provider", application_id: "existing-application", attempts: 0, max_attempts: 3, used_at: null, expires_at: hoursAgo(-1) });
    h.rows.provider_applications.push({ id: "existing-application", status: "needs_changes" });
    h.rows.provider_application_documents.push(...documentTypes.map(document_type => ({ application_id: "existing-application", is_current: true, document_type })));
  }
  const data = form(revision ? [] : descriptors(), revision ? { revisionToken } : {});
  const result = await h.beginProviderUpload(data, revision ? null : key, h.db);
  data.set("uploadToken", result.uploadToken);
  return { h, data, stored: h.rows.provider_upload_batches[0] };
}

await check("resolve binds secret token, normalized identity and idempotency key", async () => {
  const { h, data, stored } = await initialized();
  assert.equal((await h.resolveProviderUpload(data, key, undefined, h.db)).id, stored.id);
  data.set("email", " PROVIDER@INVALID.EXAMPLE "); data.set("mobile", "+966500000001");
  assert.equal((await h.resolveProviderUpload(data, key, undefined, h.db)).id, stored.id);
  for (const [field, value, expected] of [["uploadToken", "forged", 400], ["uploadToken", "f".repeat(64), 403], ["email", "another@invalid.example", 403], ["mobile", "0500000002", 403]]) {
    const original = data.get(field); data.set(field, value);
    await assert.rejects(h.resolveProviderUpload(data, key, undefined, h.db), status(expected)); data.set(field, original);
  }
  await assert.rejects(h.resolveProviderUpload(data, "different-attempt", undefined, h.db), status(403));
  await assert.rejects(h.resolveProviderUpload(data, key, { applicationId: stored.application_id, token: revisionToken }, h.db), status(403));
  stored.expires_at = hoursAgo(1);
  await assert.rejects(h.resolveProviderUpload(data, key, undefined, h.db), status(410));
  stored.committed_at = hoursAgo(2);
  assert.equal((await h.resolveProviderUpload(data, key, undefined, h.db)).id, stored.id, "committed batch remains available for idempotent retry");
});

await check("revision permits no replacements but binds application and revision token", async () => {
  const { h, data, stored } = await initialized({}, true);
  assert.equal(stored.application_id, "existing-application");
  assert.equal(stored.documents.length, 0);
  assert.equal(h.signedUploads.length, 0);
  const revision = { applicationId: stored.application_id, token: revisionToken };
  assert.equal((await h.resolveProviderUpload(data, null, revision, h.db)).id, stored.id);
  for (const wrong of [undefined, { ...revision, token: "wrong-token" }, { ...revision, applicationId: "other-application" }]) await assert.rejects(h.resolveProviderUpload(data, null, wrong, h.db), status(403));
  h.rows.provider_application_documents.pop();
  await assert.rejects(h.beginProviderUpload(form([], { revisionToken }), null, h.db), status(400));
});

await check("revision rejects used, expired, exhausted and non-revisable applications", async () => {
  for (const change of [row => { row.used_at = hoursAgo(1); }, row => { row.expires_at = hoursAgo(1); }, row => { row.attempts = row.max_attempts; }]) {
    const { h } = await initialized({}, true); change(h.rows.join_application_revision_tokens[0]);
    await assert.rejects(h.beginProviderUpload(form([], { revisionToken }), null, h.db), status(410));
  }
  const { h } = await initialized({}, true); h.rows.provider_applications[0].status = "pending";
  await assert.rejects(h.beginProviderUpload(form([], { revisionToken }), null, h.db), status(410));
});

await check("verification matches byte count and MIME before requesting tiny signed ranges", async () => {
  const { h, stored } = await initialized();
  assert.equal((await h.verifyProviderUpload(stored, h.db)).length, 4);
  assert.equal(h.requests.length, 4);
  assert.ok(h.bodies.every(body => body.arrayBuffers === 0), "verification must use the bounded reader even for 206 responses");
  for (const request of h.requests) {
    assert.equal(request.settings.headers.Range, "bytes=0-11");
    assert.equal(request.settings.cache, "no-store");
    assert.ok(request.settings.signal instanceof AbortSignal);
  }
  assert.ok(h.signedReads.every(read => read.duration === 60));
  for (const options of [{ infoError: true }, { info: { size: 11 * 1024 * 1024 - 1 } }, { info: { contentType: "text/html" } }]) {
    const { h: bad, stored: incomplete } = await initialized(options);
    await assert.rejects(bad.verifyProviderUpload(incomplete, bad.db), status(400));
    assert.equal(bad.requests.length, 0);
    assert.equal(bad.signedReads.length, 0);
  }
});

await check("verification rejects invalid magic, oversized partial response and full-response fallback", async () => {
  for (const options of [{ header: new TextEncoder().encode("<html>unsafe") }, { header: new TextEncoder().encode("%PDF-" + "x".repeat(8)) }, { responseStatus: 200 }]) {
    const { h, stored } = await initialized(options);
    await assert.rejects(h.verifyProviderUpload(stored, h.db), status(options.responseStatus === 200 ? 503 : options.header.length > 12 ? 413 : 400));
    assert.equal(h.requests.length, 1);
    assert.equal(h.bodies[0].arrayBuffers, 0);
    if (options.responseStatus === 200) {
      assert.equal(h.bodies[0].arrayBuffers, 0, "must not buffer an entire object when Range is ignored");
      assert.equal(h.bodies[0].cancelled, true);
    }
  }
  const h = harness();
  for (const [mime, header] of [["application/pdf", [37, 80, 68, 70, 45]], ["image/jpeg", [255, 216, 255]], ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]], ["image/webp", [...new TextEncoder().encode("RIFF0000WEBP")]]]) {
    assert.equal(h.validDocumentHeader(new Uint8Array(header), mime), true);
    assert.equal(h.validDocumentHeader(new Uint8Array([0, 1, 2]), mime), false);
  }
});

await check("bounded reader cancels oversized streams without downloading remaining chunks", async () => {
  const h = harness();
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(h.readBoundedBytes(stream, 12), status(413));
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  const small = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); } });
  assert.deepEqual(Array.from(await h.readBoundedBytes(small, 3)), [1, 2, 3]);
  assert.equal((await h.readBoundedBytes(null, 12)).length, 0);
});

function cleanupRows() {
  return [
    { id: "abandoned", expires_at: hoursAgo(26), committed_at: null, documents: [{ object_path: "abandoned-object" }] },
    { id: "empty", expires_at: hoursAgo(26), committed_at: null, documents: [] },
    { id: "referenced", expires_at: hoursAgo(26), committed_at: null, documents: [{ object_path: "referenced-object" }] },
    { id: "recent-expiry", expires_at: hoursAgo(2), committed_at: null, documents: [{ object_path: "recent-object" }] },
    { id: "active", expires_at: hoursAgo(-1), committed_at: null, documents: [{ object_path: "active-object" }] },
    { id: "completed-old", expires_at: hoursAgo(200), committed_at: hoursAgo(8 * 24), documents: [{ object_path: "completed-object" }] },
    { id: "completed-recent", expires_at: hoursAgo(26), committed_at: hoursAgo(1), documents: [{ object_path: "recent-completed-object" }] },
  ];
}
await check("cleanup removes only sufficiently expired uncommitted objects through Storage API", async () => {
  const h = harness({ rows: { provider_upload_batches: cleanupRows(), files: [{ bucket_id: "join-applications", object_path: "referenced-object" }] } });
  assert.equal(await h.cleanupProviderUploads(h.db), 2);
  assert.deepEqual(h.removals, [["abandoned-object"]]);
  assert.deepEqual(h.rows.provider_upload_batches.map(batch => batch.id), ["referenced", "recent-expiry", "active", "completed-recent"]);
  const selection = h.queries.find(query => query.table === "provider_upload_batches" && query.operation === "select");
  assert.equal(selection.limit, 25);
  assert.ok(selection.filters.some(([operator, field, value]) => operator === "is" && field === "committed_at" && value === null));
  const metadataDeletes = h.queries.filter(query => query.table === "provider_upload_batches" && query.operation === "delete");
  assert.equal(metadataDeletes.length, 3, "two expired batches plus completed metadata retention pass");
  assert.ok(metadataDeletes.slice(0, 2).every(query => query.filters.some(([operator, field]) => operator === "is" && field === "committed_at")));
  assert.ok(metadataDeletes[2].filters.some(([operator, field]) => operator === "lt" && field === "committed_at"));
  assert.equal(h.queries.some(query => query.table === "files" && query.operation !== "select"), false);
});

await check("cleanup preserves metadata if Storage removal or reference lookup fails", async () => {
  for (const options of [{ removeError: true }, { queryError: { table: "files", operation: "select" } }]) {
    const h = harness({ ...options, rows: { provider_upload_batches: cleanupRows() } });
    await assert.rejects(h.cleanupProviderUploads(h.db));
    assert.ok(h.rows.provider_upload_batches.some(batch => batch.id === "abandoned"));
    assert.equal(h.queries.some(query => query.operation === "delete"), false);
    if (options.queryError) assert.equal(h.removals.length, 0);
  }
});

console.log(`PASS: ${checks} provider upload batch security and lifecycle groups (real modules, mocked DB/Storage only)`);
