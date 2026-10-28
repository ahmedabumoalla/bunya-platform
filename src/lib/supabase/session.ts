import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";
import { createArchiveFetch } from "./archive-fetch";
import { archiveProxyOrigin } from "./archive-origin";

/** The operator's original session. Never substitutes the maintenance identity. */
export async function createOriginalClient() {
  const store = await cookies(), { url, key } = getSupabasePublicEnv();
  return createServerClient(url, key, { global: { fetch: createArchiveFetch(url, fetch, archiveProxyOrigin) }, cookies: {
    getAll: () => store.getAll(),
    setAll(values) { try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Proxy refreshes Server Component cookies. */ } },
  } });
}
