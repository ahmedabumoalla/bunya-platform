import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const site = "https://www.buniahksa.com";
const id = "aabbccdd-1122-4333-8444-556677889900";
const sent = [], saved = [], pushes = [], finished = [];
let status = "submitted";
function load(file, imports = {}, extra = "") {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code + extra, { exports, URL, console, require(name) { if (name === "server-only") return {}; if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; } });
  return exports;
}
const compact = load("src/lib/notifications/compact.ts");
const labels = load("src/lib/admin/event-labels.ts");
const catalog = load("src/lib/notifications/event-catalog.ts", { "./compact": compact, "@/lib/admin/event-labels": labels });
assert.doesNotMatch(catalog.templates.onboarding("مورد", "legacy@example.com", "temporary-test", site), /legacy@example/);
assert.match(catalog.templates.onboarding("مورد", "+966500000001", "temporary-test", site), /24 ساعة/);
const providers = { maskWhatsAppDestination: () => "masked", sendGreenApiMessage: async value => { sent.push(value); return { status }; } };
const imports = {
  "@/lib/supabase/admin": {}, "./providers/green-api": providers,
  "./providers/resend": { sendResendSensitiveCopy: async value => { sent.push(value); return { status }; } },
  "./submissions": { maskEmail: () => "masked", recordProviderSubmission: async () => {} },
  "./native-push": { sendNativePush: async (...value) => { pushes.push(value); } },
  "./site-url": { OFFICIAL_PLATFORM_URL: site }, "./event-catalog": catalog, "./compact": compact,
};
const dispatcher = load("src/lib/notifications/dispatcher.ts", imports,
  "\nexports.run=dispatchClaimedEvents; exports.setRecipients=value=>{resolveEvent=async()=>value;}; exports.action=notificationActionUrl;");
const db = {
  from(table) { return { async upsert(value) { saved.push({ table, value }); return { error: null }; } }; },
  async rpc(name, args) { finished.push({ name, args }); return { error: null }; },
};
for (const eventType of ["provider.rfq_new", "customer.quote_ready", "order_created", "delivery_confirmed", "customer.delivery_assigned", "provider.fulfillment_assigned", "contractor.proposal_needs_changes", "contractor.opportunity_new", "contractor.service_rejected", "ticket.created", "settlement.requested", "admin.outbox_dead_letter"]) {
  const path = `/customer/orders/${id}`;
  dispatcher.setRecipients([{ profileId: "recipient", customerProfileId: "recipient", mobile: "+966500000001", email: "recipient@example.com", emailSubject: "old subject", actionUrl: path, text: `Full scope and secret contact user@example.com +966512345678\n${"details ".repeat(500)}\n${site}${path}` }]);
  const event = { id: "outbox-canonical", aggregate_id: id, event_type: eventType, payload: { reason: "private notes", mobile: "+966512345678" } };
  const result = await dispatcher.run(db, [event]);
  assert.equal(result.processed, 1);
  const message = saved.at(-1).value.message;
  assert.ok(message.length < 220, eventType);
  assert.ok(message.includes(compact.shortReference(id)), eventType);
  assert.ok(message.endsWith(`${site}${path}`));
  assert.doesNotMatch(message, /user@example|966512345678|Full scope|details|private notes/);
  assert.equal(saved.at(-1).value.action_url, path);
  assert.equal(sent.at(-1).text, message);
  assert.match(sent.at(-1).idempotencyKey, /outbox-canonical-recipient-email$/);
  assert.equal(pushes.at(-1)[1].url, path);
  assert.ok(pushes.at(-1)[1].body.length <= 120);
  assert.doesNotMatch(pushes.at(-1)[1].body,/https?:|[a-f0-9]{8}-[a-f0-9-]{27}/i,'push text excludes long URLs and canonical UUIDs');
}
assert.match(catalog.compactEventMessage("customer.driver_arrived", id, "/customer/deliveries", site), /لا تسلّم رمز التأكيد قبل الاستلام/);
assert.equal(dispatcher.action({ text: `ignored\n${site}/merchant/orders/${id}` }, { event_type: "provider.fulfillment_assigned", aggregate_id: id }), `/merchant/orders/${id}`);
assert.equal(dispatcher.action({ actionUrl: "https://attacker.example/", text: "" }, { event_type: "provider.rfq_responded", aggregate_id: id }), "/admin/sourcing");
assert.equal(dispatcher.action({ actionUrl: "/\\attacker.example", text: "" }, { event_type: "provider.rfq_responded", aggregate_id: id }), "/admin/sourcing");
status = "failed";
assert.equal((await dispatcher.run(db, [{ id: "retry", aggregate_id: id, event_type: "order_created", payload: {} }])).failed, 1);
assert.equal(finished.at(-1).args.p_success, false);

status = "submitted";
const productDb = {
  async rpc(name, args) { if (name === "claim_notification_outbox") return { data: [{ id: "product-event", aggregate_id: id }] }; finished.push({ name, args }); return {}; },
  from(table) {
    assert.ok(["admin_users", "products"].includes(table), "No image or detailed catalog data requested");
    const q = { select(fields) { if (table === "products") assert.equal(fields, "name,providers(company_name)"); return q; }, eq() { return q; }, maybeSingle() { return q; }, then(resolve) { return Promise.resolve({ data: table === "products" ? { name: "أسمنت", providers: { company_name: "المورد" }, description: "private details" } : [{ profile_id: "admin", profiles: { mobile: "+966500000003" } }] }).then(resolve); } }; return q;
  },
};
const product = load("src/lib/notifications/product-review-dispatcher.ts", { ...imports, "@/lib/supabase/admin": { createAdminClient: () => productDb } });
const previous = sent.length;
assert.equal((await product.dispatchProductReviewNotifications()).processed, 1);
assert.equal(sent.length, previous + 1, "one concise message per reviewer");
assert.match(sent.at(-1).text, /أسمنت/);
assert.match(sent.at(-1).text, /المورد/);
assert.doesNotMatch(sent.at(-1).text, /private details/);
assert.ok(sent.at(-1).text.length < 220);
assert.equal(sent.at(-1).idempotencyKey, "product-review-product-event-admin-text");
console.log("PASS compact event delivery across commerce, contractor, support and administration; recipient links/canonical keys preserved; no contact/detail leakage; failures retry; single concise product notice. No messages sent.");
