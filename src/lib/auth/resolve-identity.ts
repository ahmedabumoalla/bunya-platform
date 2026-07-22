import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isAppRole,
  type AppRole,
  type AuthIdentity,
  type ProfileIdentity,
  type RoleDetails,
} from "./types";

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  mobile: string | null;
  email: string | null;
  is_active: boolean;
};

type UserRoleRow = {
  role: string;
  is_primary: boolean;
  granted_at: string;
};

const emptyDetails = (): RoleDetails => ({
  customer: { exists: false },
  provider: null,
  contractor: null,
  driver: null,
  admin: null,
});

export async function resolveAuthIdentity(supabase: SupabaseClient, user: User): Promise<AuthIdentity> {
  const [profileResult, rolesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,username,full_name,mobile,email,is_active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role,is_primary,granted_at")
      .eq("profile_id", user.id)
      .is("revoked_at", null),
  ]);

  if (profileResult.error || rolesResult.error) {
    throw new Error("Unable to read the authenticated profile and roles.");
  }

  const profileRow = profileResult.data as ProfileRow | null;
  const roleRows = ((rolesResult.data ?? []) as UserRoleRow[]).filter((row) => isAppRole(row.role));
  const activeRoles = uniqueRoles(roleRows.map((row) => row.role as AppRole));
  const markedPrimary = roleRows.find((row) => row.is_primary)?.role;
  const primaryRole = isAppRole(markedPrimary) ? markedPrimary : null;
  const primaryRoleSource: AuthIdentity["primaryRoleSource"] = primaryRole ? "database" : null;
  const profile: ProfileIdentity | null = profileRow
    ? {
        id: profileRow.id,
        username: profileRow.username,
        fullName: profileRow.full_name,
        mobile: profileRow.mobile,
        email: profileRow.email,
        isActive: profileRow.is_active,
      }
    : null;

  const details = await loadRoleDetails(supabase, user.id, activeRoles);
  const base = {
    userId: user.id,
    authEmail: user.email ?? null,
    profile,
    activeRoles,
    primaryRole,
    primaryRoleSource,
    details,
  };

  if (!profile) return { ...base, status: "missing_profile" };
  if (!profile.isActive) return { ...base, status: "inactive_profile" };
  if (activeRoles.length === 0) return { ...base, status: "missing_role" };
  if (!primaryRole) return { ...base, status: "missing_primary_role" };
  if (!roleIsReady(primaryRole, details)) return { ...base, status: "role_not_ready" };
  return { ...base, status: "ready" };
}

async function loadRoleDetails(supabase: SupabaseClient, userId: string, roles: AppRole[]): Promise<RoleDetails> {
  const details = emptyDetails();
  const wants = (role: AppRole) => roles.includes(role);

  const [customerResult, providerMemberResult, contractorResult, driverAccountResult, adminUserResult] =
    await Promise.all([
      wants("customer")
        ? supabase.from("customer_profiles").select("profile_id").eq("profile_id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
      wants("provider")
        ? supabase
            .from("provider_members")
            .select("provider_id,member_role,is_active")
            .eq("profile_id", userId)
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      wants("contractor")
        ? supabase
            .from("contractor_profiles")
            .select("id,display_name,approval_status")
            .eq("profile_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      wants("driver")
        ? supabase
            .from("provider_driver_accounts")
            .select("driver_id")
            .eq("auth_user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      wants("admin")
        ? supabase
            .from("admin_users")
            .select("id,role_id,is_active")
            .eq("profile_id", userId)
            .eq("is_active", true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const roleQueryFailed = [customerResult, providerMemberResult, contractorResult, driverAccountResult, adminUserResult]
    .some((result) => "error" in result && Boolean(result.error));
  if (roleQueryFailed) throw new Error("Unable to verify role membership.");

  details.customer.exists = Boolean(customerResult.data);

  const providerMember = providerMemberResult.data as
    | { provider_id: string; member_role: string; is_active: boolean }
    | null;
  if (providerMember) {
    const providerResult = await supabase
      .from("providers")
      .select("id,company_name,status")
      .eq("id", providerMember.provider_id)
      .maybeSingle();
    if (providerResult.error) throw new Error("Unable to verify the provider account.");
    const provider = providerResult.data as
      | { id: string; company_name: string; status: string }
      | null;
    if (provider && provider.status !== "suspended") {
      details.provider = {
        providerId: provider.id,
        memberRole: providerMember.member_role,
        companyName: provider.company_name,
        status: provider.status,
      };
    }
  }

  const contractor = contractorResult.data as
    | { id: string; display_name: string; approval_status: string }
    | null;
  if (contractor) {
    details.contractor = {
      contractorProfileId: contractor.id,
      displayName: contractor.display_name,
      approvalStatus: contractor.approval_status,
    };
  }

  const driverAccount = driverAccountResult.data as { driver_id: string } | null;
  if (driverAccount) {
    const driverResult = await supabase
      .from("provider_drivers")
      .select("id,provider_id,full_name,email,status,must_change_password")
      .eq("id", driverAccount.driver_id)
      .maybeSingle();
    if (driverResult.error) throw new Error("Unable to verify the driver account.");
    const driver = driverResult.data as
      | {
          id: string;
          provider_id: string;
          full_name: string;
          email: string;
          status: string;
          must_change_password: boolean;
        }
      | null;
    if (driver && driver.status !== "suspended") {
      const providerResult = await supabase
        .from("providers")
        .select("company_name")
        .eq("id", driver.provider_id)
        .maybeSingle();
      if (providerResult.error) throw new Error("Unable to read the driver's provider.");
      const provider = providerResult.data as { company_name: string } | null;
      details.driver = {
        driverId: driver.id,
        providerId: driver.provider_id,
        providerName: provider?.company_name ?? "منشأة المزود",
        fullName: driver.full_name,
        email: driver.email,
        status: driver.status,
        mustChangePassword: driver.must_change_password,
      };
    }
  }

  const adminUser = adminUserResult.data as
    | { id: string; role_id: string; is_active: boolean }
    | null;
  if (adminUser) {
    const adminRoleResult = await supabase
      .from("admin_roles")
      .select("role_key")
      .eq("id", adminUser.role_id)
      .maybeSingle();
    if (adminRoleResult.error) throw new Error("Unable to read the administrator role.");
    const adminRole = adminRoleResult.data as { role_key: string } | null;
    if (adminRole) {
      details.admin = { adminUserId: adminUser.id, roleKey: adminRole.role_key };
    }
  }
  if (wants("admin") && !details.admin) {
    const permissionResult = await supabase.rpc("admin_has_permission", {
      requested_permission: "profiles.read",
    });
    if (permissionResult.data === true) {
      details.admin = { adminUserId: null, roleKey: "authorized_admin" };
    }
  }

  return details;
}

export function roleIsReady(role: AppRole, details: RoleDetails) {
  if (role === "customer") return details.customer.exists;
  return Boolean(details[role]);
}

function uniqueRoles(roles: AppRole[]) {
  return [...new Set(roles)];
}
