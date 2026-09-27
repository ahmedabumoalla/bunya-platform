import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-cookie";
import { validateImpersonation, assertMaintenanceOrigin } from "@/lib/auth/impersonation";

const protectedRoots = ["/admin", "/merchant", "/customer", "/contractor", "/driver"];

export async function proxy(request: NextRequest) {
  const { response, userId, supabase } = await refreshSupabaseSession(request);
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );

  const maintenance = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  if (maintenance && (protectedRoute || pathname.startsWith("/api/")) && pathname !== "/api/maintenance") {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertMaintenanceOrigin(request);
      await validateImpersonation(maintenance, supabase);
      if (pathname.startsWith("/api/admin/") || pathname.startsWith("/api/auth/")) {
        return NextResponse.json({ message: "ارجع لحساب الإدارة قبل استخدام هذا الإجراء." }, { status: 403 });
      }
    } catch {
      if (pathname.startsWith("/api/")) return NextResponse.json({ message: "انتهت جلسة الدخول بالنيابة. ارجع إلى حساب الإدارة." }, { status: 403 });
      return NextResponse.redirect(new URL("/maintenance", request.url));
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
