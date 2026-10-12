"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { adminGroups } from "@/lib/admin/navigation";

type Attention = { counts: Record<string, number | null>; loading: boolean; error: boolean; refresh: () => void };
const AttentionContext = createContext<Attention | null>(null);
const destinations = adminGroups.flatMap(([, items]) => items.map(([, href]) => href));

export function AdminAttentionProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuthIdentity();
  const pathname = usePathname();
  const [counts, setCounts] = useState<Attention["counts"]>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      if (!userId) throw new Error("missing_identity");
      const result = await createClient().rpc("admin_attention_counts");
      if (result.error || !result.data || typeof result.data !== "object") throw new Error("counts_unavailable");
      if (current !== generation.current) return;
      const values = result.data as Record<string, unknown>;
      setCounts(Object.fromEntries(destinations.map(href => {
        const value = values[href];
        return [href, typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null];
      })));
      setError(false);
    } catch {
      if (current !== generation.current) return;
      // Unavailable counts are never presented as zero or as an outdated queue size.
      setCounts(Object.fromEntries(destinations.map(href => [href, null])));
      setError(true);
    } finally { if (current === generation.current) setLoading(false); }
  }, [userId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("bunya:notifications-read", visibleRefresh);
    window.addEventListener("bunya:admin-data-changed", visibleRefresh);
    return () => {
      active = false;invalidate();
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      window.removeEventListener("bunya:notifications-read", visibleRefresh);
      window.removeEventListener("bunya:admin-data-changed", visibleRefresh);
    };
  }, [refresh, pathname, invalidate]);
  return <AttentionContext.Provider value={{ counts, loading, error, refresh }}>{children}</AttentionContext.Provider>;
}

export function useAdminAttention() {
  const value = useContext(AttentionContext);
  if (!value) throw new Error("AdminAttentionProvider is required");
  return value;
}

export function AdminAttentionBadge({ href }: { href: string }) {
  const { counts } = useAdminAttention();
  const count = counts[href];
  if (!count) return null;
  return <em className="admin-nav-count" aria-label={`${count.toLocaleString("ar-SA")} بانتظار المتابعة`} title={`${count.toLocaleString("ar-SA")} بانتظار المتابعة`}>{count > 99 ? "99+" : count.toLocaleString("en-US")}</em>;
}
