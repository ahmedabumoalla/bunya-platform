import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createOriginalClient } from "./session";
import { getSupabasePublicEnv } from "./env";
import { ARCHIVE_ACTORS, ARCHIVE_BUCKET, ARCHIVE_SCHEMA, archiveDenied, archiveReadAllowed, archiveReadUrl, archiveResponse, archiveSubject } from "./archive-fetch";
import { IMPERSONATION_COOKIE, openImpersonation, sessionId } from "@/lib/auth/impersonation-cookie";

function rawService() {
  const { url } = getSupabasePublicEnv();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Server credentials unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function archiveActorStatus(actor: string) {
  if (!ARCHIVE_ACTORS.has(actor)) return { active: false, eligible: false };
  const result = await rawService().rpc("admin_archive_actor_status", { p_actor: actor });
  if (result.error?.code === "PGRST202") return { active: false, eligible: false };
  if (result.error) throw new Error("Unable to verify archive access");
  return result.data as { active: boolean; eligible: boolean; captured_at?: string; requires_password_change?: boolean };
}

// Each service client memoizes this per request, never globally across sessions.
async function currentArchiveActor() {
  let store: Awaited<ReturnType<typeof cookies>>;
  let incoming: Awaited<ReturnType<typeof requestHeaders>>;
  try { store = await cookies(); incoming = await requestHeaders(); } catch { return null; }
  const original = await createOriginalClient();
  const bearer = incoming.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const sealed = store.get(IMPERSONATION_COOKIE)?.value;
  const ticket = sealed ? openImpersonation(sealed) : null;
  const cookieSession = await original.auth.getSession();
  const cookieActor = archiveSubject(`Bearer ${cookieSession.data.session?.access_token ?? ""}`);
  if (sealed && !ticket) throw new Error("Invalid maintenance session");
  if (ticket && !ARCHIVE_ACTORS.has(ticket.targetId)) {
    if (cookieActor) throw new Error("Conflicting authenticated identities");
    return null;
  }
  if (!sealed && !cookieActor && !archiveSubject(bearer ? `Bearer ${bearer}` : null)) return null;
  const auth = bearer && !sealed ? await rawService().auth.getUser(bearer) : await original.auth.getUser();
  if (auth.error || !auth.data.user) throw new Error("Unable to authenticate archive request");
  // Some handlers authenticate cookies, others accept a bearer. A supplied
  // unrelated bearer must never turn a restricted cookie request into a live read.
  if (bearer && !sealed && cookieSession.data.session) {
    const cookieAuth = await original.auth.getUser();
    if (cookieAuth.error || cookieAuth.data.user?.id !== auth.data.user.id) throw new Error("Conflicting authenticated identities");
  }
  let actor = auth.data.user.id;
  if (sealed) {
    if (!ticket || ticket.actorId !== actor || ticket.expiresAt <= Date.now()) throw new Error("Invalid maintenance session");
    const session = await original.auth.getSession();
    if (!session.data.session || sessionId(session.data.session.access_token) !== ticket.actorSessionId) throw new Error("Invalid maintenance owner");
    const valid = await rawService().rpc("validate_admin_impersonation", { p_id: ticket.id, p_actor: actor, p_actor_session: ticket.actorSessionId });
    if (valid.error || valid.data !== true) throw new Error("Invalid maintenance authorization");
    actor = ticket.targetId;
  }
  const status = await archiveActorStatus(actor);
  if (!status.active) return null;
  if (!status.eligible) throw new Error("Archive access revoked");
  if (status.requires_password_change && !sealed) throw new Error("Password change required");
  return { actor, capturedAt: status.captured_at };
}

export function createArchiveServiceFetch(baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  let actorPromise: ReturnType<typeof currentArchiveActor> | undefined;
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    if (url.origin !== new URL(baseUrl).origin) return transport(input, init);
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.delete("x-bunya-archive-actor");
    const context = await (actorPromise ??= currentArchiveActor());
    if (!context) return transport(input, { ...init, headers });
    const { actor } = context;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (url.pathname.startsWith("/rest/v1/")) {
      if (!archiveReadAllowed(url.pathname, method)) return archiveDenied();
      headers.set("Accept-Profile", ARCHIVE_SCHEMA);
      headers.set("Content-Profile", ARCHIVE_SCHEMA);
      // Service-only wrappers must know the verified actor, never a browser header.
      headers.set("x-bunya-archive-actor", actor);
      const frozenUrl = archiveReadUrl(url, context.capturedAt);
      const target = frozenUrl.href === url.href ? input : request ? new Request(frozenUrl, request) : frozenUrl;
      return archiveResponse(await transport(target, { ...init, headers, cache: "no-store" }), baseUrl);
    }
    const authUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([a-f0-9-]{36})$/i);
    if (authUser && method === "GET") {
      const result = await rawService().schema(ARCHIVE_SCHEMA).from("safe_auth_users").select("*").eq("id", authUser[1]).maybeSingle();
      if (result.error || !result.data) return Response.json({ message: "User not found" }, { status: 404 });
      return Response.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
    }
    const storage = url.pathname.match(/^\/storage\/v1\/object\/(?:(sign|authenticated|public)\/)?([^/]+)\/(.+)$/);
    if (storage && (["GET", "HEAD"].includes(method) || (storage[1] === "sign" && method === "POST"))) {
      const bucket = decodeURIComponent(storage[2]), path = decodeURIComponent(storage[3]);
      const entry = await rawService().schema(ARCHIVE_SCHEMA).from("archive_storage_objects").select("id").eq("bucket_id", bucket).eq("name", path).maybeSingle();
      if (entry.error || !entry.data) return Response.json({ message: "File not found" }, { status: 404 });
      url.pathname = `/storage/v1/object/${storage[1] ? storage[1] + "/" : ""}${ARCHIVE_BUCKET}/${storage[2]}/${storage[3]}`;
      return transport(url, { ...init, headers, cache: "no-store" });
    }
    return archiveDenied();
  };
}

export async function downloadArchiveAsset(actor: string, bucket: string, path: string) {
  const status = await archiveActorStatus(actor);
  if (!status.active || !status.eligible) return null;
  // Existence in the immutable manifest is checked after caller-specific RLS in the route.
  return rawService().storage.from(ARCHIVE_BUCKET).download(`${bucket}/${path}`);
}

export async function signArchiveAsset(actor: string, bucket: string, path: string, expiresIn: number) {
  const status = await archiveActorStatus(actor);
  if (!status.active || !status.eligible) return null;
  return rawService().storage.from(ARCHIVE_BUCKET).createSignedUrl(`${bucket}/${path}`, expiresIn);
}
