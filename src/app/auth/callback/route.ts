import { NextResponse, type NextRequest } from "next/server";
import { quoteReturnToQuery } from "@/lib/auth/return-to";
import { createClient } from "@/lib/supabase/server";

const allowedDestinations = new Set(["/customer", "/reset-password"]);

function invalidCallback(request: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=invalid_callback", request.url));
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const requestedNext = requestUrl.searchParams.get("next");
  const requestedReturnTo = requestUrl.searchParams.get("returnTo");
  const next = requestedNext && allowedDestinations.has(requestedNext) ? requestedNext : null;

  if (!next) return invalidCallback(request);

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return invalidCallback(request);
  } else if (tokenHash && type === "recovery" && next === "/reset-password") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error) return invalidCallback(request);
  } else {
    return invalidCallback(request);
  }

  if (next === "/customer") {
    const user = await supabase.auth.getUser();
    if (!user.data.user?.phone || !user.data.user.phone_confirmed_at) {
      return NextResponse.redirect(new URL(`/verify-phone${quoteReturnToQuery(requestedReturnTo)}`, request.url));
    }
    const { error: initializeError } = await supabase.rpc("initialize_customer_account");
    if (initializeError) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=role_not_ready", request.url));
    }
  }

  if (next === "/customer" && requestedReturnTo) {
    return NextResponse.redirect(new URL(requestedReturnTo === "/?quote=review" ? requestedReturnTo : next, request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
