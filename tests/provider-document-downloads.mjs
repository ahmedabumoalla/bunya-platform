import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const paths = {
  helper: "../src/lib/join/provider-document-download.ts",
  admin: "../src/app/api/admin/join-requests/[kind]/[id]/documents/[documentId]/route.ts",
  revision: "../src/app/api/public/join/revise/[token]/documents/[documentId]/route.ts",
  dossier: "../src/app/api/admin/users/[id]/documents/[documentId]/route.ts",
};
const compiled = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name,
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
])));
const applicationId = "11111111-1111-4111-8111-111111111111";
const otherApplicationId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const revisionToken = "test-revision-token";
const objectPath = `join-applications/provider/${applicationId}/object`;

function harness(options = {}) {
  const signed = [], queries = [], events = [];
  const document = { id: documentId, application_id: options.documentApplicationId ?? applicationId, files: { object_path: options.path ?? objectPath, bucket_id: options.bucket ?? "join-applications", scan_status: options.scan ?? "pending", original_name: "document.pdf", mime_type: "application/pdf" } };
  const tables = {
    provider_application_documents: options.missingDocument ? [] : [document],
    provider_applications: [{ id: applicationId, status: options.applicationStatus ?? "needs_changes" }],
    join_application_revision_tokens: [{ token_hash: crypto.createHash("sha256").update(revisionToken).digest("hex"), application_kind: "provider", application_id: applicationId, attempts: options.attempts ?? 0, max_attempts: 3, used_at: options.used ? new Date().toISOString() : null, expires_at: new Date(Date.now() + (options.expired ? -1 : 1) * 3600000).toISOString() }],
  };
  const db = {
    from(table) {
      assert.ok(table in tables, `unexpected table ${table}`);
      const filters = [];
      return {
        select(selection) { queries.push({ table, selection }); return this; }, eq(field, value) { filters.push(row => row[field] === value); return this; },
        is(field, value) { filters.push(row => row[field] === value); return this; }, gt(field, value) { filters.push(row => row[field] > value); return this; },
        maybeSingle() { return Promise.resolve({ data: tables[table].find(row => filters.every(filter => filter(row))) ?? null, error: null }); },
      };
    },
    storage: { from(bucket) {
      assert.equal(bucket, "join-applications");
      return {
        async createSignedUrl(path, expiresIn, settings) {
          events.push("sign"); signed.push({ bucket, path, expiresIn, settings });
          return { data: { signedUrl: "https://storage.invalid/private-object?token=temporary" }, error: options.signError ? new Error("mock signer failure") : null };
        },
        download() { throw new Error("Provider documents must never be downloaded/buffered by the route"); },
      };
    } },
  };
  class UserDetailError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const details = {
    UserDetailError, userIdPattern: /^[a-f0-9-]{36}$/,
    async requireUserDetailAccess(id) { events.push("authorize"); assert.equal(id, userId); if (options.denied) throw new UserDetailError(403, "denied"); return { admin: db }; },
    async userDetailLinks() { events.push("links"); return { providerIds: [], contractorIds: [], providerApplicationIds: options.unlinked ? [] : [applicationId, otherApplicationId], contractorApplicationIds: [] }; },
    documentQuery(_access, links, id, source, full) {
      events.push("document"); assert.equal(id, userId); assert.equal(source, "provider_application"); assert.equal(full, true);
      let matchedId;
      return { eq(field, value) { assert.equal(field, "id"); matchedId = value; return this; }, limit() { return { data: !options.missingDocument && document.id === matchedId && links.providerApplicationIds.includes(document.application_id) ? [document] : [], error: null }; } };
    },
    rows: result => result.data,
    userDetailFailure: error => Response.json({ message: error.message }, { status: error.status ?? 500 }), userDetailHeaders: {},
  };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    vm.runInNewContext(compiled[name], {
      exports, URL, Date, process: { env: {} },
      fetch() { throw new Error("Provider route must not proxy Storage bytes"); },
      require(dependency) {
        if (dependency === "server-only") return {};
        if (dependency === "next/server") return { NextResponse: Response };
        if (dependency === "node:crypto") return crypto;
        if (dependency === "@/lib/join/provider-document-download") return load("helper");
        if (dependency === "@/lib/join/admin") return { requireJoinReviewer: async () => { events.push("authorize"); return options.denied ? { error: options.denied } : { admin: db }; } };
        if (dependency === "@/lib/admin/user-details") return details;
        if (dependency === "@/lib/supabase/admin") return { createAdminClient: () => db };
        if (dependency === "@/lib/supabase/env") return { getSupabasePublicEnv: () => { throw new Error("Provider direct redirects need no raw credentials"); } };
        throw new Error(`Unexpected dependency ${dependency}`);
      },
    }, { filename: paths[name] });
    return exports;
  }
  async function get(route, overrides = {}) {
    const params = route === "admin" ? { kind: "provider", id: applicationId, documentId, ...overrides }
      : route === "revision" ? { token: revisionToken, documentId, ...overrides } : { id: userId, documentId, ...overrides };
    return load(route).GET(new Request("https://bunya.invalid/document?source=provider_application"), { params: Promise.resolve(params) });
  }
  return { get, signed, queries, events };
}

