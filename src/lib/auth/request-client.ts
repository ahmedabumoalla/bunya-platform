import "server-only";

import { createClient as createTokenClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export function isLocalAppOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

export function authRouteCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || (origin !== request.nextUrl.origin && !isLocalAppOrigin(request))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    Vary: "Origin",
  };
}

export function authRouteResponse(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, { status, headers: authRouteCorsHeaders(request) });
}

export function authRouteOptions(request: NextRequest) {
  const headers = authRouteCorsHeaders(request);
  return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
}

export async function createAuthRequestClient(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const supabase = token
    ? (() => {
        const { url, key } = getSupabasePublicEnv();
        return createTokenClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
      })()
    : await createClient();
  const result = await supabase.auth.getUser(token || undefined);
  return { supabase, user: result.data.user, error: result.error, usesBearer: Boolean(token) };
}
