import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-cookie";
import { validateImpersonation, assertMaintenanceOrigin } from "@/lib/auth/impersonation";
import { ARCHIVE_ACTORS, archiveSubject, archiveReadAllowed, archiveDenied } from "@/lib/supabase/archive-fetch";
import { archiveActorStatus } from "@/lib/supabase/archive-server";

const protectedRoots = ["/admin", "/merchant", "/customer", "/contractor", "/driver"];

export async function proxy(request: NextRequest) {
  const { response, userId, supabase } = await refreshSupabaseSession(request);
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );

  const maintenance = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  let effectiveUserId = archiveSubject(request.headers.get("authorization")) ?? userId;
  if (maintenance && (protectedRoute || pathname.startsWith("/api/")) && pathname !== "/api/maintenance") {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertMaintenanceOrigin(request);
      const ticket = await validateImpersonation(maintenance, supabase);
      effectiveUserId = ticket.targetId;
      // Admin actions authorize with the delegated account through createClient().
      // Starting a nested delegation or changing authentication still requires exit.
      if (pathname === "/api/admin/impersonation" || pathname.startsWith("/api/admin/impersonation/") || pathname.startsWith("/api/auth/")) {
        return NextResponse.json({ message: "ارجع لحساب الإدارة قبل استخدام هذا الإجراء." }, { status: 403 });
      }
    } catch {
      if (pathname.startsWith("/api/")) return NextResponse.json({ message: "انتهت جلسة الدخول بالنيابة. ارجع إلى حساب الإدارة." }, { status: 403 });
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  // Deny actions before handlers can send messages, create payments, or perform
  // other side effects. Database policies separately enforce direct API access.
  if (effectiveUserId && ARCHIVE_ACTORS.has(effectiveUserId) && !["GET", "HEAD", "OPTIONS"].includes(request.method)
    && pathname !== "/api/maintenance" && pathname !== "/api/admin/archive/storage" && !pathname.startsWith("/api/auth/")) {
    const forwardedRead = pathname.startsWith("/api/maintenance/supabase/")
      && (archiveReadAllowed(pathname.slice("/api/maintenance/supabase".length), request.method)
        || (request.method === "POST" && pathname.startsWith("/api/maintenance/supabase/storage/v1/object/sign/")));
    if (!forwardedRead) {
      try { if ((await archiveActorStatus(effectiveUserId)).active) return archiveDenied(); }
      catch { return archiveDenied(); }
    }
  }

  if (protectedRoute && !userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
