import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAuthRequestClient } from "@/lib/auth/request-client";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptDeliveryCode, decryptDeliveryCode } from "@/lib/delivery/code-vault";
import { canonicalPlatformQuoteItem } from "./managed-catalog";
import type { PendingStorefrontQuote } from "./pending-draft";
import type { ManagedQuote, ManagedQuoteItem } from "./managed-types";

export class ManagedQuoteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const managedQuoteId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function managedQuoteContext(request: NextRequest) {
  const auth = await createAuthRequestClient(request);
  if (auth.error || !auth.user) throw new ManagedQuoteError(401, "سجّل دخولك أولًا.");
  if (request.method !== "GET" && !auth.usesBearer) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) throw new ManagedQuoteError(403, "مصدر الطلب غير صالح.");
  }
  const identity = await resolveAuthIdentity(auth.supabase, auth.user);
  if (identity.status !== "ready" || identity.profile?.mustChangePassword) throw new ManagedQuoteError(403, "الحساب غير مؤهل لهذه العملية.");
  const permission = identity.activeRoles.includes("admin")
    ? await auth.supabase.rpc("admin_has_permission", { requested_permission: "sourcing.manage" }) : null;
  const canManage = permission?.data === true && !permission.error;
  const isCustomer = identity.activeRoles.includes("customer");
  if (!canManage && !isCustomer) throw new ManagedQuoteError(403, "لا تملك صلاحية عروض الأسعار.");
  return { userId: auth.user.id, canManage, isCustomer, db: auth.supabase, admin: createAdminClient() };
}
export type ManagedQuoteContext = Awaited<ReturnType<typeof managedQuoteContext>>;

export async function readManagedQuote(context: ManagedQuoteContext, id: string) {
  if (!managedQuoteId.test(id)) throw new ManagedQuoteError(404, "الطلب غير موجود.");
  const result = await context.admin.from("managed_quote_requests").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل عرض السعر. حاول مجددًا.");
  if (!result.data || (!context.canManage && result.data.customer_id !== context.userId)) throw new ManagedQuoteError(404, "الطلب غير موجود.");
  return result.data as ManagedQuote;
}

export function visibleManagedQuote(row: ManagedQuote, canManage: boolean): ManagedQuote {
  const safe = { ...row } as ManagedQuote & { idempotency_key?: string; request_fingerprint?: string };
  delete safe.idempotency_key;
  delete safe.request_fingerprint;
  if (canManage || row.status !== "submitted") return safe;
  return { ...safe, pricing: [], subtotal: 0, vat_rate: 0, vat_amount: 0, delivery_fee: 0, total: 0, terms: "", valid_until: null, expected_delivery_at: null };
}

export async function submitManagedQuote(context: ManagedQuoteContext, draft: PendingStorefrontQuote) {
  if (!context.isCustomer) throw new ManagedQuoteError(403, "إرسال الطلب متاح لحساب العميل فقط.");
  const items: ManagedQuoteItem[] = [];
  for (const [index, item] of draft.items.entries()) {
    if (item.productId.startsWith("brkz-")) {
      items.push(canonicalPlatformQuoteItem(item, index));
    } else {
      const canonical = await context.admin.rpc("canonicalize_rfq_catalog_item", { p_item: {
        product_id: item.productId, quantity: item.quantity, unit: item.unit, unit_id: item.unitId || "",
        measurement_id: item.measurementId, measurement: item.measurementLabel === "بدون قياس إضافي" ? "" : item.measurementLabel,
        variant_ids: item.selectedVariants.map(variant => variant.id),
      } });
      if (canonical.error || !canonical.data) throw new ManagedQuoteError(400, "أعد اختيار وحدات ومواصفات المنتج من الكتالوج.");
      const row = canonical.data;
      const attributes: { label: string; value: string }[] = [];
      if (row.measurement) attributes.push({ label: "القياس", value: row.measurement });
      for (const selection of row.variant_selections ?? []) {
        for (const [label, value] of Object.entries(selection.attributes ?? {})) attributes.push({ label, value: String(value) });
      }
      for (const specification of row.product_specifications_snapshot ?? []) attributes.push({ label: "المواصفات", value: String(specification) });
      items.push({ id: `line-${index + 1}`, product_id: row.product_id, product_name: row.product_name, category: "مواد البناء",
        quantity: row.quantity, unit: row.unit, sku: "", attributes, image_url: "", notes: item.notes ?? "" });
    }
  }
  const result = await context.admin.rpc("managed_quote_submit", { p_actor: context.userId, p_details: draft.details, p_items: items, p_idempotency_key: draft.idempotencyKey });
  if (result.error || !result.data) throw new ManagedQuoteError(400, "تعذر إرسال الطلب. تأكد من توثيق الحساب وبيانات الاستلام أو أعد المحاولة.");
  return String(result.data);
}

export async function issueManagedDeliveryCode(context: ManagedQuoteContext, id: string, reissue = false) {
  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(24).toString("hex");
  const result = await context.admin.rpc("managed_quote_issue_code", {
    p_actor: context.userId, p_request_id: id, p_salt: salt,
    p_hash: createHash("sha256").update(`${salt}:${code}`).digest("hex"),
    p_ciphertext: encryptDeliveryCode(code), p_reissue: reissue,
  });
  if (result.error) throw new ManagedQuoteError(409, "تعذر إصدار رمز التسليم لهذا الطلب.");
}

export async function customerManagedDeliveryCode(context: ManagedQuoteContext, id: string) {
  const row = await readManagedQuote(context, id);
  if (!context.isCustomer || context.canManage || row.customer_id !== context.userId) throw new ManagedQuoteError(403, "رمز التسليم متاح للعميل صاحب الطلب فقط.");
  if (row.status !== "accepted") throw new ManagedQuoteError(409, "يظهر رمز التسليم بعد قبول العرض وقبل إغلاقه.");
  await issueManagedDeliveryCode(context, id);
  const result = await context.admin.from("managed_quote_delivery_codes").select("customer_code_ciphertext,expires_at,verified_at,locked_until,attempts,max_attempts").eq("request_id", id).maybeSingle();
  if (result.error || !result.data) throw new ManagedQuoteError(503, "رمز التسليم غير متاح حاليًا.");
  if (result.data.verified_at || Date.parse(result.data.expires_at) <= Date.now()) throw new ManagedQuoteError(410, "الرمز مستخدم أو منتهي. تواصل مع الإدارة لإعادة إصداره.");
  if (result.data.attempts >= result.data.max_attempts || (result.data.locked_until && Date.parse(result.data.locked_until) > Date.now())) throw new ManagedQuoteError(409, "الرمز مقفل. تواصل مع الإدارة لإعادة إصداره.");
  return { code: decryptDeliveryCode(result.data.customer_code_ciphertext), expiresAt: result.data.expires_at };
}
