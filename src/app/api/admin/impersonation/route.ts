import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { archiveActorStatus } from "@/lib/supabase/archive-server";
import { ARCHIVE_SCHEMA } from "@/lib/supabase/archive-fetch";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { routeForRole } from "@/lib/auth/types";
import { assertMaintenanceOrigin, requireImpersonationOperator, ImpersonationError } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE, IMPERSONATION_MARKER, isUuid, sessionId, sealImpersonation } from "@/lib/auth/impersonation-cookie";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let mintedToken: string | null = null;
  let grantId: string | null = null;
  try {
    assertMaintenanceOrigin(request);
    const store = await cookies();
    if (store.has(IMPERSONATION_COOKIE)) throw new ImpersonationError("أنه جلسة الصيانة الحالية أولًا.");
    const { identity: actor, session } = await requireImpersonationOperator();
    if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ message: "الطلب أكبر من المسموح." }, { status: 413 });
    const body = await request.json();
    if (!isUuid(body.targetUserId) || body.targetUserId === actor.userId) {
      return NextResponse.json({ message: "اختر حساب المستخدم المطلوب." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(body.targetUserId);
    if (error || !data.user?.email || !data.user.email_confirmed_at) throw new ImpersonationError("الحساب غير جاهز للدخول؛ يلزم وجود بريد موثّق.");
    const archive = await archiveActorStatus(data.user.id);
    if (archive.active && !archive.eligible) throw new ImpersonationError("الحساب غير مؤهل للدخول بالنيابة.");
    const target = await resolveAuthIdentity(archive.active ? admin.schema(ARCHIVE_SCHEMA) : admin, data.user);
    if (target.status !== "ready" || !target.primaryRole) {
      throw new ImpersonationError("يمكن الدخول بالنيابة لحساب نشط وجاهز للدخول فقط.");
    }
    const nonce = randomBytes(32).toString("hex");
    const preparedId = randomUUID();
    const actorSessionId = sessionId(session.access_token);
    const prepared = await admin.rpc("prepare_admin_impersonation", {
      p_id: preparedId, p_actor: actor.userId, p_actor_session: actorSessionId,
      p_target: target.userId, p_nonce_hash: createHash("sha256").update(nonce).digest("hex"),
    });
    if (prepared.error?.message === "A maintenance session is already active") throw new ImpersonationError("توجد جلسة دخول بالنيابة مفتوحة. ارجع إلى حساب الإدارة من الجلسة المفتوحة أولًا.");
    if (prepared.error?.message === "Maintenance token preparation is already active") throw new ImpersonationError("جارٍ بدء جلسة الدخول بالنيابة. انتظر قليلًا ثم أعد المحاولة.");
    if (prepared.error) throw new Error("Unable to authorize maintenance session.");
    grantId = preparedId;
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user.email });
    if (link.error || !link.data.properties?.hashed_token) throw new Error("Unable to prepare maintenance session.");
    const { url, key } = getSupabasePublicEnv();
    const ephemeral = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
      global: { headers: { "User-Agent": `bunya-maintenance/${nonce}` } },
    });
    const verified = await ephemeral.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
    mintedToken = verified.data.session?.access_token || null;
    if (verified.error || !mintedToken || verified.data.user?.id !== target.userId) throw new Error("Unable to verify maintenance session.");
    // The Auth hook binds the one-use authorization to this exact new session.
    // It permits onboarding access without changing the user's password state.
    const targetSessionId = sessionId(mintedToken);
    const recorded = await admin.from("admin_impersonation_sessions")
      .select("id,actor_profile_id,target_profile_id,target_auth_session_id,expires_at")
      .eq("id", preparedId).maybeSingle();
    if (recorded.error || !recorded.data || recorded.data.actor_profile_id !== actor.userId || recorded.data.target_profile_id !== target.userId || recorded.data.target_auth_session_id !== targetSessionId) {
      throw new Error("Maintenance authorization was not bound to this session.");
    }
    // No refresh token is persisted or returned; this window cannot be extended by the browser.
    const expiresAt = Math.min(new Date(recorded.data.expires_at).getTime(), (verified.data.session!.expires_at! - 15) * 1000);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Maintenance session expired during authorization.");
    const ticket = { id: preparedId, actorId: actor.userId, actorSessionId, targetId: target.userId,
      targetSessionId, accessToken: mintedToken, expiresAt };
    const sealed = sealImpersonation(ticket);
    if (sealed.length > 3800) throw new Error("Maintenance session is too large.");
    await admin.rpc("cancel_admin_impersonation_prepare", { p_id: preparedId });
    const options = { secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
    // Retain expired tickets until explicit exit; never silently revert a user's action to admin.
    store.set(IMPERSONATION_COOKIE, sealed, { ...options, httpOnly: true });
    store.set(IMPERSONATION_MARKER, "1", { ...options, httpOnly: false });
    return NextResponse.json({ redirectTo: routeForRole(target.primaryRole) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (grantId) await createAdminClient().from("admin_impersonation_sessions").update({ ended_at: new Date().toISOString() }).eq("id", grantId);
    if (mintedToken) await createAdminClient().auth.admin.signOut(mintedToken, "local");
    if (grantId) await createAdminClient().rpc("cancel_admin_impersonation_prepare", { p_id: grantId });
    return NextResponse.json({ message: error instanceof ImpersonationError ? error.message : "تعذر بدء الدخول بالنيابة. حاول مرة أخرى." }, { status: error instanceof ImpersonationError ? 403 : 500 });
  }
}
