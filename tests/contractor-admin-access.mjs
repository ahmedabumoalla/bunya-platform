import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const authCode = compile(await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8"));
const approvalCode = compile(`${await readFile(new URL("../src/app/api/admin/join-requests/[kind]/[id]/[action]/route.ts", import.meta.url), "utf8")}\nexport { resolveAvailableJoinUsername };`);
const fields = {};
vm.runInNewContext(compile(await readFile(new URL("../src/lib/join/provider-fields.ts", import.meta.url), "utf8")), { exports: fields });

async function portal(identity, role = "customer") {
  const exports = {};
  vm.runInNewContext(authCode, { exports, require(name) {
    if (name === "server-only") return {};
    if (name === "react") return { cache: fn => fn };
    if (name === "next/navigation") return { redirect: path => { throw new Error(`redirect:${path}`); } };
    if (name === "@/lib/supabase/server") return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: identity ? { id: "test" } : null }, error: null }) } }) };
    if (name === "./resolve-identity") return { resolveAuthIdentity: async () => identity, roleIsReady: (value, details) => value === "customer" ? details.customer.exists : Boolean(details[value]) };
    if (name === "./types") return { routeForRole: value => `/${value}` };
    throw new Error(name);
  } });
  return exports.requirePortalRole(role);
}
const identity = { status: "ready", primaryRole: "contractor", activeRoles: ["contractor", "customer"], profile: { mustChangePassword: false }, details: { customer: { exists: true }, contractor: { approvalStatus: "approved" } } };
assert.equal(await portal(identity), identity);
assert.equal(await portal(identity, "contractor"), identity);
await assert.rejects(portal(null), /redirect:\/login$/);
await assert.rejects(portal({ ...identity, status: "inactive" }), /error=inactive/);
await assert.rejects(portal({ ...identity, profile: { mustChangePassword: true } }), /change-password/);
await assert.rejects(portal({ ...identity, activeRoles: ["contractor"] }), /redirect:\/contractor/);
await assert.rejects(portal({ ...identity, details: { ...identity.details, customer: { exists: false } } }), /redirect:\/contractor/);
await assert.rejects(portal({ ...identity, details: { ...identity.details, contractor: null } }), /redirect:\/contractor/);
await assert.rejects(portal({ ...identity, primaryRole: "provider", activeRoles: ["provider", "customer"] }), /redirect:\/provider/);
await assert.rejects(portal(identity, "admin"), /redirect:\/contractor/);

function usernames(conflictTable, lookupError = false) {
  const queries = [];
  const admin = { from(table) {
    const query = { table }; queries.push(query);
    return {
      select() { return this; }, neq(field, value) { query.exclude = { field, value }; return this; }, in() { return this; },
      ilike(field, value) { query.field = field; query.value = value; return this; },
      limit() { return Promise.resolve({ data: table === conflictTable ? [{ id: "conflict" }] : [], error: lookupError ? { code: "DB_FAILURE" } : null }); },
    };
  } };
  const exports = {};
  vm.runInNewContext(approvalCode, { exports, require(name) { return name === "@/lib/join/provider-fields" ? fields : {}; } });
  return { queries, resolve: value => exports.resolveAvailableJoinUsername(admin, value, "application-id", "contractor") };
}
for (const value of ["AB", "Full English Contractor Company", "Long ".repeat(30).trim(), "a_b%z"]) {
  const h = usernames();
  assert.equal((await h.resolve(value)).value, value, "full requested name retained without suffix or truncation");
  assert.equal(h.queries.find(query => query.table === "contractor_applications").exclude.value, "application-id");
}
for (const table of ["profiles", "provider_profiles", "provider_applications", "contractor_applications"]) {
  assert.equal((await usernames(table).resolve("Full English Contractor Company")).value, null, `${table} conflict is not silently renamed`);
}
assert.equal((await usernames().resolve("A")).value, null);
assert.equal((await usernames().resolve("a".repeat(161))).value, null);
assert.equal((await usernames(undefined, true).resolve("Valid Username")).error.code, "DB_FAILURE");
console.log("PASS: contractor customer portal authorization and approval username preservation/conflict checks (mocked I/O)");
