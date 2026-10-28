// Routing hints only. The database and server independently authorize every read.
export const ARCHIVE_ACTORS = new Set([
  "7f4152b6-63d2-49ec-866f-681a3308f670",
  "d5b7d59e-3a22-4d59-8096-d546c9bd8c4e",
]);
export const ARCHIVE_SCHEMA = "admin_archive";
export const ARCHIVE_BUCKET = "admin-archive";
const readRpcs = new Set(["admin_attention_counts", "admin_provider_financial_summary", "admin_has_permission", "admin_can_view_administrators", "admin_can_impersonate", "is_admin", "contractor_chat_summary", "contractor_directory_cards"]);

export function archiveSubject(authorization: string | null): string | null {
  try {
    const part = authorization?.replace(/^Bearer /i, "").split(".")[1];
    if (!part) return null;
    const data = JSON.parse(atob(part.replaceAll("-", "+").replaceAll("_", "/")));
    return ARCHIVE_ACTORS.has(data.sub) ? data.sub : null;
  } catch { return null; }
}

export function archiveDenied() {
  return Response.json({ message: "لا تملك صلاحية تنفيذ هذا الإجراء.", code: "42501" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
}

export function archiveReadAllowed(path: string, method: string) {
  if (!path.startsWith("/rest/v1/")) return false;
  const resource = path.slice("/rest/v1/".length);
  if (resource.startsWith("rpc/")) return ["GET", "HEAD", "POST"].includes(method) && readRpcs.has(resource.slice(4));
  return ["GET", "HEAD"].includes(method) && /^[a-z_][a-z_0-9]*$/.test(resource);
}

export function archiveReadUrl(input: URL, capturedAt?: string) {
  const url = new URL(input);
  if (capturedAt && url.pathname === "/rest/v1/notifications") {
    const filter = url.searchParams.get("or");
    if (filter?.includes("expires_at.gt.")) url.searchParams.set("or", filter.replace(/expires_at\.gt\.[^,)]+/g, `expires_at.gt.${capturedAt}`));
  }
  return url;
}

export async function archiveResponse(response: Response, baseUrl: string) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  const text = await response.text();
  const prefix = `${baseUrl}/storage/v1/object/public/`;
  const body = text.split(prefix).join("/api/admin/archive/files/");
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("Cache-Control", "private, no-store");
  return new Response(body, { status: response.status, headers });
}

/** A valid actor JWT is still sent upstream; schema routing cannot grant access. */
export function createArchiveFetch(baseUrl: string, transport: typeof fetch = fetch, siteOrigin: string | (() => Promise<string>) = ""): typeof fetch {
  const active = new Map<string, string | undefined>();
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    const headers = new Headers(init?.headers ?? request?.headers);
    const actor = archiveSubject(headers.get("authorization"));
    if (!actor || url.origin !== new URL(baseUrl).origin || !(url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/"))) return transport(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    // Account authentication stays live; business records stay frozen. RLS limits
    // these reads to self, and the completion RPC rejects delegated sessions.
    const ownIdentity = ["GET", "HEAD"].includes(method) && (
      url.pathname === "/rest/v1/profiles" && url.searchParams.get("id") === `eq.${actor}` && url.searchParams.get("select")?.split(",").includes("must_change_password")
      || url.pathname === "/rest/v1/user_roles" && url.searchParams.get("profile_id") === `eq.${actor}`
    );
    if (ownIdentity || method === "POST" && url.pathname === "/rest/v1/rpc/complete_temporary_password_change") {
      headers.set("Accept-Profile", "public");
      headers.set("Content-Profile", "public");
      return transport(input, { ...init, headers, cache: "no-store" });
    }
    if (!active.has(actor)) {
      const statusHeaders = new Headers(headers);
      statusHeaders.set("Content-Type", "application/json");
      statusHeaders.set("Content-Profile", "public");
      statusHeaders.set("Accept-Profile", "public");
      const response = await transport(`${baseUrl}/rest/v1/rpc/admin_archive_status`, { method: "POST", headers: statusHeaders, body: "{}", cache: "no-store" });
      // Before the versioned migration is installed, preserve the current behavior.
      if (response.status === 404) return transport(input, init);
      if (!response.ok) return archiveDenied();
      const status = await response.json();
      if (!status.active) return transport(input, init);
      if (!status.eligible) return archiveDenied();
      active.set(actor, status.captured_at);
    }
    if (url.pathname.startsWith("/storage/v1/")) {
      const proxyOrigin = typeof siteOrigin === "function" ? await siteOrigin() : siteOrigin;
      const signed = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)(?:\/(.+))?$/);
      const proxyHeaders = new Headers({ Authorization: headers.get("authorization")!, "Content-Type": "application/json" });
      if (signed && method === "POST") {
        const rawBody = init?.body;
        const text = rawBody == null ? request ? await request.clone().text() : "{}"
          : typeof rawBody === "string" ? rawBody : await new Response(rawBody).text();
        const body = JSON.parse(text);
        return transport(`${proxyOrigin}/api/admin/archive/storage`, { method: "POST", headers: proxyHeaders,
          body: JSON.stringify({ bucket: decodeURIComponent(signed[1]), path: signed[2] ? decodeURIComponent(signed[2]) : undefined, paths: body.paths, expiresIn: body.expiresIn }), cache: "no-store" });
      }
      const download = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
      if (download && ["GET", "HEAD"].includes(method)) return transport(`${proxyOrigin}/api/admin/archive/files/${download[1]}/${download[2]}`, { method, headers: proxyHeaders, cache: "no-store" });
      return archiveDenied();
    }
    if (!archiveReadAllowed(url.pathname, method)) return archiveDenied();
    headers.set("Accept-Profile", ARCHIVE_SCHEMA);
    headers.set("Content-Profile", ARCHIVE_SCHEMA);
    const frozenUrl = archiveReadUrl(url, active.get(actor));
    const target = frozenUrl.href === url.href ? input : request ? new Request(frozenUrl, request) : frozenUrl;
    return archiveResponse(await transport(target, { ...init, headers, cache: "no-store" }), baseUrl);
  };
}
