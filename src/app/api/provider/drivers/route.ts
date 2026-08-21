import { NextRequest, NextResponse } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { generateTemporaryPassword } from "@/lib/join/admin";
import {
  assertSameOrigin,
  normalizeEmail,
  normalizeMobile,
  PublicJoinError,
} from "@/lib/join/security";
import { isValidJoinUsername, normalizeJoinUsername } from "@/lib/join/username";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type DriverBody = {
  fullName?: unknown;
  mobile?: unknown;
  email?: unknown;
  username?: unknown;
  internalNotes?: unknown;
};

async function requireProvider() {
  const identity = await getAuthIdentity();
  const provider = identity?.details.provider;
  if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider") || !provider) {
    throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 401);
  }
  return { identity, provider };
}

function cleanText(value: unknown, min: number, max: number) {
  const result = String(value ?? "").normalize("NFKC").trim();
  if (result.length < min || result.length > max) throw new PublicJoinError("بعض بيانات السائق غير مكتملة أو غير صالحة.", 400);
  return result;
}

export async function POST(request: NextRequest) {
  let authUserId: string | null = null;
  let driverId: string | null = null;
  try {
    assertSameOrigin(request);
    const { identity, provider } = await requireProvider();
    const body = await request.json() as DriverBody;
    const fullName = cleanText(body.fullName, 3, 120);
    const email = normalizeEmail(String(body.email ?? ""));
    const mobile = normalizeMobile(String(body.mobile ?? ""));
    const username = normalizeJoinUsername(String(body.username ?? ""));
    const internalNotes = String(body.internalNotes ?? "").normalize("NFKC").trim().slice(0, 500) || null;
    if (!isValidJoinUsername(username)) throw new PublicJoinError("اسم المستخدم يجب أن يكون من 4 إلى 40 حرفًا وبدون مسافات.", 400);

    const admin = createAdminClient();
    const duplicateProfiles = await Promise.all([
      admin.from("profiles").select("id").eq("email", email).limit(1),
      admin.from("profiles").select("id").eq("mobile", mobile).limit(1),
      admin.from("profiles").select("id").ilike("username", username).limit(1),
    ]);
    if (duplicateProfiles.some((result) => result.error)) throw new Error("driver_identity_lookup_failed");
    if (duplicateProfiles.some((result) => result.data?.length)) throw new PublicJoinError("البريد أو الجوال أو اسم المستخدم مرتبط بحساب آخر.", 409);

    const password = generateTemporaryPassword();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username, mobile, onboarding_role: "driver" },
    });
    if (created.error || !created.data.user) throw new PublicJoinError("تعذر إنشاء حساب الدخول؛ تحقق من عدم تعارض البريد.", 409);
    authUserId = created.data.user.id;

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 72 * 60 * 60 * 1000);
    const profile = await admin
      .from("profiles")
      .update({
        role: "driver",
        username,
        full_name: fullName,
        mobile,
        email,
        is_active: true,
        must_change_password: true,
        temporary_password_issued_at: issuedAt.toISOString(),
        temporary_password_expires_at: expiresAt.toISOString(),
        password_changed_at: null,
        updated_at: issuedAt.toISOString(),
      })
      .eq("id", authUserId)
      .select("id")
      .single();
    if (profile.error) throw new Error("driver_profile_setup_failed");

    const customerCleanup = await admin.from("customer_profiles").delete().eq("profile_id", authUserId);
    if (customerCleanup.error) throw new Error("driver_customer_cleanup_failed");
    const primaryReset = await admin.from("user_roles").update({ is_primary: false }).eq("profile_id", authUserId).is("revoked_at", null);
    if (primaryReset.error) throw new Error("driver_role_reset_failed");
    const customerRoleCleanup = await admin.from("user_roles").delete().eq("profile_id", authUserId).eq("role", "customer");
    if (customerRoleCleanup.error) throw new Error("driver_customer_role_cleanup_failed");
    const driverRole = await admin.from("user_roles").insert({
      profile_id: authUserId,
      role: "driver",
      is_primary: true,
      granted_by: identity.userId,
    });
    if (driverRole.error) throw new Error("driver_role_setup_failed");

    const driver = await admin.from("provider_drivers").insert({
      provider_id: provider.providerId,
      full_name: fullName,
      mobile,
      email,
      username,
      status: "must_change_password",
      must_change_password: true,
      internal_notes: internalNotes,
      created_by_provider_id: provider.providerId,
    }).select("id,full_name,email,username,status,must_change_password,created_at").single();
    if (driver.error || !driver.data) throw new Error("driver_record_setup_failed");
    driverId = driver.data.id;

    const account = await admin.from("provider_driver_accounts").insert({
      driver_id: driver.data.id,
      auth_user_id: authUserId,
      force_password_change_at: issuedAt.toISOString(),
    });
    if (account.error) throw new Error("driver_account_link_failed");

    await admin.from("audit_logs").insert({
      actor_profile_id: identity.userId,
      entity_table: "provider_drivers",
      entity_id: driver.data.id,
      action: "provider_driver_created",
      new_data: { provider_id: provider.providerId, driver_id: driver.data.id },
    });

    return NextResponse.json({
      driver: driver.data,
      credentials: { email, username, temporaryPassword: password, expiresAt: expiresAt.toISOString() },
    }, { status: 201 });
  } catch (error) {
    if (driverId) await createAdminClient().from("provider_drivers").delete().eq("id", driverId);
    if (authUserId) await createAdminClient().auth.admin.deleteUser(authUserId).catch(() => undefined);
    if (error instanceof PublicJoinError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("provider_driver_creation_failed", { code: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "تعذر إكمال إنشاء السائق وتم التراجع عن الحساب بأمان." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { identity, provider } = await requireProvider();
    const body = await request.json() as { id?: unknown; status?: unknown };
    const id = String(body.id ?? "");
    const requestedStatus = String(body.status ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["active", "suspended"].includes(requestedStatus)) {
      throw new PublicJoinError("بيانات تحديث السائق غير صالحة.", 400);
    }

    const admin = createAdminClient();
    const existing = await admin.from("provider_drivers")
      .select("id,must_change_password,provider_driver_accounts(auth_user_id)")
      .eq("id", id)
      .eq("provider_id", provider.providerId)
      .maybeSingle();
    if (existing.error || !existing.data) throw new PublicJoinError("لم يتم العثور على السائق ضمن منشأتك.", 404);

    const status = requestedStatus === "active" && existing.data.must_change_password ? "must_change_password" : requestedStatus;
    const updated = await admin.from("provider_drivers").update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("provider_id", provider.providerId)
      .select("id,status")
      .single();
    if (updated.error) throw new Error("driver_status_update_failed");

    const accountRelation = existing.data.provider_driver_accounts as unknown as { auth_user_id?: string | null } | { auth_user_id?: string | null }[] | null;
    const authUserId = Array.isArray(accountRelation) ? accountRelation[0]?.auth_user_id : accountRelation?.auth_user_id;
    if (authUserId) {
      const profile = await admin.from("profiles").update({ is_active: requestedStatus !== "suspended", updated_at: new Date().toISOString() }).eq("id", authUserId);
      if (profile.error) throw new Error("driver_profile_status_update_failed");
    }

    await admin.from("audit_logs").insert({
      actor_profile_id: identity.userId,
      entity_table: "provider_drivers",
      entity_id: id,
      action: requestedStatus === "suspended" ? "provider_driver_suspended" : "provider_driver_reactivated",
      new_data: { provider_id: provider.providerId, status },
    });
    return NextResponse.json({ id, status });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("provider_driver_update_failed", { code: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "تعذر تحديث حالة السائق." }, { status: 500 });
  }
}
