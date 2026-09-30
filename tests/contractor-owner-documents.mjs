import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const routeCode = compile(await readFile(new URL("../src/app/api/contractor/documents/[documentId]/route.ts", import.meta.url), "utf8"));
const helperCode = compile(await readFile(new URL("../src/lib/join/provider-document-download.ts", import.meta.url), "utf8"));
const documentId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const contractorId = "44444444-4444-4444-8444-444444444444";
async function check(options = {}) {
  const signed = [], queries = [];
  const identity = { userId, status: options.status ?? "ready", profile: { mustChangePassword: options.reset ?? false }, activeRoles: options.noRole ? ["customer"] : ["contractor", "customer"], details: { contractor: options.noProfile ? null : { contractorProfileId: contractorId } } };
  const records = {
    contractor_documents: [{ id: documentId, application_id: options.legacy ? null : applicationId, contractor_profile_id: options.wrongDocumentOwner ? "other-contractor" : contractorId, is_current: !options.historical, storage_path: options.path ?? `join-applications/contractor/${applicationId}/file.mp4` }],
    contractor_applications: [{ id: applicationId, applicant_profile_id: options.forgedApplication ? "other-user" : userId }],
  };
  const admin = {
    from(table) {
      queries.push(table); const filters = [];
      return { select() { return this; }, eq(key, value) { filters.push(row => row[key] === value); return this; }, maybeSingle() { return Promise.resolve({ data: records[table].find(row => filters.every(match => match(row))) ?? null, error: options.queryError ? { code: "TEST" } : null }); } };
    },
    storage: { from(bucket) { assert.equal(bucket, "join-applications"); return { createSignedUrl: async (path, expiry) => { signed.push({ path, expiry }); return { data: { signedUrl: "https://storage.invalid/private?token=mock" }, error: null }; } }; } },
  };
  const helper = {};
  vm.runInNewContext(helperCode, { exports: helper, require(name) { if (name === "server-only") return {}; if (name === "next/server") return { NextResponse: Response }; throw new Error(name); } });
  const exports = {};
  vm.runInNewContext(routeCode, { exports, require(name) {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/auth/server") return { getAuthIdentity: async () => options.anonymous ? null : identity };
    if (name === "@/lib/supabase/admin") return { createAdminClient: () => admin };
    if (name === "@/lib/join/provider-document-download") return helper;
    throw new Error(name);
  } });
  const response = await exports.GET(new Request("https://bunya.invalid/document"), { params: Promise.resolve({ documentId: options.invalidId ? "bad" : documentId }) });
  return { response, signed, queries };
}
const success = await check();
assert.equal(success.response.status, 307);
assert.match(success.response.headers.get("cache-control"), /no-store/);
assert.equal(success.signed.length, 1);
assert.equal(success.signed[0].expiry, 300);
assert.deepEqual(success.queries, ["contractor_documents", "contractor_applications"]);
for (const [options, status] of [
  [{ anonymous: true }, 401], [{ status: "inactive" }, 403], [{ reset: true }, 403], [{ noRole: true }, 403], [{ noProfile: true }, 403],
  [{ invalidId: true }, 404], [{ historical: true }, 404], [{ wrongDocumentOwner: true }, 404], [{ forgedApplication: true }, 404], [{ legacy: true }, 404], [{ queryError: true }, 500],
  [{ path: `join-applications/provider/${applicationId}/file.mp4` }, 403], [{ path: `join-applications/contractor/${applicationId}/../file.mp4` }, 403],
]) {
  const denied = await check(options); assert.equal(denied.response.status, status, JSON.stringify(options)); assert.equal(denied.signed.length, 0);
}
console.log("PASS: contractor owner signed downloads, independent application ownership, role/current/path denials (mocked I/O)");
