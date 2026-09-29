import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// All database and messaging dependencies are in-memory fakes. No real messages.
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/notifications/join-reviewers.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reviewer = (id, mobile, role = "super", active = true) => ({ profile_id: id, role_id: role, profiles: { mobile, email: `${id}@invalid.example`, full_name: id, is_active: active } });
const normalize = value => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("05")) digits = `966${digits.slice(1)}`;
  if (!/^9665\d{8}$/.test(digits)) throw new Error("invalid_mobile");
  return `${digits}@c.us`;
};
function harness(options = {}) {
  const sends = [], records = [], inapp = [], submissions = new Map();
  const rows = options.reviewers ?? [reviewer("other", "0500000001"), reviewer("target", "+966508424401"), reviewer("duplicate", "0508424401"), reviewer("unauthorized", "0500000002", "none"), reviewer("inactive", "0500000003", "super", false)];
  const db = { from(table) {
    let key;
    const builder = {
      select() { return this; }, eq(column, value) { if (column === "idempotency_key") key = value; return this; }, maybeSingle() { return this; },
      async upsert(value) { inapp.push(value); return { error: options.inappError ? { message: "fake failure" } : null }; },
      then(resolve, reject) {
        let result;
        if (table === "admin_users") result = { data: rows, error: null };
        else if (table === "admin_roles") result = { data: { id: "super" }, error: options.roleError ? {} : null };
        else if (table === "admin_role_permissions") result = { data: [{ role_id: "reviewer" }], error: options.permissionsError ? {} : null };
        else if (table === "notification_provider_submissions") result = { data: submissions.get(key) ?? null, error: options.lookupError ? {} : null };
        else throw new Error(`Unexpected table ${table}`);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  } };
  const send = async (channel, value) => {
    sends.push({ channel, ...value });
    if (options.throwDestination === value.to) throw new Error("sensitive provider response");
    return { status: options.failedDestination === value.to ? "failed" : "submitted", providerMessageId: "mock-id", sanitizedError: null, submittedAt: "2026-09-30T00:00:00Z" };
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, process: { env: { NOTIFICATIONS_ENABLED: "true" } }, require(name) {
    if (name === "server-only") return {};
    if (name === "@/lib/supabase/admin") return { createAdminClient: () => db };
    if (name === "./providers/green-api") return { normalizeWhatsAppChatId: normalize, maskWhatsAppDestination: () => "masked", sendGreenApiMessage: value => send("whatsapp", value) };
    if (name === "./providers/resend") return { sendResendSensitiveCopy: value => send("email", value) };
    if (name === "./site-url") return { OFFICIAL_PLATFORM_URL: "https://invalid.example" };
    if (name === "./submissions") return { maskEmail: () => "masked", async recordProviderSubmission(value) { if (options.recordError) throw new Error("fake write failure"); records.push(value); submissions.set(value.idempotencyKey, value.result); } };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return { sends, records, inapp, notify: () => exports.notifyJoinReviewers({ kind: "provider", applicationId: "test-application", applicantEmail: "applicant@invalid.example", applicantName: "Test", submittedAt: "2026-09-30", details: [] }) };
}

const normal = harness();
await normal.notify();
assert.equal(normal.sends[0].channel, "whatsapp");
assert.equal(normalize(normal.sends[0].to), "966508424401@c.us", "designated reviewer is first");
assert.equal(normal.sends.filter(item => item.channel === "whatsapp" && normalize(item.to) === "966508424401@c.us").length, 1, "normalized duplicate recipient sent once");
assert.ok(!normal.sends.some(item => item.to.includes("unauthorized") || item.to.includes("inactive")), "unauthorized/inactive profiles excluded");
assert.equal(normal.inapp.length, 3, "all authorized active profiles retain in-app notice");
const sendCount = normal.sends.length;
await normal.notify();
assert.equal(normal.sends.length, sendCount, "already submitted external notifications not resent");

for (const options of [{ roleError: true }, { permissionsError: true }]) {
  const sample = harness(options);
  await assert.rejects(sample.notify(), /permissions_lookup_failed/);
  assert.equal(sample.sends.length, 0, "role lookup fails closed");
}
const broken = harness({ throwDestination: "0500000001", inappError: true });
await assert.rejects(broken.notify(), /notification_failures/);
assert.equal(normalize(broken.sends[0].to), "966508424401@c.us");
assert.ok(broken.sends.some(item => item.to === "applicant@invalid.example"), "recipient failure does not suppress applicant receipt");
assert.ok(broken.records.some(item => item.result.status === "failed" && item.result.sanitizedError === "provider_send_exception"), "thrown sends persisted as sanitized failures");
const retryCount = broken.sends.length;
await assert.rejects(broken.notify(), /notification_failures/);
assert.equal(broken.sends.length, retryCount + 1, "only failed external send retried");

const unavailable = harness({ reviewers: [reviewer("target", "0508424401", "none")] });
await assert.rejects(unavailable.notify(), /designated_reviewer_unavailable/);
assert.ok(!unavailable.sends.some(item => item.channel === "whatsapp"), "target mobile never bypasses authorization");
const lookup = harness({ lookupError: true });
await assert.rejects(lookup.notify(), /submission_tracking_failed/);
assert.equal(lookup.sends.length, 0, "failed idempotency lookup does not risk replay");
const recording = harness({ recordError: true });
await assert.rejects(recording.notify(), /submission_tracking_failed/);
assert.ok(recording.sends.some(item => item.to === "applicant@invalid.example"), "tracking failure does not suppress other recipients");
console.log("Join reviewer notification regression checks passed (mocked database and messaging only).");
