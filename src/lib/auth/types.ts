export const APP_ROLES = ["customer", "provider", "contractor", "driver", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_ROUTES: Record<AppRole, string> = {
  admin: "/admin",
  provider: "/merchant",
  contractor: "/contractor",
  driver: "/driver",
  customer: "/customer",
};

export type IdentityStatus =
  | "ready"
  | "inactive_profile"
  | "missing_profile"
  | "missing_role"
  | "missing_primary_role"
  | "role_not_ready";

export type ProfileIdentity = {
  id: string;
  username: string | null;
  fullName: string | null;
  mobile: string | null;
  email: string | null;
  isActive: boolean;
};

export type RoleDetails = {
  customer: { exists: boolean };
  provider: {
    providerId: string;
    memberRole: string;
    companyName: string;
    status: string;
  } | null;
  contractor: {
    contractorProfileId: string;
    displayName: string;
    approvalStatus: string;
  } | null;
  driver: {
    driverId: string;
    providerId: string;
    providerName: string;
    fullName: string;
    email: string;
    status: string;
    mustChangePassword: boolean;
  } | null;
  admin: {
    adminUserId: string | null;
    roleKey: string;
  } | null;
};

export type AuthIdentity = {
  userId: string;
  authEmail: string | null;
  profile: ProfileIdentity | null;
  activeRoles: AppRole[];
  primaryRole: AppRole | null;
  primaryRoleSource: "database" | null;
  details: RoleDetails;
  status: IdentityStatus;
};

export type ClientAuthIdentity = Pick<
  AuthIdentity,
  "userId" | "authEmail" | "profile" | "activeRoles" | "primaryRole" | "primaryRoleSource" | "details"
>;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole);
}

export function routeForRole(role: AppRole) {
  return ROLE_ROUTES[role];
}
