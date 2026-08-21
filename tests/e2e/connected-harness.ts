import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export const E2E_RUN_ID = "bunya-e2e-20260813-034000-e19f73";
export const ROLE_ROOTS = {
  admin: "/admin",
  customer: "/customer",
  provider: "/merchant",
  contractor: "/contractor",
  driver: "/driver",
} as const;

export type E2ERole = keyof typeof ROLE_ROOTS;
export type E2EUser = {
  id: string;
  role: E2ERole;
  email: string;
  phone: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
  session?: Record<string, unknown>;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  service?: boolean;
  headers?: Record<string, string>;
  allow?: number[];
};

const url = required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = process.env.SUPABASE_SECRET_KEY || required("SUPABASE_SERVICE_ROLE_KEY");

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for connected E2E`);
  return value;
}

function strongPassword() {
  return `A${randomBytes(18).toString("base64url")}a7!`;
}

let phoneSequence = randomInt(10_000_000, 89_999_999);

export class ConnectedHarness {
  readonly users: E2EUser[] = [];
  readonly ids = new Map<string, Set<string>>();
  readonly storageObjects: { bucket: string; path: string }[] = [];

  projectRef() {
    return new URL(url).hostname.split(".")[0];
  }

  track(table: string, id: string | null | undefined) {
    if (!id) return;
    const values = this.ids.get(table) || new Set<string>();
    values.add(id);
    this.ids.set(table, values);
  }

  async request(path: string, options: RequestOptions = {}) {
    const bearer = options.service ? serviceKey : options.token || publicKey;
    const response = await fetch(`${url}${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: options.service ? serviceKey : publicKey,
        authorization: `Bearer ${bearer}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    const allowed = options.allow || [];
    if (!response.ok && !allowed.includes(response.status)) {
      const code = payload && typeof payload === "object" && "code" in payload ? String(payload.code) : "request_failed";
      const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message).replace(/[\r\n\t]+/g, " ").slice(0, 240) : "";
      throw new Error(`${options.method || "GET"} ${path} failed (${response.status}, ${code}${message ? `: ${message}` : ""})`);
    }
    return { status: response.status, ok: response.ok, data: payload, headers: response.headers };
  }

  async serviceRows(table: string, query = "select=*") {
    const result = await this.request(`/rest/v1/${table}?${query}`, { service: true });
    return (result.data || []) as Record<string, unknown>[];
  }

  async userRows(user: E2EUser, table: string, query = "select=*") {
    const result = await this.request(`/rest/v1/${table}?${query}`, { token: requiredToken(user) });
    return (result.data || []) as Record<string, unknown>[];
  }

  async insert(table: string, body: unknown, options: { token?: string; service?: boolean } = { service: true }) {
    const result = await this.request(`/rest/v1/${table}`, {
      method: "POST",
      body,
      token: options.token,
      service: options.service,
      headers: { Prefer: "return=representation" },
    });
    return (result.data || []) as Record<string, unknown>[];
  }

  async update(table: string, query: string, body: unknown, options: { token?: string; service?: boolean } = { service: true }) {
    const result = await this.request(`/rest/v1/${table}?${query}`, {
      method: "PATCH",
      body,
      token: options.token,
      service: options.service,
      headers: { Prefer: "return=representation" },
    });
    return (result.data || []) as Record<string, unknown>[];
  }

  async rpc(name: string, body: unknown, options: { token?: string; service?: boolean; allow?: number[] } = {}) {
    return this.request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body,
      token: options.token,
      service: options.service,
      allow: options.allow,
      headers: { Prefer: "return=representation" },
    });
  }

  async createE2EUser(role: E2ERole, label: string = role) {
    phoneSequence += 1;
    const compact = E2E_RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const email = `e2e.${label}.${compact}.${randomBytes(4).toString("hex")}@invalid.example`;
    const phone = `+9665${String(phoneSequence).padStart(8, "0").slice(-8)}`;
    const password = strongPassword();
    const created = await this.request("/auth/v1/admin/users", {
      method: "POST",
      service: true,
      body: {
        email,
        phone,
        password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: `${E2E_RUN_ID}-${label}`, mobile: phone, e2e_run_id: E2E_RUN_ID },
      },
    });
    const id = String((created.data as { id?: string } | null)?.id || "");
    if (!id) throw new Error(`Auth Admin did not return an id for ${role}`);
    const user = { id, role, email, phone, password } satisfies E2EUser;
    this.users.push(user);
    this.track("profiles", id);
    return user;
  }

  async updateAuthPassword(user: E2EUser, password = strongPassword()) {
    await this.request(`/auth/v1/admin/users/${user.id}`, { method: "PUT", service: true, body: { password } });
    user.password = password;
  }

  async signIn(user: E2EUser) {
    const result = await this.request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: user.email, password: user.password },
    });
    const data = result.data as { access_token?: string; refresh_token?: string } | null;
    if (!data?.access_token || !data.refresh_token) throw new Error(`Sign in failed for ${user.role}`);
    user.accessToken = data.access_token;
    user.refreshToken = data.refresh_token;
    user.session = { ...data };
    return user;
  }

  async refresh(user: E2EUser) {
    const result = await this.request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: user.refreshToken },
    });
    const data = result.data as { access_token?: string; refresh_token?: string } | null;
    if (!data?.access_token || !data.refresh_token) throw new Error(`Refresh failed for ${user.role}`);
    user.accessToken = data.access_token;
    user.refreshToken = data.refresh_token;
    user.session = { ...data };
  }

  async setRole(user: E2EUser, role: E2ERole, grantedBy?: string) {
    await this.update("profiles", `id=eq.${user.id}`, { role, must_change_password: false });
    const rows = await this.insert("user_roles", {
      profile_id: user.id,
      role,
      is_primary: true,
      granted_by: grantedBy || null,
    });
    this.track("user_roles", String(rows[0]?.id || ""));
  }

  async uploadStorage(user: E2EUser, bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: publicKey,
        authorization: `Bearer ${requiredToken(user)}`,
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: Buffer.from(bytes),
    });
    if (!response.ok) throw new Error(`Storage upload failed (${response.status})`);
    this.storageObjects.push({ bucket, path });
  }

  async createSignedUrl(user: E2EUser, bucket: string, path: string) {
    const response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: publicKey,
        authorization: `Bearer ${requiredToken(user)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    const body = await response.json() as { signedURL?: string; signedUrl?: string };
    if (!response.ok) throw new Error(`Storage signing failed (${response.status})`);
    return body.signedURL || body.signedUrl || "";
  }

  async deleteExact(table: string, column: string, values: string[]) {
    if (!values.length) return;
    const encoded = values.length === 1 ? `eq.${values[0]}` : `in.(${values.join(",")})`;
    await this.request(`/rest/v1/${table}?${column}=${encodeURIComponent(encoded)}`, {
      method: "DELETE",
      service: true,
      headers: { Prefer: "return=minimal" },
      allow: [404],
    });
  }

  async cleanupE2EFixtures() {
    const failures: string[] = [];
    try {
      await this.rpc("cleanup_e2e_immutable_records", { p_run_id: E2E_RUN_ID }, { service: true });
    } catch {
      failures.push("rpc:cleanup_e2e_immutable_records");
    }
    for (const object of [...this.storageObjects].reverse()) {
      try {
        const response = await fetch(`${url}/storage/v1/object/${object.bucket}/${object.path}`, {
          method: "DELETE",
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        });
        if (!response.ok && response.status !== 404) failures.push(`storage:${object.bucket}/${object.path}:${response.status}`);
      } catch {
        failures.push(`storage:${object.bucket}/${object.path}:network`);
      }
    }
    this.storageObjects.length = 0;
    const order = [
      "notification_provider_submissions", "notification_deliveries", "notifications", "outbox_events",
      "support_attachments_v2", "support_messages", "support_tickets", "contractor_settlement_requests",
      "contractor_financial_transactions", "contractor_bank_accounts", "contractor_project_milestones",
      "contractor_projects", "contractor_proposal_stages", "contractor_proposals", "contractor_opportunity_matches",
      "contractor_opportunities", "project_request_specialties", "contractor_workflow_idempotency", "project_requests", "contractor_portfolio_media",
      "contractor_portfolio_items", "contractor_service_regions", "contractor_services", "delivery_confirmation_attempts",
      "delivery_confirmation_records", "delivery_confirmation_codes", "provider_delivery_updates", "provider_delivery_assignments",
      "fulfillment_status_history", "internal_fulfillment_order_items", "internal_fulfillment_orders", "trusted_payment_events",
      "payment_records", "invoice_items", "invoices", "order_status_history", "order_items", "orders",
      "bunya_customer_quote_items", "bunya_customer_quotes", "selected_provider_items", "provider_delivery_confirmations",
      "internal_selection_results", "provider_availability_confirmations", "provider_pricing_responses", "internal_sourcing_request_targets",
      "internal_sourcing_request_items", "internal_sourcing_requests", "quote_request_items", "quote_requests",
      "provider_product_prices", "products", "product_categories", "subscriptions", "subscription_plans", "contractor_availability", "contractor_profile_regions",
      "contractor_profile_specialties", "provider_driver_accounts", "provider_drivers", "provider_settings",
      "provider_profiles", "provider_members", "contractor_profiles", "providers", "admin_users", "user_roles", "idempotency_keys",
      "customer_profiles", "contractor_applications", "provider_applications",
    ];
    const primaryColumns: Record<string, string> = {
      trusted_payment_events: "event_id",
      delivery_confirmation_codes: "assignment_id",
      provider_driver_accounts: "driver_id",
      contractor_workflow_idempotency: "profile_id",
      idempotency_keys: "profile_id",
    };
    for (const table of order) {
      try {
        await this.deleteExact(table, primaryColumns[table] || "id", [...(this.ids.get(table) || [])]);
      } catch {
        failures.push(`table:${table}`);
      }
    }
    for (const user of [...this.users].reverse()) {
      try {
        await this.request(`/auth/v1/admin/users/${user.id}`, { method: "DELETE", service: true, allow: [404] });
      } catch {
        failures.push(`auth_user:${user.id}`);
      }
    }
    this.users.length = 0;
    return failures;
  }
}

