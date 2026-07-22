import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedDestinations = new Set(["/customer", "/reset-password"]);

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  const next = requestedNext && allowedDestinations.has(requestedNext) ? requestedNext : null;

  if (!code || !next) {
    return NextResponse.redirect(new URL("/login?error=invalid_callback", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=invalid_callback", request.url));

  if (next === "/customer") {
    const { error: initializeError } = await supabase.rpc("initialize_customer_account");
    if (initializeError) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=role_not_ready", request.url));
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
