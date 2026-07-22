import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

export function createClient() {
  const { url, key } = getSupabasePublicEnv();
  return createBrowserClient(url, key);
}