let checks = 0;
async function check(label, run) { try { await run(); checks++; } catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); } }

await check("authorized reviewer, valid revision and account dossier redirect directly to private Storage", async () => {
  for (const route of ["admin", "revision", "dossier"]) {
    const h = harness(); const response = await h.get(route);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://storage.invalid/private-object?token=temporary");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.body, null);
    assert.equal(h.signed.length, 1); assert.equal(h.signed[0].expiresIn, 300);
    assert.equal(h.signed[0].path, objectPath); assert.equal(h.signed[0].settings, undefined, "inline default must not force download filenames");
    if (route === "dossier") assert.deepEqual(h.events, ["authorize", "links", "document", "sign"]);
  }
});

await check("authorization and document relationship failures never sign", async () => {
  for (const [route, options, overrides, expected] of [
    ["admin", { denied: "unauthorized" }, {}, 401], ["admin", { denied: "forbidden" }, {}, 403],
    ["admin", {}, { kind: "invalid" }, 404], ["admin", { missingDocument: true }, {}, 404], ["admin", { documentApplicationId: otherApplicationId }, {}, 404],
    ["revision", {}, { token: "invalid" }, 410], ["revision", { expired: true }, {}, 410], ["revision", { used: true }, {}, 410],
    ["revision", { attempts: 3 }, {}, 410], ["revision", { applicationStatus: "pending" }, {}, 410], ["revision", { documentApplicationId: otherApplicationId }, {}, 404],
    ["dossier", { denied: true }, {}, 403], ["dossier", { unlinked: true }, {}, 404], ["dossier", {}, { documentId: "invalid" }, 404],
  ]) {
    const h = harness(options); assert.equal((await h.get(route, overrides)).status, expected); assert.equal(h.signed.length, 0);
  }
});

await check("path escape, cross-application scope and quarantine reject before signing", async () => {
  const invalidPaths = [`join-applications/provider/${otherApplicationId}/object`, `join-applications/contractor/${applicationId}/object`, `${objectPath}/../private`, `${objectPath}/%2e%2e/private`, `${objectPath}/%252e%252e/private`, `${objectPath}\\private`, `${objectPath}//private`, `${objectPath}/\u0000private`];
  for (const route of ["admin", "revision", "dossier"]) {
    for (const path of invalidPaths) {
      const h = harness({ path }); assert.equal((await h.get(route)).status, 403, `${route}: ${JSON.stringify(path)}`); assert.equal(h.signed.length, 0);
    }
    for (const scan of ["quarantined", "rejected"]) {
      const h = harness({ scan }); assert.equal((await h.get(route)).status, 403); assert.equal(h.signed.length, 0);
    }
  }
  for (const route of ["admin", "revision"]) {
    const h = harness({ bucket: "public-bucket" }); assert.equal((await h.get(route)).status, 403); assert.equal(h.signed.length, 0);
  }
});

await check("signer failures do not expose temporary URLs", async () => {
  for (const route of ["admin", "revision", "dossier"]) {
    const response = await harness({ signError: true }).get(route);
    assert.equal(response.status, 500); assert.equal(response.headers.get("location"), null);
    assert.equal((await response.text()).includes("token="), false);
  }
});

console.log(`PASS: ${checks} provider document download authorization/security groups (real routes/helper; mocked authorization and Storage)`);
