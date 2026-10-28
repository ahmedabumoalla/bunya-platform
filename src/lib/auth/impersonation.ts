import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient as createTokenClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { createOriginalClient } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createArchiveFetch } from "@/lib/supabase/archive-fetch";
import { archiveProxyOrigin } from "@/lib/supabase/archive-origin";
import { resolveAuthIdentity } from "./resolve-identity";
import { IMPERSONATION_COOKIE, openImpersonation, sessionId, type ImpersonationTicket } from "./impersonation-cookie";

export class ImpersonationError extends Error {
  constructor(message = "انتهت جلسة الدخول بالنيابة أو لم تعد مخوّلًا. ارجع إلى حساب الإدارة.") { super(message); }
}
export function impersonatedClient(ticket: ImpersonationTicket) {
  const { url, key } = getSupabasePublicEnv();
  const client = createTokenClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
    global: { headers: { Authorization: `Bearer ${ticket.accessToken}` }, fetch: createArchiveFetch(url, fetch, archiveProxyOrigin) },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = () => getUser(ticket.accessToken);
  return client;
}
export async function validateImpersonation(value: string, original: SupabaseClient) {
  const ticket = openImpersonation(value);
  if (!ticket || ticket.expiresAt <= Date.now()) throw new ImpersonationError();
  const { data: auth, error } = await original.auth.getUser();
  if (error || auth.user?.id !== ticket.actorId) throw new ImpersonationError();
  const { data: session } = await original.auth.getSession();
  if (!session.session || sessionId(session.session.access_token) !== ticket.actorSessionId) throw new ImpersonationError();
  const { data: valid, error: validationError } = await createAdminClient({ authControl: true }).rpc("validate_admin_impersonation", {
    p_id: ticket.id, p_actor: ticket.actorId, p_actor_session: ticket.actorSessionId,
  });
  if (validationError || valid !== true) throw new ImpersonationError();
  return ticket;
}
export const getImpersonation = cache(async () => {
  const value = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!value) return null;
  return validateImpersonation(value, await createOriginalClient());
});
export async function requireImpersonationOperator() {
  const client = await createOriginalClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ImpersonationError("يجب تسجيل الدخول أولًا.");
  const identity = await resolveAuthIdentity(client, data.user);
  if (identity.status !== "ready" || identity.profile?.mustChangePassword || !identity.activeRoles.includes("admin") || identity.details.admin?.roleKey !== "super_admin") {
    throw new ImpersonationError("لا تملك صلاحية الدخول بالنيابة.");
  }
  const capability = await client.rpc("admin_can_impersonate");
  if (capability.error || capability.data !== true) throw new ImpersonationError("لا تملك صلاحية الدخول بالنيابة.");
  const { data: session } = await client.auth.getSession();
  if (!session.session) throw new ImpersonationError();
  return { identity, client, session: session.session };
}
export function assertMaintenanceOrigin(request: Request) {
  const url = new URL(request.url), origin = request.headers.get("origin");
  let sameOrigin = origin === url.origin;
  // Next's local server normalizes request.url to localhost even when the browser
  // connects to 127.0.0.1. Accept only that loopback alias on the same dev port.
  if (!sameOrigin && origin && process.env.NODE_ENV === "development") {
    try {
      const source = new URL(origin), loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
      sameOrigin = loopback.has(url.hostname) && loopback.has(source.hostname)
        && source.protocol === url.protocol && source.port === url.port
        && request.headers.get("host") === source.host;
    } catch { /* Invalid origins remain denied. */ }
  }
  if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ImpersonationError("مصدر الطلب غير مسموح.");
  }
}
