import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
