import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendGreenApiMessage, maskWhatsAppDestination } from "./providers/green-api";
import { sendResendSensitiveCopy } from "./providers/resend";
import { maskEmail, recordProviderSubmission } from "./submissions";

type JoinDetail = { label: string; value: string };

type JoinNotificationInput = {
  kind: "provider" | "contractor";
  applicationId: string;
  applicantEmail: string;
  applicantName: string;
  submittedAt: string;
  details: JoinDetail[];
};

export async function notifyJoinReviewers(input: JoinNotificationInput) {
  if (process.env.NOTIFICATIONS_ENABLED !== "true") return;

  const admin = createAdminClient();
  const [users, superRole, permissionRoles] = await Promise.all([
    admin.from("admin_users").select("profile_id,role_id,profiles(mobile,email,full_name)").eq("is_active", true),
    admin.from("admin_roles").select("id").eq("role_key", "super_admin").maybeSingle(),
    admin.from("admin_role_permissions").select("role_id,admin_permissions!inner(permission_key)").eq("admin_permissions.permission_key", "reviews.manage"),
  ]);
  if (users.error) throw users.error;

  const roles = new Set<string>((permissionRoles.data ?? []).map((row) => row.role_id));
  if (superRole.data?.id) roles.add(superRole.data.id);

  const kindLabel = input.kind === "provider" ? "مزود" : "مقاول";
  const reviewPath = input.kind === "provider" ? "providers" : "contractors";
  const site = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://bunya-platform.vercel.app";
  const details = input.details.map(({ label, value }) => `${label}: ${value || "—"}`).join("\n");
  const adminMessage = `طلب انضمام ${kindLabel} جديد في بُنية\nرقم الطلب الفريد: ${input.applicationId}\nوقت التقديم: ${input.submittedAt}\n\nبيانات مقدم الطلب:\n${details}\n\nالمراجعة: ${site}/admin/join-requests/${reviewPath}`;

  for (const row of users.data ?? []) {
    if (!roles.has(row.role_id)) continue;
    const profile = row.profiles as unknown as { mobile: string | null; email: string | null; full_name: string | null } | null;

    await admin.from("notifications").upsert({
      profile_id: row.profile_id,
      type: "join_application_submitted",
      title: `طلب انضمام ${kindLabel} جديد`,
      message: `طلب جديد برقم ${input.applicationId}`,
      action_url: `/admin/join-requests/${reviewPath}`,
      entity_type: `${input.kind}_application`,
      entity_id: input.applicationId,
      event_key: `join-submitted-inapp-${input.applicationId}-${row.profile_id}`,
    }, { onConflict: "event_key", ignoreDuplicates: true });

    if (profile?.mobile) {
      const key = `join-submitted-whatsapp-${input.applicationId}-${row.profile_id}`;
      const result = await sendGreenApiMessage({ to: profile.mobile, text: adminMessage, idempotencyKey: key });
      await recordProviderSubmission({ eventType: "join.application_submitted", channel: "whatsapp", destinationMasked: maskWhatsAppDestination(profile.mobile), idempotencyKey: key, result }).catch(() => undefined);
    }

    if (profile?.email) {
      const key = `join-submitted-email-${input.applicationId}-${row.profile_id}`;
      const result = await sendResendSensitiveCopy({ to: profile.email, subject: `طلب انضمام ${kindLabel} جديد — ${input.applicationId}`, text: adminMessage, idempotencyKey: key });
      await recordProviderSubmission({ eventType: "join.application_submitted", channel: "email", destinationMasked: maskEmail(profile.email), idempotencyKey: key, result }).catch(() => undefined);
    }
  }

  const applicantKey = `join-received-email-${input.applicationId}`;
  const applicantResult = await sendResendSensitiveCopy({
    to: input.applicantEmail,
    subject: `تم استلام طلب انضمامك — ${input.applicationId}`,
    text: `مرحبًا ${input.applicantName}،\nتم استلام طلب انضمام ${kindLabel} في منصة بُنية.\nرقم الطلب الفريد: ${input.applicationId}\nالحالة: قيد المراجعة\nوقت التقديم: ${input.submittedAt}\nاحتفظ برقم الطلب للمتابعة.`,
    idempotencyKey: applicantKey,
  });
  await recordProviderSubmission({ eventType: "join.application_received", channel: "email", destinationMasked: maskEmail(input.applicantEmail), idempotencyKey: applicantKey, result: applicantResult }).catch(() => undefined);
}
