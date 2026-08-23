import { NextRequest, NextResponse } from "next/server";
import { generateTemporaryPassword, requireJoinReviewer } from "@/lib/join/admin";
import { sendJoinApplicantDecision } from "@/lib/notifications/send-join-applicant-decision";
import { sendOnboardingCredentials } from "@/lib/notifications/send-onboarding-credentials";
import { isValidJoinUsername, normalizeJoinUsername } from "@/lib/join/username";
import {createHash,randomBytes} from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string; id: string; action: string }> }) {
  const auth = await requireJoinReviewer(request);
  if ("error" in auth) return NextResponse.json({ message: "غير مصرح بهذا الإجراء." }, { status: auth.error === "unauthorized" ? 401 : 403 });
  const { kind, id, action } = await context.params;
  if (!['provider','contractor'].includes(kind) || !['approve','reject','needs-changes','resend-credentials','retry-provisioning'].includes(action)) return NextResponse.json({ message: "المسار غير صالح." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { reason?: string };
  const reason = body.reason?.trim() || "";
  const requiresReason = action === "reject" || action === "needs-changes";
  if (requiresReason && reason.length < 5) return NextResponse.json({ message: "سبب القرار مطلوب (خمسة أحرف على الأقل)." }, { status: 400 });
  const table = kind === "provider" ? "provider_applications" : "contractor_applications";
  const application = await auth.admin.from(table).select("*").eq("id", id).maybeSingle();
  if (application.error) {
    logDataError("application_lookup", application.error, kind, id);
    return NextResponse.json({ message: "تعذر قراءة طلب الانضمام من قاعدة البيانات." }, { status: 500 });
  }
  if (!application.data) return NextResponse.json({ message: "الطلب غير موجود." }, { status: 404 });

  const relations = await loadApplicationRelations(auth.admin, kind as "provider"|"contractor", id);
  if (relations.error) {
    logDataError("application_relations", relations.error, kind, id);
    return NextResponse.json({ message: "تعذر قراءة تفاصيل طلب الانضمام من قاعدة البيانات." }, { status: 500 });
  }
  const applicationWithRelations = { ...application.data, ...relations.data } as Record<string,unknown>;
  const applicantName = String(kind === "provider" ? application.data.contact_name : application.data.contractor_name);
  let details = applicationDetails(kind as "provider"|"contractor", applicationWithRelations);

  if (action === "reject" || action === "needs-changes") {
    if (application.data.status === "approved") return NextResponse.json({ message: "لا يمكن تغيير طلب معتمد بهذه العملية." }, { status: 409 });
    const status = action === "reject" ? "rejected" : "needs_changes";
    const updated = await auth.admin.from(table).update({ status, reviewed_by: auth.userId, reviewed_at: new Date().toISOString(), review_notes: reason }).eq("id", id).in("status", ["pending","needs_changes"]).select("id").maybeSingle();
    if (updated.error || !updated.data) return NextResponse.json({ message: "تعذر تسجيل القرار أو سبق تنفيذه." }, { status: 409 });
    await recordReview(auth.admin, auth.userId, kind, id, status, reason);
    const site=(process.env.APP_URL||process.env.NEXT_PUBLIC_SITE_URL||"https://buniahksa.com").replace(/\/$/,"");
    if(action==="reject"){
      await sendJoinApplicantDecision({kind:kind as "provider"|"contractor",action:"rejected",applicationId:id,applicantName,email:application.data.email,mobile:application.data.mobile,reason,idempotencyKey:`join-rejected-${kind}-${id}`});
    }
    if(action==="needs-changes"){
      await auth.admin.from("join_application_revision_tokens").update({used_at:new Date().toISOString()}).eq("application_kind",kind).eq("application_id",id).is("used_at",null);
      const token=randomBytes(32).toString("base64url"),hash=createHash("sha256").update(token).digest("hex");
      const created=await auth.admin.from("join_application_revision_tokens").insert({application_kind:kind,application_id:id,token_hash:hash,expires_at:new Date(Date.now()+48*3600000).toISOString(),created_by:auth.userId});
      if(created.error)return NextResponse.json({message:"تعذر إنشاء رابط التعديل."},{status:500});
      const key=`join-needs-changes-${kind}-${id}-${hash.slice(0,12)}`;
      await sendJoinApplicantDecision({kind:kind as "provider"|"contractor",action:"needs_changes",applicationId:id,applicantName,email:application.data.email,mobile:application.data.mobile,reason,revisionUrl:`${site}/join/revise/${token}`,idempotencyKey:key});
    }
    return NextResponse.json({ status });
  }

  if (action === "resend-credentials") {
    const onboarding = await auth.admin.from("account_onboarding_deliveries").select("auth_user_id").eq("application_kind", kind).eq("application_id", id).maybeSingle();
    if (!onboarding.data?.auth_user_id) return NextResponse.json({ message: "الحساب غير جاهز لإعادة الإرسال." }, { status: 409 });
    const password = generateTemporaryPassword();
    const changed = await auth.admin.auth.admin.updateUserById(onboarding.data.auth_user_id, { password });
    if (changed.error) return NextResponse.json({ message: "تعذر تحديث بيانات الدخول." }, { status: 500 });
    const delivery = await sendOnboardingCredentials({ kind: kind as "provider"|"contractor", applicationId:id, applicantName, details, email: application.data.email, mobile: application.data.mobile, password, idempotencyKey: `onboarding-resend-${id}-${crypto.randomUUID()}` });
    await markDelivery(auth.admin, kind, id, delivery);
    return NextResponse.json({ status: deliveryStatus(delivery) });
  }

  if (!['pending','needs_changes'].includes(application.data.status)) return NextResponse.json({ message: "الطلب غير قابل للموافقة أو سبق تنفيذه." }, { status: 409 });
  const existing = await auth.admin.from("account_onboarding_deliveries").select("auth_user_id,provisioning_status").eq("application_kind", kind).eq("application_id", id).maybeSingle();
  if (existing.data?.auth_user_id) return NextResponse.json({ message: "تم إنشاء الحساب لهذا الطلب مسبقًا." }, { status: 409 });

  if (kind === "provider") {
    const username = await resolveAvailableProviderUsername(
      auth.admin,
      String(application.data.requested_username ?? ""),
      id,
    );
    if (username.error) {
      logDataError("provider_username_lookup", username.error, kind, id);
      return NextResponse.json({ message: "تعذر التحقق من اسم المستخدم المطلوب." }, { status: 500 });
    }
    if (!username.value) {
      return NextResponse.json({ message: "اسم المستخدم المطلوب غير صالح أو مستخدم مسبقًا. اطلب تعديله ثم أعد الموافقة." }, { status: 409 });
    }
    if (username.value !== application.data.requested_username) {
      const updatedUsername = await auth.admin
        .from("provider_applications")
        .update({ requested_username: username.value })
        .eq("id", id)
        .in("status", ["pending", "needs_changes"])
        .select("id")
        .maybeSingle();
      if (updatedUsername.error || !updatedUsername.data) {
        if (updatedUsername.error) logDataError("provider_username_update", updatedUsername.error, kind, id);
        return NextResponse.json({ message: "تعذر تجهيز اسم المستخدم للحساب." }, { status: 500 });
      }
      applicationWithRelations.requested_username = username.value;
      details = applicationDetails("provider", applicationWithRelations);
    }
  }

  const password = generateTemporaryPassword();
  const created = await auth.admin.auth.admin.createUser({ email: application.data.email, password, email_confirm: true, user_metadata: { full_name: kind === "provider" ? application.data.contact_name : application.data.contractor_name, ...(kind === "contractor" ? { mobile: application.data.mobile } : {}), onboarding_role: kind, application_id: id } });
  if (created.error || !created.data.user) return NextResponse.json({ message: "تعذر إنشاء حساب الدخول؛ تحقق من عدم تعارض البريد." }, { status: 409 });
  const userId = created.data.user.id;
  const rpcName = kind === "provider" ? "finalize_provider_application_approval" : "finalize_contractor_application_approval";
  const finalized = await auth.admin.rpc(rpcName, { p_application_id: id, p_auth_user_id: userId, p_reviewer_id: auth.userId, p_reason: "تمت الموافقة على طلب الانضمام." });
  if (finalized.error) {
    logDataError("finalize_approval", finalized.error, kind, id);
    await auth.admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ message: "تعذر إكمال تجهيز الحساب وتم التراجع عن إنشائه بأمان." }, { status: 500 });
  }
  if (kind === "provider") {
    const cleared = await auth.admin.rpc("clear_unverified_provider_phone", { p_user_id: userId });
    if (cleared.error) {
      logDataError("clear_unverified_provider_phone", cleared.error, kind, id);
      return NextResponse.json({ message: "تم تجهيز الحساب، لكن تعذر إزالة رقم الطلب قبل التحقق. تواصل مع الدعم التشغيلي." }, { status: 500 });
    }
  }
  const delivery = await sendOnboardingCredentials({ kind: kind as "provider"|"contractor", applicationId:id, applicantName, details, email: application.data.email, mobile: application.data.mobile, password, idempotencyKey: `onboarding-approved-${id}` });
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

async function loadApplicationRelations(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  kind: "provider" | "contractor",
  applicationId: string,
) {
  if (kind === "provider") {
    const [categories, regions] = await Promise.all([
      admin
        .from("provider_application_categories")
        .select("custom_category,product_categories(name)")
        .eq("application_id", applicationId),
      admin.from("provider_delivery_regions").select("region_name").eq("application_id", applicationId),
    ]);
    const error = categories.error || regions.error;
    return {
      error,
      data: {
        provider_application_categories: categories.data ?? [],
        provider_delivery_regions: regions.data ?? [],
      },
    };
  }

  const [regions, specialties] = await Promise.all([
    admin.from("contractor_work_regions").select("region_name").eq("application_id", applicationId),
    admin.from("contractor_specialties").select("specialty_name").eq("application_id", applicationId),
  ]);
  const error = regions.error || specialties.error;
  return {
    error,
    data: {
      contractor_work_regions: regions.data ?? [],
      contractor_specialties: specialties.data ?? [],
    },
  };
}

function logDataError(stage: string, error: { code?: string } | null, kind: string, id: string) {
  console.error(`[join-requests] ${stage}`, { kind, id, code: error?.code ?? "unknown" });
}

async function resolveAvailableProviderUsername(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  requestedUsername: string,
  applicationId: string,
) {
  const normalized = normalizeJoinUsername(requestedUsername);
  if (!isValidJoinUsername(normalized)) return { value: null, error: null };

  const suffix = applicationId.replaceAll("-", "").slice(0, 6);
  const candidates = [normalized, `${normalized.slice(0, Math.max(4, 33))}_${suffix}`];
  for (const candidate of candidates) {
    const [profiles, providerProfiles, applications] = await Promise.all([
      admin.from("profiles").select("id").ilike("username", candidate).limit(1),
      admin.from("provider_profiles").select("provider_id").ilike("username", candidate).limit(1),
      admin
        .from("provider_applications")
        .select("id")
        .neq("id", applicationId)
        .in("status", ["pending", "needs_changes"])
        .ilike("requested_username", candidate)
        .limit(1),
    ]);
    const error = profiles.error || providerProfiles.error || applications.error;
    if (error) return { value: null, error };
    if (!profiles.data?.length && !providerProfiles.data?.length && !applications.data?.length) {
      return { value: candidate, error: null };
    }
  }
  return { value: null, error: null };
}

function applicationDetails(kind:"provider"|"contractor",application:Record<string,unknown>){
  if(kind==="provider"){
    const categories=((application.provider_application_categories as Record<string,unknown>[]|undefined)??[]).map(item=>{
      const category=item.product_categories as {name?:string}|null;
      return category?.name||String(item.custom_category||"");
    }).filter(Boolean);
    const regions=((application.provider_delivery_regions as {region_name:string}[]|undefined)??[]).map(item=>item.region_name);
    return[
      {label:"اسم الشركة",value:String(application.company_name||"—")},
      {label:"اسم المسؤول",value:String(application.contact_name||"—")},
      {label:"رقم الجوال",value:String(application.mobile||"—")},
      {label:"البريد الإلكتروني",value:String(application.email||"—")},
      {label:"اسم المستخدم",value:String(application.requested_username||"—")},
      {label:"كود الخصم",value:String(application.discount_code||"—")},
      {label:"رابط Google Maps",value:String(application.google_maps_url||"—")},
      {label:"الإحداثيات",value:application.latitude&&application.longitude?`${application.latitude}, ${application.longitude}`:"—"},
      {label:"التصنيفات",value:categories.join("، ")||"—"},
      {label:"هل يوجد توصيل؟",value:application.delivery_available?"نعم":"لا"},
      {label:"مناطق التوصيل",value:regions.join("، ")||"—"},
    ];
  }
  const regions=((application.contractor_work_regions as {region_name:string}[]|undefined)??[]).map(item=>item.region_name);
  const specialties=((application.contractor_specialties as {specialty_name:string}[]|undefined)??[]).map(item=>item.specialty_name);
  return[
    {label:"اسم المقاول",value:String(application.contractor_name||"—")},
    {label:"رقم الجوال",value:String(application.mobile||"—")},
    {label:"البريد الإلكتروني",value:String(application.email||"—")},
    {label:"مناطق العمل",value:regions.join("، ")||"—"},
    {label:"التخصصات",value:specialties.join("، ")||"—"},
  ];
}
