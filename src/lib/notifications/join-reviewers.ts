import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendGreenApiMessage, maskWhatsAppDestination, normalizeWhatsAppChatId, type ProviderSubmission } from "./providers/green-api";
import { sendResendSensitiveCopy } from "./providers/resend";
import { OFFICIAL_PLATFORM_URL } from "./site-url";
import { maskEmail, recordProviderSubmission } from "./submissions";

type JoinDetail = { label: string; value: string };

type JoinNotificationInput = {
  kind: "provider" | "contractor";
  applicationId: string;
  submissionKey?: string;
  applicantEmail: string;
  applicantName: string;
  submittedAt: string;
  details: JoinDetail[];
};

const providerReviewMobile = "0508424401";
type Reviewer = { profile_id: string; role_id: string; profiles: unknown };
type ReviewerProfile = { mobile: string | null; email: string | null; full_name: string | null; is_active?: boolean };

function normalizedMobile(value: string | null | undefined) {
  try { return value ? normalizeWhatsAppChatId(value) : null; } catch { return null; }
}

async function notifyProviderReviewers(admin: ReturnType<typeof createAdminClient>, input: JoinNotificationInput, reviewers: Reviewer[], adminMessage: string) {
  const notificationId = input.submissionKey ?? input.applicationId;
  const failures: string[] = [];
  const target = normalizeWhatsAppChatId(providerReviewMobile);
  const active = reviewers.filter(row => (row.profiles as ReviewerProfile | null)?.is_active === true);
  // Resolve the designated mobile only through the current active authorized reviewer list.
  active.sort((a, b) => Number(normalizedMobile((b.profiles as ReviewerProfile).mobile) === target) - Number(normalizedMobile((a.profiles as ReviewerProfile).mobile) === target) || a.profile_id.localeCompare(b.profile_id));
  if (!active.some(row => normalizedMobile((row.profiles as ReviewerProfile).mobile) === target)) failures.push("designated_reviewer_unavailable");
  const mobiles = new Set<string>();
  const emails = new Set<string>();

  const submit = async (channel: "whatsapp" | "email", destination: string, key: string, send: () => Promise<ProviderSubmission>, eventType = "join.application_submitted") => {
    try {
      const previous = await admin.from("notification_provider_submissions").select("status").eq("idempotency_key", key).maybeSingle();
      if (previous.error) throw new Error("submission_lookup_failed");
      if (previous.data?.status === "submitted") return;
      let result: ProviderSubmission;
      try { result = await send(); } catch {
        result = { status: "failed", providerMessageId: null, sanitizedError: "provider_send_exception", submittedAt: null };
      }
      await recordProviderSubmission({ eventType, channel, destinationMasked: channel === "whatsapp" ? maskWhatsAppDestination(destination) : maskEmail(destination), idempotencyKey: key, result });
      if (result.status !== "submitted") failures.push(`${channel}_${result.status}`);
    } catch {
      failures.push(`${channel}_submission_tracking_failed`);
    }
  };

  for (const row of active) {
    const profile = row.profiles as ReviewerProfile;
    // Each channel is independent: an in-app/email failure must not suppress WhatsApp.
    try {
      const notification = await admin.from("notifications").upsert({
        profile_id: row.profile_id, type: "join_application_submitted", title: "طلب انضمام مزود جديد",
        message: `طلب جديد برقم ${input.applicationId}`, action_url: "/admin/join-requests/providers",
        entity_type: "provider_application", entity_id: input.applicationId,
        event_key: `join-submitted-inapp-${notificationId}-${row.profile_id}`,
      }, { onConflict: "event_key", ignoreDuplicates: true });
      if (notification.error) failures.push("inapp_write_failed");
    } catch { failures.push("inapp_write_failed"); }
    const mobile = normalizedMobile(profile.mobile);
    if (profile.mobile && !mobile) failures.push("reviewer_mobile_invalid");
    if (profile.mobile && mobile && !mobiles.has(mobile)) {
      mobiles.add(mobile);
      const key = `join-submitted-whatsapp-${notificationId}-${row.profile_id}`;
      await submit("whatsapp", profile.mobile, key, () => sendGreenApiMessage({ to: profile.mobile!, text: adminMessage, idempotencyKey: key }));
    }
    const email = profile.email?.trim().toLowerCase();
    if (email && !emails.has(email)) {
      emails.add(email);
      const key = `join-submitted-email-${notificationId}-${row.profile_id}`;
      await submit("email", email, key, () => sendResendSensitiveCopy({ to: email, subject: `طلب انضمام مزود جديد — ${input.applicationId}`, text: adminMessage, idempotencyKey: key }));
    }
  }
  const applicantKey = `join-received-email-${notificationId}`;
  await submit("email", input.applicantEmail, applicantKey, () => sendResendSensitiveCopy({
    to: input.applicantEmail, subject: `تم استلام طلب انضمامك — ${input.applicationId}`,
    text: `مرحبًا ${input.applicantName}،\nتم استلام طلب انضمام مزود في منصة بُنية.\nرقم الطلب الفريد: ${input.applicationId}\nالحالة: قيد المراجعة\nوقت التقديم: ${input.submittedAt}\nاحتفظ برقم الطلب للمتابعة.`,
    idempotencyKey: applicantKey,
  }), "join.application_received");
  if (failures.length) throw new Error(`provider_join_notification_failures: ${[...new Set(failures)].join(",")}`);
}

export async function notifyJoinReviewers(input: JoinNotificationInput) {
  if (process.env.NOTIFICATIONS_ENABLED !== "true") return;

  const admin = createAdminClient();
  const [users, superRole, permissionRoles] = await Promise.all([
    admin.from("admin_users").select("profile_id,role_id,profiles(mobile,email,full_name,is_active)").eq("is_active", true),
    admin.from("admin_roles").select("id").eq("role_key", "super_admin").maybeSingle(),
    admin.from("admin_role_permissions").select("role_id,admin_permissions!inner(permission_key)").eq("admin_permissions.permission_key", "reviews.manage"),
  ]);
  if (users.error) throw users.error;
  if (superRole.error || permissionRoles.error) throw new Error("reviewer_permissions_lookup_failed");

  const roles = new Set<string>((permissionRoles.data ?? []).map((row) => row.role_id));
  if (superRole.data?.id) roles.add(superRole.data.id);

  const kindLabel = input.kind === "provider" ? "مزود" : "مقاول";
  const reviewPath = input.kind === "provider" ? "providers" : "contractors";
  const site = OFFICIAL_PLATFORM_URL;
  const details = input.details.map(({ label, value }) => `${label}: ${value || "—"}`).join("\n");
  const adminMessage = `طلب انضمام ${kindLabel} جديد في بُنية\nرقم الطلب الفريد: ${input.applicationId}\nوقت التقديم: ${input.submittedAt}\n\nبيانات مقدم الطلب:\n${details}\n\nالمراجعة: ${site}/admin/join-requests/${reviewPath}`;

  if (input.kind === "provider") {
    await notifyProviderReviewers(admin, input, (users.data ?? []).filter(row => roles.has(row.role_id)), adminMessage);
    return;
  }

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
