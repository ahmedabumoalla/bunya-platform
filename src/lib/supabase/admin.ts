import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import WebSocket from "ws";
import { getSupabasePublicEnv } from "./env";
import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE, openImpersonation } from "@/lib/auth/impersonation-cookie";

export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
    global: { fetch: async (input, init) => {
      let sealed: string | undefined;
      try { sealed = (await cookies()).get(IMPERSONATION_COOKIE)?.value; } catch { /* CLI/background job has no request cookies. */ }
      const ticket = openImpersonation(sealed);
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.delete("x-bunya-impersonation");
      if (ticket) headers.set("x-bunya-impersonation", ticket.id);
      return fetch(input, { ...init, headers });
    } },
  });
}
