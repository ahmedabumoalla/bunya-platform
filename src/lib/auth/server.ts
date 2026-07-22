import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthIdentity, roleIsReady } from "./resolve-identity";
import { routeForRole, type AppRole, type AuthIdentity } from "./types";

export const getAuthIdentity = cache(async (): Promise<AuthIdentity | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return resolveAuthIdentity(supabase, data.user);
});

export async function requirePortalRole(expectedRole: AppRole) {
  const identity = await getAuthIdentity();
  if (!identity) redirect("/login");

  if (identity.status !== "ready" || !identity.primaryRole) {
    redirect(`/login?error=${encodeURIComponent(identity.status)}`);
  }

  if (identity.primaryRole !== expectedRole) {
    redirect(routeForRole(identity.primaryRole));
  }

  if (!identity.activeRoles.includes(expectedRole) || !roleIsReady(expectedRole, identity.details)) {
    redirect("/login?error=role_not_ready");
  }

  return identity;
}
