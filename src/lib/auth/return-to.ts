import type { AppRole } from "./types";
import { routeForRole } from "./types";

export const STOREFRONT_QUOTE_RETURN_TO = "/?quote=review";

export function resolveSafeReturnTo(role: AppRole, value?: string | null) {
  const root = routeForRole(role);
  if (!value || value.startsWith("//")) return root;
  if (role === "customer" && value === STOREFRONT_QUOTE_RETURN_TO) return value;
  return value === root || value.startsWith(`${root}/`) ? value : root;
}

export function quoteReturnToQuery(value?: string | null) {
  return value === STOREFRONT_QUOTE_RETURN_TO
    ? `?returnTo=${encodeURIComponent(STOREFRONT_QUOTE_RETURN_TO)}`
    : "";
}
