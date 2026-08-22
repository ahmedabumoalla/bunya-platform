import type { User } from "@supabase/supabase-js";
import type { AuthIdentity } from "./types";

export function normalizeSaudiPhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("05")) digits = `966${digits.slice(1)}`;
  else if (digits.startsWith("5")) digits = `966${digits}`;
  return /^9665\d{8}$/.test(digits) ? `+${digits}` : null;
}

export function requiresPhoneVerification(user: User, identity: AuthIdentity) {
  if (user.phone && user.phone_confirmed_at) return false;
  if (!identity.profile?.isActive) return false;
  if (identity.activeRoles.some((role) => role === "customer" || role === "provider")) return true;
  return identity.status === "missing_role";
}

export function maskSaudiPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length < 7 ? "***" : `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}
