import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const defaultBaseUrl = "https://ksa.paymob.com";
const checkoutSessionPrefix = "paymob-session:";

type PaymobConfig = {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationIds: number[];
};

type PaymobIntentionResponse = {
  id?: string;
  client_secret?: string;
  intention_order_id?: number | string;
};

export type StoredPaymobSession = {
  intentionId: string;
  clientSecret: string;
  createdAt: number;
  returnUrl?: string;
};

export type PaymobTransaction = Record<string, unknown> & {
  id?: string | number;
  amount_cents?: number | string;
  currency?: string;
  success?: boolean;
  pending?: boolean;
  is_refunded?: boolean;
  is_voided?: boolean;
  integration_id?: number | string;
  order?: { id?: string | number; merchant_order_id?: string };
  payment_key_claims?: { extra?: Record<string, unknown> };
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getPaymobConfig(): PaymobConfig {
  const integrationIds = required("PAYMOB_INTEGRATION_IDS")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (!integrationIds.length) throw new Error("PAYMOB_INTEGRATION_IDS is invalid.");
  return {
    baseUrl: (process.env.PAYMOB_BASE_URL?.trim() || defaultBaseUrl).replace(/\/$/, ""),
    apiKey: required("PAYMOB_API_KEY"),
    secretKey: required("PAYMOB_SECRET_KEY"),
    publicKey: required("PAYMOB_PUBLIC_KEY"),
    hmacSecret: required("PAYMOB_HMAC_SECRET"),
    integrationIds,
  };
}

export function paymobCheckoutUrl(clientSecret: string) {
  const config = getPaymobConfig();
  const query = new URLSearchParams({ publicKey: config.publicKey, clientSecret });
  return `${config.baseUrl}/unifiedcheckout/?${query.toString()}`;
}

export async function createPaymobIntention(input: {
  amountCents: number;
  paymentRecordId: string;
  orderCode: string;
  quoteId: string;
  customer: { fullName: string; email: string; phone: string };
  notificationUrl: string;
  redirectionUrl: string;
}) {
  const config = getPaymobConfig();
  const names = input.customer.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = names[0] || "Bunya";
  const lastName = names.slice(1).join(" ") || "Customer";
  const response = await fetch(`${config.baseUrl}/v1/intention/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountCents,
      currency: "SAR",
      payment_methods: config.integrationIds,
      items: [
        {
          name: `Bunya order ${input.orderCode}`,
          amount: input.amountCents,
          description: `Quote ${input.quoteId}`,
          quantity: 1,
        },
      ],
      billing_data: {
        first_name: firstName,
        last_name: lastName,
        email: input.customer.email,
        phone_number: input.customer.phone,
      },
      extras: {
        payment_record_id: input.paymentRecordId,
        quote_id: input.quoteId,
        order_code: input.orderCode,
      },
      special_reference: input.paymentRecordId,
      notification_url: input.notificationUrl,
      redirection_url: input.redirectionUrl,
      expiration: 3600,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as PaymobIntentionResponse | null;
  if (!response.ok || !data?.id || !data.client_secret) {
    throw new Error(`Paymob intention failed with status ${response.status}.`);
  }
  return { intentionId: String(data.id), clientSecret: data.client_secret };
}

export function serializePaymobSession(session: StoredPaymobSession) {
  return `${checkoutSessionPrefix}${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

export function parsePaymobSession(value: unknown): StoredPaymobSession | null {
  const text = String(value ?? "");
  if (!text.startsWith(checkoutSessionPrefix)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(text.slice(checkoutSessionPrefix.length), "base64url").toString("utf8")) as StoredPaymobSession;
    if (!parsed.intentionId || !parsed.clientSecret || !Number.isFinite(parsed.createdAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function callbackValue(transaction: PaymobTransaction, path: string) {
  let value: unknown = transaction;
  for (const part of path.split(".")) {
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  }
  if (value === true) return "true";
  if (value === false) return "false";
  return value == null ? "" : String(value);
}

const hmacFields = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

export function verifyPaymobHmac(transaction: PaymobTransaction, provided: string | null) {
  if (!provided || !/^[a-f\d]{128}$/i.test(provided)) return false;
  const expected = createHmac("sha512", getPaymobConfig().hmacSecret)
    .update(hmacFields.map((field) => callbackValue(transaction, field)).join(""))
    .digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(provided, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function paymentRecordIdFromTransaction(transaction: PaymobTransaction) {
  const extra = transaction.payment_key_claims?.extra;
  const candidates = [
    extra?.payment_record_id,
    (transaction as { extras?: Record<string, unknown> }).extras?.payment_record_id,
    transaction.order?.merchant_order_id,
    (transaction as { merchant_order_id?: unknown }).merchant_order_id,
  ];
  const id = candidates.map((value) => String(value ?? "").trim()).find((value) => /^[0-9a-f-]{36}$/i.test(value));
  return id || null;
}
