import { routeForRole, type AuthIdentity } from "./types";

export type PublicAccount = { signedIn: boolean; href: string; canApplyProvider: boolean; canApplyContractor: boolean };

export function publicAccountFor(identity: AuthIdentity | null): PublicAccount {
  return {
    signedIn: Boolean(identity),
    href: identity?.profile?.mustChangePassword ? "/account/change-password" : identity?.status === "ready" && identity.primaryRole ? routeForRole(identity.primaryRole) : "/login",
    canApplyProvider: !identity?.activeRoles.includes("provider"),
    canApplyContractor: !identity?.activeRoles.includes("contractor"),
  };
}
