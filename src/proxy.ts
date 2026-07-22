import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

const protectedRoots = ["/admin", "/merchant", "/customer", "/contractor", "/driver"];

export async function proxy(request: NextRequest) {
  const { response, userId } = await refreshSupabaseSession(request);
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );

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
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
