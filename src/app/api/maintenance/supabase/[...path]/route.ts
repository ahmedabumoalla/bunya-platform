import { NextResponse } from "next/server";
import { getImpersonation, assertMaintenanceOrigin } from "@/lib/auth/impersonation";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    // Only the Data API, Storage object API and read-only identity endpoint.
    // Never proxy auth tokens/admin endpoints, arbitrary hosts, or credential changes.
    if (path.some(part => part === "." || part === ".." || /[\\/?#%]/.test(part)) ||
      !(route.startsWith("rest/v1/") || route.startsWith("storage/v1/object/") ||
        (route === "auth/v1/user" && request.method === "GET"))) {
      return NextResponse.json({ message: "هذا الإجراء غير متاح أثناء الدخول بالنيابة." }, { status: 403 });
    }
    if (!["GET", "HEAD"].includes(request.method)) assertMaintenanceOrigin(request);
    const ticket = await getImpersonation();
    if (!ticket) return NextResponse.json({ message: "جلسة الصيانة غير موجودة." }, { status: 401 });
    const { url, key } = getSupabasePublicEnv();
    const headers = new Headers({ apikey: key, Authorization: `Bearer ${ticket.accessToken}` });
    for (const name of ["content-type", "prefer", "range", "range-unit", "accept", "x-upsert", "cache-control"]) {
      const value = request.headers.get(name); if (value) headers.set(name, value);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 30 * 1024 * 1024) return NextResponse.json({ message: "الملف أكبر من المسموح." }, { status: 413 });
    const result = await fetch(`${url}/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`, {
      method: request.method, headers, cache: "no-store", redirect: "error",
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    if (route.startsWith("storage/v1/object/") && !["GET", "HEAD"].includes(request.method)) {
      // Metadata only: private document contents and signed URLs never enter the audit log.
      const { error } = await createAdminClient().from("audit_logs").insert({
        actor_profile_id: ticket.targetId, entity_table: "storage_objects", entity_id: path[3] || "storage",
        action: `storage_${request.method.toLowerCase()}`, result: result.ok ? "success" : "failed",
      });
      if (error) throw error;
    }
    const responseHeaders = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-range", "range-unit", "preference-applied"]) {
      const value = result.headers.get(name); if (value) responseHeaders.set(name, value);
    }
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ message: "انتهت جلسة الصيانة أو تعذر التحقق منها. ارجع إلى الإدارة." }, { status: 403 });
  }
}
export { forward as GET, forward as HEAD, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
