import { routeForRole, type AuthIdentity } from "./types";

export type PublicAccount = { signedIn: boolean; href: string; canApplyProvider: boolean; canApplyContractor: boolean; displayName: string; roleLabel: string; initials: string };

export function publicAccountFor(identity: AuthIdentity | null): PublicAccount {
  const role = identity?.primaryRole;
  const roleLabel = role ? { admin: "إدارة المنصة", provider: "حساب المزوّد", contractor: "حساب المقاول", customer: "حساب العميل", driver: "حساب السائق" }[role] : "حساب بُنية";
  const displayName = identity?.profile?.fullName?.trim()
    || (role === "provider" ? identity?.details.provider?.companyName : role === "contractor" ? identity?.details.contractor?.displayName : null)
    || "حسابك في بُنية";
  return {
    signedIn: Boolean(identity),
    href: identity?.profile?.mustChangePassword ? "/account/change-password" : identity?.status === "ready" && identity.primaryRole ? routeForRole(identity.primaryRole) : "/login",
    canApplyProvider: !identity,
    canApplyContractor: !identity,
    displayName,
    roleLabel,
    initials: displayName === "حسابك في بُنية" ? "" : displayName.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join(""),
  };
}