export async function loginAs(page: Page, user: E2EUser) {
  if (!user.session) throw new Error(`${user.role} has no authenticated session`);
  const key = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(user.session), "utf8").toString("base64url")}`;
  const values = encoded.match(/.{1,3180}/g) || [];
  await page.context().addCookies(values.map((value, index) => ({
    name: values.length === 1 ? key : `${key}.${index}`,
    value,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  })));
  await page.goto(ROLE_ROOTS[user.role], { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForURL((next) => next.pathname.startsWith(ROLE_ROOTS[user.role]), { timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  if (!new URL(page.url()).pathname.startsWith(ROLE_ROOTS[user.role])) throw new Error(`Session refresh failed for ${user.role}`);
}

export function signHook(raw: string, webhookId: string, timestamp: string) {
  const secret = Buffer.from(required("E2E_HOOK_SECRET"), "base64");
  return `v1,${createHmac("sha256", secret).update(`${webhookId}.${timestamp}.${raw}`).digest("base64")}`;
}

export function startProviderMock() {
  const calls = {
    green: 0,
    resend: 0,
    bodiesWithSensitiveCode: 0,
    byKey: new Map<string, number>(),
    deliveryCodes: [] as string[],
    revisionTokens: [] as string[],
    mode: null as null | 400 | 429 | 500,
  };
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const key = String(request.headers["x-idempotency-key"] || request.headers["idempotency-key"] || "");
    calls.byKey.set(key, (calls.byKey.get(key) || 0) + 1);
    const deliveryCode = body.match(/\b(\d{6})\b/)?.[1];
    if (deliveryCode) {
      calls.bodiesWithSensitiveCode += 1;
      if (key.startsWith("delivery-code:" ) || key.startsWith("delivery-code-reissue:")) calls.deliveryCodes.push(deliveryCode);
    }
    const revisionToken = body.match(/\/join\/revise\/([A-Za-z0-9_-]+)/)?.[1];
    if (revisionToken) calls.revisionTokens.push(revisionToken);
    if (request.url?.startsWith("/resend/")) {
      calls.resend += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `mock-email-${calls.resend}` }));
      return;
    }
    calls.green += 1;
    if (key.includes("force-network")) {
      request.socket.destroy();
      return;
    }
    const status = calls.mode ?? (key.includes("force-400") ? 400 : key.includes("force-429") ? 429 : key.includes("force-500") ? 500 : 200);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(status === 200 ? JSON.stringify({ idMessage: `mock-wa-${calls.green}` }) : JSON.stringify({ error: "mock" }));
  });
  return new Promise<{ server: Server; calls: typeof calls }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3199, "127.0.0.1", () => resolve({ server, calls }));
  });
}

function requiredToken(user: E2EUser) {
  if (!user.accessToken) throw new Error(`${user.role} has no access token`);
  return user.accessToken;
}

function safeJson(text: string) {
  try { return JSON.parse(text) as unknown; } catch { return { non_json: true }; }
}
