import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { routeForRole } from "@/lib/auth/types";
import { assertMaintenanceOrigin, requireSuperAdmin, ImpersonationError } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE, IMPERSONATION_MARKER, isUuid, sessionId, sealImpersonation } from "@/lib/auth/impersonation-cookie";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let mintedToken: string | null = null;
  let grantId: string | null = null;
  try {
    assertMaintenanceOrigin(request);
    const store = await cookies();
    if (store.has(IMPERSONATION_COOKIE)) throw new ImpersonationError("أنه جلسة الصيانة الحالية أولًا.");
    const { identity: actor, session } = await requireSuperAdmin();
    if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ message: "الطلب أكبر من المسموح." }, { status: 413 });
    const body = await request.json();
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!isUuid(body.targetUserId) || body.targetUserId === actor.userId || reason.length < 8 || reason.length > 500) {
      return NextResponse.json({ message: "اختر حسابًا آخر واكتب سبب الصيانة من 8 إلى 500 حرف." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(body.targetUserId);
    if (error || !data.user?.email || !data.user.email_confirmed_at) throw new ImpersonationError("الحساب غير جاهز للدخول؛ يلزم وجود بريد موثّق.");
    const target = await resolveAuthIdentity(admin, data.user);
    if (target.status !== "ready" || !target.primaryRole || target.activeRoles.includes("admin") || target.profile?.mustChangePassword) {
      throw new ImpersonationError("يمكن الدخول بالنيابة لحساب مستخدم نشط وجاهز فقط، ولا يشمل حسابات الإدارة.");
    }
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user.email });
    if (link.error || !link.data.properties?.hashed_token) throw new Error("Unable to prepare maintenance session.");
    const { url, key } = getSupabasePublicEnv();
    const ephemeral = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor } });
    const verified = await ephemeral.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
    mintedToken = verified.data.session?.access_token || null;
    if (verified.error || !mintedToken || verified.data.user?.id !== target.userId) throw new Error("Unable to verify maintenance session.");
    // No refresh token is persisted or returned; this window cannot be extended by the browser.
    const expiresAt = Math.min(Date.now() + 15 * 60_000, (verified.data.session!.expires_at! - 15) * 1000);
    const ticket = { id: randomUUID(), actorId: actor.userId, actorSessionId: sessionId(session.access_token), targetId: target.userId,
      targetSessionId: sessionId(mintedToken), accessToken: mintedToken, expiresAt };
    const sealed = sealImpersonation(ticket);
    if (sealed.length > 3800) throw new Error("Maintenance session is too large.");
    const { error: insertError } = await admin.from("admin_impersonation_sessions").insert({
      id: ticket.id, actor_profile_id: actor.userId, actor_auth_session_id: ticket.actorSessionId,
      target_profile_id: target.userId, target_auth_session_id: ticket.targetSessionId,
      reason, expires_at: new Date(expiresAt).toISOString(),
    });
    if (insertError) throw new Error("Unable to record maintenance authorization.");
    grantId = ticket.id;
    const options = { secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
    // Retain expired tickets until explicit exit; never silently revert a user's action to admin.
    store.set(IMPERSONATION_COOKIE, sealed, { ...options, httpOnly: true });
    store.set(IMPERSONATION_MARKER, "1", { ...options, httpOnly: false });
    return NextResponse.json({ redirectTo: routeForRole(target.primaryRole) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (grantId) await createAdminClient().from("admin_impersonation_sessions").update({ ended_at: new Date().toISOString() }).eq("id", grantId);
    if (mintedToken) await createAdminClient().auth.admin.signOut(mintedToken, "local");
    return NextResponse.json({ message: error instanceof ImpersonationError ? error.message : "تعذر بدء الدخول بالنيابة. حاول مرة أخرى." }, { status: error instanceof ImpersonationError ? 403 : 500 });
  }
}
