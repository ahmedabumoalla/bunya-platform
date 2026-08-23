import "server-only";
import { randomInt } from "node:crypto";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function requireJoinReviewer(request?: Request) {
  const authorization = request?.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const session = token ? (() => {
    const { url, key } = getSupabasePublicEnv();
    return createTokenClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  })() : await createClient();
  const { data: userData } = await session.auth.getUser(token || undefined);
  if (!userData.user) return { error: "unauthorized" as const };
  const { data: allowed, error } = await session.rpc("admin_has_permission", { requested_permission: "reviews.manage" });
  if (error || allowed !== true) return { error: "forbidden" as const };
  return { userId: userData.user.id, admin: createAdminClient() };
}

export function generateTemporaryPassword(length = 18) {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_+"];
  const chars = groups.map((group) => group[randomInt(group.length)]);
  const all = groups.join("");
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
