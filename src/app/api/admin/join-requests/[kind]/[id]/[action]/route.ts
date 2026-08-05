import { NextRequest, NextResponse } from "next/server";
import { generateTemporaryPassword, requireJoinReviewer } from "@/lib/join/admin";
import { sendOnboardingCredentials } from "@/lib/notifications/send-onboarding-credentials";
import {sendGreenApiMessage,maskWhatsAppDestination} from "@/lib/notifications/providers/green-api";
import {recordProviderSubmission} from "@/lib/notifications/submissions";
import {createHash,randomBytes} from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string; id: string; action: string }> }) {
  const auth = await requireJoinReviewer();
  if ("error" in auth) return NextResponse.json({ message: "غير مصرح بهذا الإجراء." }, { status: auth.error === "unauthorized" ? 401 : 403 });
  const { kind, id, action } = await context.params;
  if (!['provider','contractor'].includes(kind) || !['approve','reject','needs-changes','resend-credentials','retry-provisioning'].includes(action)) return NextResponse.json({ message: "المسار غير صالح." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { reason?: string };
  const reason = body.reason?.trim() || "";
  if (reason.length < 5) return NextResponse.json({ message: "سبب القرار مطلوب (خمسة أحرف على الأقل)." }, { status: 400 });
  const table = kind === "provider" ? "provider_applications" : "contractor_applications";
  const application = await auth.admin.from(table).select("*").eq("id", id).maybeSingle();
  if (application.error || !application.data) return NextResponse.json({ message: "الطلب غير موجود." }, { status: 404 });

  if (action === "reject" || action === "needs-changes") {
    if (application.data.status === "approved") return NextResponse.json({ message: "لا يمكن تغيير طلب معتمد بهذه العملية." }, { status: 409 });
    const status = action === "reject" ? "rejected" : "needs_changes";
    const updated = await auth.admin.from(table).update({ status, reviewed_by: auth.userId, reviewed_at: new Date().toISOString(), review_notes: reason }).eq("id", id).in("status", ["pending","needs_changes"]).select("id").maybeSingle();
    if (updated.error || !updated.data) return NextResponse.json({ message: "تعذر تسجيل القرار أو سبق تنفيذه." }, { status: 409 });
    await recordReview(auth.admin, auth.userId, kind, id, status, reason);
    const site=process.env.APP_URL||"https://bunya-platform.vercel.app";
    if(action==="reject"){const key=`join-rejected-${kind}-${id}`;const sent=await sendGreenApiMessage({to:application.data.mobile,text:`تعذر اعتماد طلب الانضمام رقم ${id}.\nالسبب: ${reason}\nيمكنك التواصل مع إدارة منصة بُنية عند الحاجة.`,idempotencyKey:key});await recordProviderSubmission({eventType:"join.application_rejected",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(application.data.mobile),idempotencyKey:key,result:sent}).catch(()=>undefined)}
    if(action==="needs-changes"){
      await auth.admin.from("join_application_revision_tokens").update({used_at:new Date().toISOString()}).eq("application_kind",kind).eq("application_id",id).is("used_at",null);
      const token=randomBytes(32).toString("base64url"),hash=createHash("sha256").update(token).digest("hex");
      const created=await auth.admin.from("join_application_revision_tokens").insert({application_kind:kind,application_id:id,token_hash:hash,expires_at:new Date(Date.now()+48*3600000).toISOString(),created_by:auth.userId});
      if(created.error)return NextResponse.json({message:"تعذر إنشاء رابط التعديل."},{status:500});
      const key=`join-needs-changes-${kind}-${id}-${hash.slice(0,12)}`;
      const sent=await sendGreenApiMessage({to:application.data.mobile,text:`طلب الانضمام رقم ${id} يحتاج تعديلات.\nملاحظات الإدارة: ${reason}\nأكمل التعديل خلال 48 ساعة: ${site}/join/revise/${token}`,idempotencyKey:key});
      await recordProviderSubmission({eventType:"join.application_needs_changes",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(application.data.mobile),idempotencyKey:key,result:sent}).catch(()=>undefined)
    }
    return NextResponse.json({ status });
  }

  if (action === "resend-credentials") {
    const onboarding = await auth.admin.from("account_onboarding_deliveries").select("auth_user_id").eq("application_kind", kind).eq("application_id", id).maybeSingle();
    if (!onboarding.data?.auth_user_id) return NextResponse.json({ message: "الحساب غير جاهز لإعادة الإرسال." }, { status: 409 });
    const password = generateTemporaryPassword();
    const changed = await auth.admin.auth.admin.updateUserById(onboarding.data.auth_user_id, { password });
    if (changed.error) return NextResponse.json({ message: "تعذر تحديث بيانات الدخول." }, { status: 500 });
    const delivery = await sendOnboardingCredentials({ kind: kind as "provider"|"contractor", email: application.data.email, mobile: application.data.mobile, password, idempotencyKey: `onboarding-resend-${id}-${crypto.randomUUID()}` });
    await markDelivery(auth.admin, kind, id, delivery);
    return NextResponse.json({ status: deliveryStatus(delivery) });
  }

  if (!['pending','needs_changes'].includes(application.data.status)) return NextResponse.json({ message: "الطلب غير قابل للموافقة أو سبق تنفيذه." }, { status: 409 });
  const existing = await auth.admin.from("account_onboarding_deliveries").select("auth_user_id,provisioning_status").eq("application_kind", kind).eq("application_id", id).maybeSingle();
  if (existing.data?.auth_user_id) return NextResponse.json({ message: "تم إنشاء الحساب لهذا الطلب مسبقًا." }, { status: 409 });
  const password = generateTemporaryPassword();
  const created = await auth.admin.auth.admin.createUser({ email: application.data.email, password, email_confirm: true, user_metadata: { full_name: kind === "provider" ? application.data.contact_name : application.data.contractor_name, mobile: application.data.mobile, onboarding_role: kind, application_id: id } });
  if (created.error || !created.data.user) return NextResponse.json({ message: "تعذر إنشاء حساب الدخول؛ تحقق من عدم تعارض البريد." }, { status: 409 });
  const userId = created.data.user.id;
  const rpcName = kind === "provider" ? "finalize_provider_application_approval" : "finalize_contractor_application_approval";
  const finalized = await auth.admin.rpc(rpcName, { p_application_id: id, p_auth_user_id: userId, p_reviewer_id: auth.userId, p_reason: reason });
  if (finalized.error) { await auth.admin.auth.admin.deleteUser(userId); return NextResponse.json({ message: "تعذر إكمال تجهيز الحساب وتم التراجع عن إنشائه بأمان." }, { status: 500 }); }
  const delivery = await sendOnboardingCredentials({ kind: kind as "provider"|"contractor", email: application.data.email, mobile: application.data.mobile, password, idempotencyKey: `onboarding-approved-${id}` });
  await markDelivery(auth.admin, kind, id, delivery);
  return NextResponse.json({ status: "approved", delivery: deliveryStatus(delivery) });
}

async function recordReview(admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>, reviewerId: string, kind: string, id: string, outcome: string, reason: string) {
  const adminUser = await admin.from("admin_users").select("id").eq("profile_id", reviewerId).eq("is_active", true).single();
  if (adminUser.data) await admin.from("join_request_reviews").insert({ admin_user_id: adminUser.data.id, request_kind: kind, request_id: id, outcome, reason });
  await admin.from("audit_logs").insert({ actor_profile_id: reviewerId, entity_table: `${kind}_applications`, entity_id: id, action: `join_application_${outcome}`, new_data: { reason } });
}
async function markDelivery(admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>, kind: string, id: string, delivery: Awaited<ReturnType<typeof sendOnboardingCredentials>>) {
  await admin.rpc("mark_onboarding_credentials_delivery", { p_application_kind: kind, p_application_id: id, p_email_status: delivery.email.status, p_whatsapp_status: delivery.whatsapp.status, p_email_reference: delivery.email.providerMessageId, p_whatsapp_reference: delivery.whatsapp.providerMessageId, p_error: delivery.email.sanitizedError||delivery.whatsapp.sanitizedError });
}
function deliveryStatus(delivery: Awaited<ReturnType<typeof sendOnboardingCredentials>>) { const submitted=[delivery.email.status,delivery.whatsapp.status].filter((v)=>v==="submitted").length;return submitted===2?"credentials_submitted":submitted===1?"credentials_partially_submitted":"credentials_failed"; }
