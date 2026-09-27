import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

export function createClient() {
  const { url, key } = getSupabasePublicEnv();
  return createBrowserClient(url, key, { global: { fetch: async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (typeof document !== "undefined" && document.cookie.split("; ").some(value => value === "bunya-maintenance-active=1") && target.origin === new URL(url).origin) {
      // The browser keeps only its original admin session. User tokens remain encrypted
      // and HttpOnly; every delegated Data/Storage request is re-authorized server-side.
      if (!target.pathname.startsWith("/auth/v1/token")) {
        const request = input instanceof Request ? input : null;
        const headers = new Headers(init?.headers || request?.headers);
        headers.delete("authorization"); headers.delete("apikey");
        return fetch(`/api/maintenance/supabase${target.pathname}${target.search}`, {
          ...init, method: init?.method || request?.method, headers, credentials: "same-origin",
          body: init?.body ?? (request && !["GET", "HEAD"].includes(request.method) ? await request.arrayBuffer() : undefined),
        });
      }
    }
    return fetch(input, init);
  } } });
}
