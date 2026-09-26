/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Supabase relation payloads are dynamically shaped by event type.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendGreenApiMessage,
  maskWhatsAppDestination,
} from "./providers/green-api";
import { sendResendSensitiveCopy } from "./providers/resend";
import { maskEmail, recordProviderSubmission } from "./submissions";
import { sendNativePush } from "./native-push";
import { OFFICIAL_PLATFORM_URL } from "./site-url";

const EVENT_TYPES = [
  "ticket.created",
  "ticket.assigned",
  "ticket.replied",
  "ticket.resolved",
  "ticket.reopened",
  "ticket.escalated",
  "settlement.requested",
  "settlement.under_review",
  "settlement.approved",
  "settlement.rejected",
  "settlement.processing",
  "settlement.paid",
  "settlement.failed",
  "settlement.cancelled",
  "contractor.opportunity_new",
  "contractor.proposal_submitted",
  "contractor.proposal_accepted",
  "contractor.proposal_rejected",
  "contractor.proposal_needs_changes",
  "customer.milestone_approval_requested",
  "contractor.milestone_approved",
  "contractor.milestone_rejected",
  "contractor.milestone_started",
  "contractor.document_expiring",
  "contractor.document_expired",
  "admin.project_no_contractors",
  "admin.green_api_repeated_failure",
  "admin.resend_repeated_failure",
  "admin.contractor_service_submitted",
  "admin.contractor_portfolio_submitted",
  "contractor.service_approved",
  "contractor.service_rejected",
  "contractor.service_needs_changes",
  "contractor.portfolio_approved",
  "contractor.portfolio_rejected",
  "contractor.portfolio_needs_changes",
  "order_created",
  "delivery_confirmed",
  "provider.rfq_new",
  "provider.rfq_reminder",
  "provider.rfq_outbid",
  "provider.rfq_expired",
  "provider.rfq_responded",
  "provider.product_approved",
  "provider.product_rejected",
  "provider.product_needs_changes",
  "admin.product_change_requested",
  "provider.product_change_approved",
  "provider.product_change_rejected",
  "customer.quote_ready",
  "customer.quote_expiring",
  "customer.quote_expired",
  "customer.payment_succeeded",
  "customer.payment_failed",
  "customer.payment_refunded",
  "provider.fulfillment_assigned",
  "customer.fulfillment_preparing",
  "customer.fulfillment_ready",
  "customer.delivery_assigned",
  "customer.delivery_out_for_delivery",
  "customer.driver_arrived",
  "customer.delivery_failed",
  "admin.rfq_no_providers",
  "admin.quote_assembly_failed",
  "admin.outbox_dead_letter",
  "admin.delivery_code_delivery_failed",
  "admin.delivery_attempts_exceeded",
];
type Outbox = {
  id: string;
  aggregate_id: string;
  event_type: string;
  attempts: number;
  payload: Record<string, unknown>;
};
type Recipient = {
  profileId?: string;
  customerProfileId?: string;
  contractorProfileId?: string;
  mobile?: string | null;
  email?: string | null;
  emailSubject?: string;
  title?: string;
  actionUrl?: string;
  entityType?: string;
  text: string;
};

export async function dispatchNotificationBatch(limit = 10) {
  const admin = createAdminClient();
  await admin.rpc("schedule_commerce_notifications");
  const claimed = await admin.rpc("claim_notification_outbox", {
    p_limit: limit,
    p_event_types: EVENT_TYPES,
  });
  if (claimed.error) throw new Error("outbox_claim_failed");
  const result = await dispatchClaimedEvents(admin, claimed.data as Outbox[]);
  return { claimed: (claimed.data || []).length, ...result };
}

export async function dispatchNotificationEvent(eventId: string) {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_notification_outbox_event", {
    p_id: eventId,
    p_event_types: EVENT_TYPES,
  });
  if (claimed.error) throw new Error("outbox_event_claim_failed");
  const events = claimed.data as Outbox[];
  const result = await dispatchClaimedEvents(admin, events);
  return { claimed: events.length, ...result };
}

async function dispatchClaimedEvents(
  admin: ReturnType<typeof createAdminClient>,
  events: Outbox[],
) {
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const recipients = await resolveEvent(admin, event);
      if (!recipients.length) throw new Error("recipient_not_ready");
      let success = true;
      for (const recipient of recipients) {
        const destination =
            recipient.profileId ??
            (recipient.mobile
              ? maskWhatsAppDestination(recipient.mobile)
              : recipient.email
                ? maskEmail(recipient.email)
                : "unknown"),
          key = `outbox-${event.id}-${destination}`,
          actionUrl =
            recipient.actionUrl ??
            eventActionUrl(event.event_type, event.aggregate_id),
          title =
            recipient.title ??
            (event.event_type === "ticket.created"
              ? "تذكرة دعم جديدة"
              : event.event_type === "delivery_confirmed"
                ? "تم تسليم الطلب بنجاح"
                : "إشعار جديد من بُنية");
        if (recipient.profileId) {
          if (recipient.customerProfileId) {
            const persisted = await admin.from("customer_notifications").upsert(
              {
                customer_profile_id: recipient.customerProfileId,
                notification_type: event.event_type,
                title,
                message: recipient.text,
                action_url: actionUrl,
                event_key: key,
              },
              { onConflict: "event_key" },
            );
            if (persisted.error) throw new Error("customer_notification_persist_failed");
          } else {
            const persisted = await admin.from("notifications").upsert(
              {
                profile_id: recipient.profileId,
                type: event.event_type,
                title,
                message: recipient.text,
                entity_type: recipient.entityType ?? event.event_type,
                entity_id: event.aggregate_id,
                event_key: key,
                action_url: actionUrl,
              },
              { onConflict: "event_key" },
            );
            if (persisted.error) throw new Error("notification_persist_failed");
          }
          if (recipient.contractorProfileId) {
            const persisted = await admin.from("contractor_notifications").upsert(
              {
                contractor_profile_id: recipient.contractorProfileId,
                notification_type: contractorNotificationType(event.event_type),
                title,
                message: recipient.text,
                link: actionUrl,
                event_key: key,
              },
              { onConflict: "event_key" },
            );
            if (persisted.error) throw new Error("contractor_notification_persist_failed");
          }
          await sendNativePush(recipient.profileId, {
            title,
            body: recipient.text.slice(0, 180),
            url: actionUrl,
          }).catch(() => undefined);
        }
        if (recipient.mobile) {
          const result = await sendGreenApiMessage({
            to: recipient.mobile,
            text: recipient.text,
            idempotencyKey: `${key}-whatsapp`,
          });
          await recordProviderSubmission({
            eventType: event.event_type,
            channel: "whatsapp",
            destinationMasked: maskWhatsAppDestination(recipient.mobile),
            idempotencyKey: `${key}-whatsapp`,
            result,
          });
          success = success && result.status === "submitted";
        }
        if (recipient.email && recipient.emailSubject) {
          const result = await sendResendSensitiveCopy({
            to: recipient.email,
            subject: recipient.emailSubject,
            text: recipient.text,
            idempotencyKey: `${key}-email`,
          });
          await recordProviderSubmission({
            eventType: event.event_type,
            channel: "email",
            destinationMasked: maskEmail(recipient.email),
            idempotencyKey: `${key}-email`,
            result,
          });
          success = success && result.status === "submitted";
        }
      }
      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: success,
        p_error: success ? null : "provider_submission_failed",
      });
      if (success) processed++;
      else failed++;
    } catch (error) {
      console.error("notification_dispatch_event_failed", {
        eventId: event.id,
        eventType: event.event_type,
        code: error instanceof Error ? error.message : "unknown",
      });
      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: false,
        p_error: "notification_dispatch_failed",
      });
      failed++;
    }
  }
  return { processed, failed };
}

function eventActionUrl(type: string, id: string) {
  if (type === "ticket.created") return "/admin/support";
  if (type.startsWith("ticket.")) return "/support";
  if (type === "provider.rfq_responded") return "/admin/sourcing";
  if (type.startsWith("provider.product_")) return "/merchant/products";
  if (type === "admin.product_change_requested")
    return `/admin/products/changes/${id}`;
  if (type.startsWith("settlement.")) return "/contractor/finance";
  if (type.startsWith("admin.")) return "/admin/operations";
  if (type.includes("service_")) return "/contractor/services";
  if (type.includes("portfolio_")) return "/contractor/portfolio";
  if (type.includes("proposal_")) return "/contractor/proposals";
  if (type.includes("milestone_")) return "/contractor/projects";
  if (type.includes("document_")) return "/contractor/verification";
  return `/notifications?entity=${encodeURIComponent(id)}`;
}

function contractorNotificationType(type: string) {
  if (type.includes("opportunity_")) return "opportunity";
  if (type.includes("proposal_")) return "proposal";
  if (type.includes("milestone_")) return "milestone";
  if (type.includes("document_")) return "document";
  if (type.startsWith("settlement.")) return "payment";
  return "admin";
}

function notificationValue(value: unknown, fallback = "غير محدد") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function notificationDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(date);
}

async function resolveEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: Outbox,
): Promise<Recipient[]> {
  const site = OFFICIAL_PLATFORM_URL;
  if (event.event_type === "admin.product_change_requested") {
    const request = await admin
      .from("product_change_requests")
      .select("id,product_id,changes,products(name),providers(company_name)")
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (!request.data) return [];
    const admins = await admin
      .from("admin_users")
      .select("profile_id,profiles(mobile,email)")
      .eq("is_active", true);
    const product = request.data.products as unknown as { name?: string } | null;
    const provider = request.data.providers as unknown as {
      company_name?: string;
    } | null;
    const changeCount = Array.isArray(request.data.changes)
      ? request.data.changes.length
      : Number(event.payload?.change_count || 0);
    const actionUrl = `/admin/products/changes/${event.aggregate_id}`;
    const message = `طلب تعديل بيانات منتج جديد\nالمنشأة: ${provider?.company_name || event.payload?.provider_name || "مزود"}\nالمنتج: ${product?.name || event.payload?.product_name || "المنتج"}\nمجموعات البيانات المتغيرة: ${changeCount}\nراجع المقارنة الكاملة قبل الاعتماد أو الرفض: ${site}${actionUrl}`;
    return (admins.data ?? []).map((row) => {
      const profile = row.profiles as unknown as {
        mobile: string | null;
        email: string | null;
      } | null;
      return {
        profileId: row.profile_id,
        mobile: profile?.mobile,
        email: profile?.email,
        emailSubject: `طلب تعديل المنتج ${product?.name || ""}`.trim(),
        title: "طلب تعديل بيانات منتج",
        actionUrl,
        entityType: "product_change_request",
        text: message,
      };
    });
  }
  if (event.event_type.startsWith("provider.product_change_")) {
    const providerId = String(event.payload?.provider_id || "");
    const provider = await admin
      .from("providers")
      .select("owner_profile_id,mobile,company_name")
      .eq("id", providerId)
      .maybeSingle();
    if (!provider.data) return [];
    const approved = event.event_type.endsWith("approved");
    const productName = String(event.payload?.product_name || "المنتج");
    const reason = String(event.payload?.reason || "—");
    return [
      {
        profileId: provider.data.owner_profile_id,
        mobile: provider.data.mobile,
        title: approved
          ? "تم اعتماد تعديلات المنتج"
          : "تم رفض تعديلات المنتج",
        actionUrl: "/merchant/products",
        entityType: "product",
        text: `مرحبًا ${provider.data.company_name}، ${approved ? "تم اعتماد وتطبيق" : "تم رفض"} طلب تعديل المنتج «${productName}».\nملاحظة الإدارة: ${reason}\nإدارة المنتجات: ${site}/merchant/products`,
      },
    ];
  }
  if (event.event_type.startsWith("provider.product_")) {
    const providerId = String(event.payload?.provider_id || "");
    const provider = await admin
      .from("providers")
      .select("owner_profile_id,mobile,company_name")
      .eq("id", providerId)
      .maybeSingle();
    if (!provider.data) return [];
    const productName = String(event.payload?.product_name || "المنتج");
    const reason = String(event.payload?.reason || "—");
    const decision = event.event_type.endsWith("approved")
      ? "تم اعتماد المنتج ونشره في المنصة"
      : event.event_type.endsWith("rejected")
        ? "تم رفض المنتج"
        : "يحتاج المنتج إلى تعديلات قبل اعتماده";
    const title = event.event_type.endsWith("approved")
      ? "تم اعتماد منتجك"
      : event.event_type.endsWith("rejected")
        ? "تم رفض المنتج"
        : "المنتج يحتاج تعديلات";
    return [
      {
        profileId: provider.data.owner_profile_id,
        mobile: provider.data.mobile,
        title,
        actionUrl: "/merchant/products",
        entityType: "product",
        text: `مرحبًا ${provider.data.company_name}، ${decision}.\nالمنتج: ${productName}\nملاحظات المراجعة: ${reason}\nإدارة المنتجات: ${site}/merchant/products`,
      },
    ];
  }
  if (
    event.event_type === "order_created" ||
    event.event_type === "delivery_confirmed"
  ) {
    const orderId =
      event.event_type === "order_created"
        ? event.aggregate_id
        : String(event.payload?.order_id || "");
    const order = await admin
      .from("orders")
      .select(
        "order_code,customer_profile_id,customer_quote_id,subtotal,vat_amount,delivery_fee,total,payment_status,profiles!orders_customer_profile_id_fkey(mobile,email)",
      )
      .eq("id", orderId)
      .maybeSingle();
    const customerProfile = order.data?.profiles as unknown as {
      mobile: string | null;
      email: string | null;
    } | null;
    const mobile = customerProfile?.mobile;
    if (!order.data) return [];
    const providerOnly = event.payload?.provider_only === true;
    const adminOnly = event.payload?.admin_only === true;
    const recipients: Recipient[] = providerOnly || adminOnly
      ? []
      : [
          {
            profileId: order.data.customer_profile_id,
            customerProfileId: order.data.customer_profile_id,
            mobile,
            email: customerProfile?.email,
            emailSubject:
              event.event_type === "delivery_confirmed"
                ? `تم تسليم الطلب ${order.data.order_code} بنجاح`
                : `تم إنشاء الطلب ${order.data.order_code}`,
            actionUrl: `/customer/orders/${orderId}`,
            text:
              event.event_type === "order_created"
                ? `تم إنشاء طلبك في بُنية برقم ${order.data.order_code}.\nتابع الحالة: ${site}/customer/orders/${orderId}`
                : `تم تأكيد استلام شحنتك للطلب ${order.data.order_code} وإغلاقه بنجاح.\n\nشكرًا لثقتك بمنصة بُنية، ويسعدنا خدمتك في طلبات مواد البناء القادمة.\nتفاصيل الطلب: ${site}/customer/orders/${orderId}\nابدأ طلبًا جديدًا متى احتجت: ${site}/customer/quote-request/new`,
          },
        ];
    if (event.event_type === "order_created") {
      const [fulfillmentResult, invoiceResult, adminUsersResult] =
        await Promise.all([
          admin
            .from("internal_fulfillment_orders")
            .select(
              "id,fulfillment_code,assigned_value,providers(owner_profile_id,mobile,company_name)",
            )
            .eq("bunya_customer_quote_id", order.data.customer_quote_id),
          admin
            .from("invoices")
            .select("id")
            .eq("order_id", orderId)
            .maybeSingle(),
          admin
            .from("admin_users")
            .select("profile_id,profiles(mobile)")
            .eq("is_active", true),
        ]);
      const paidPayments = invoiceResult.data?.id
        ? await admin
            .from("payment_records")
            .select("amount")
            .eq("invoice_id", invoiceResult.data.id)
            .eq("status", "succeeded")
        : { data: [] };
      const paidAmount = (paidPayments.data ?? []).reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0,
      );
      const quoteTotal = Number(order.data.total || 0);
      const remainingAmount = Math.max(0, quoteTotal - paidAmount);
      const providerSummaries = (fulfillmentResult.data ?? []).map(
        (fulfillment) => {
          const provider = fulfillment.providers as unknown as {
            owner_profile_id: string;
            mobile: string | null;
            company_name: string;
          } | null;
          return `${provider?.company_name || "مزود غير محدد"} — قيمة الترسية ${Number(fulfillment.assigned_value || 0).toFixed(2)} ر.س`;
        },
      );
      if (!providerOnly) {
        const adminMessage = `اعتمد العميل عرض السعر للطلب ${order.data.order_code}.\nقيمة عرض السعر المعتمد: ${quoteTotal.toFixed(2)} ر.س\nالمدفوع فعليًا: ${paidAmount.toFixed(2)} ر.س\nالمتبقي: ${remainingAmount.toFixed(2)} ر.س\nالمزود الفائز:\n${providerSummaries.length ? providerSummaries.map((line) => `- ${line}`).join("\n") : "- لم يحدد بعد"}\nحالة الدفع: ${order.data.payment_status === "paid" ? "مدفوع" : "بانتظار تأكيد Paymob"}.\nراجع الطلب: ${site}/admin/orders`;
        for (const adminUser of adminUsersResult.data ?? []) {
          const adminProfile = adminUser.profiles as unknown as {
            mobile: string | null;
          } | null;
          recipients.push({
            profileId: adminUser.profile_id,
            mobile: adminProfile?.mobile,
            title: "اعتماد عرض سعر جديد",
            actionUrl: "/admin/orders",
            entityType: "admin_order_accepted",
            text: adminMessage,
          });
        }
      }
      if (adminOnly) return recipients;
      for (const fulfillment of fulfillmentResult.data ?? []) {
        const provider = fulfillment.providers as unknown as {
          owner_profile_id: string;
          mobile: string | null;
          company_name: string;
        } | null;
        if (!provider?.owner_profile_id) continue;
        const providerOrderUrl = `/merchant/orders/${fulfillment.id}`;
        recipients.push({
          profileId: provider.owner_profile_id,
          mobile: provider.mobile,
          title: "طلب عميل معتمد",
          actionUrl: providerOrderUrl,
          entityType: "provider_order_accepted",
          text: `مرحبًا ${provider.company_name}، اعتمد العميل طلب بُنية رقم ${order.data.order_code}.\nحالة الدفع الآن: ${order.data.payment_status === "paid" ? "تم تأكيد الدفع" : "بانتظار تأكيد Paymob"}.\nسيصلك إشعار مستقل فور تأكيد الدفع وفتح التجهيز.\nراجع الطلب: ${site}${providerOrderUrl}`,
        });
      }
    }
    if (event.event_type === "delivery_confirmed") {
      const assignment = await admin
        .from("provider_delivery_assignments")
        .select("provider_id,assigned_driver_id,fulfillment_order_id")
        .eq("id", event.aggregate_id)
        .maybeSingle();
      if (assignment.data?.provider_id) {
        const provider = await admin
          .from("providers")
          .select("owner_profile_id,mobile,email,company_name")
          .eq("id", assignment.data.provider_id)
          .maybeSingle();
        if (provider.data) {
          const providerOrderUrl = assignment.data.fulfillment_order_id
            ? `/merchant/orders/${assignment.data.fulfillment_order_id}`
            : "/merchant/orders";
          recipients.push({
            profileId: provider.data.owner_profile_id,
            mobile: provider.data.mobile,
            email: provider.data.email,
            emailSubject: `تم تسليم الطلب ${order.data.order_code} بنجاح`,
            actionUrl: providerOrderUrl,
            text: `تم تأكيد استلام العميل للشحنة وإغلاق طلب بُنية رقم ${order.data.order_code} بنجاح.\nشكرًا لشراكتكم مع بُنية. يمكنكم مراجعة الطلب من لوحة المزود: ${site}${providerOrderUrl}`,
          });
        }
      }
      if (assignment.data?.assigned_driver_id) {
        const driver = await admin
          .from("provider_drivers")
          .select("full_name,mobile,provider_driver_accounts(auth_user_id)")
          .eq("id", assignment.data.assigned_driver_id)
          .maybeSingle();
        const account = driver.data?.provider_driver_accounts as unknown as
          | { auth_user_id?: string | null }
          | { auth_user_id?: string | null }[]
          | null;
        const profileId = Array.isArray(account)
          ? account[0]?.auth_user_id
          : account?.auth_user_id;
        if (driver.data)
          recipients.push({
            profileId: profileId || undefined,
            mobile: driver.data.mobile,
            text: `شكرًا ${driver.data.full_name}. تم إثبات تسليم الطلب ${order.data.order_code} وإغلاق المهمة بنجاح.`,
          });
      }
    }
    return recipients;
  }
  if (event.event_type === "provider.rfq_responded") {
    const response = await admin
      .from("provider_pricing_responses")
      .select(
        "response_code,sourcing_request_item_id,provider_id,unit_price,vat_inclusive,price_expires_at",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (!response.data) return [];
    const [provider, item, delivery, users] = await Promise.all([
      admin
        .from("providers")
        .select("company_name")
        .eq("id", response.data.provider_id)
        .maybeSingle(),
      admin
        .from("internal_sourcing_request_items")
        .select(
          "quantity,unit_snapshot,sourcing_request_id,quote_request_items(product_name_snapshot),internal_sourcing_requests(internal_code,response_deadline_at)",
        )
        .eq("id", response.data.sourcing_request_item_id)
        .maybeSingle(),
      admin
        .from("provider_delivery_confirmations")
        .select("delivery_fee")
        .eq("pricing_response_id", event.aggregate_id)
        .maybeSingle(),
      admin
        .from("admin_users")
        .select("profile_id,profiles(mobile)")
        .eq("is_active", true),
    ]);
    if (!item.data) return [];
    const product = item.data.quote_request_items as unknown as {
      product_name_snapshot: string;
    } | null;
    const source = item.data.internal_sourcing_requests as unknown as {
      internal_code: string;
      response_deadline_at: string;
    } | null;
    const landed =
      Number(item.data.quantity) *
        Number(response.data.unit_price) *
        (response.data.vat_inclusive ? 1 : 1.15) +
      Number(delivery.data?.delivery_fee || 0);
    const message = `وصل رد تسعير جديد من ${provider.data?.company_name || "مزود"}.\nالطلب: ${source?.internal_code || "—"}\nالمنتج: ${product?.product_name_snapshot || "—"}\nالكمية: ${item.data.quantity} ${item.data.unit_snapshot}\nسعر الوحدة: ${response.data.unit_price} ر.س\nالتكلفة الواصلة: ${landed.toFixed(2)} ر.س\nانتهاء مهلة الردود: ${source?.response_deadline_at ? new Date(source.response_deadline_at).toLocaleString("ar-SA") : "—"}\nمراجعة وتجميع العرض: ${site}/admin/sourcing/${item.data.sourcing_request_id}`;
    return (users.data ?? []).map((row) => ({
      profileId: row.profile_id,
      mobile: (row.profiles as unknown as { mobile: string | null } | null)
        ?.mobile,
      text: message,
    }));
  }
  if (event.event_type.startsWith("provider.rfq_")) {
    const providerId = String(event.payload?.provider_id || "");
    const [provider, item] = await Promise.all([
      admin
        .from("providers")
        .select("owner_profile_id,mobile")
        .eq("id", providerId)
        .maybeSingle(),
      admin
        .from("internal_sourcing_request_items")
        .select(
          "id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at,internal_sourcing_requests(internal_code,response_deadline_at,quote_requests(location_hint,google_maps_url,delivery_mode,recipient_name,recipient_mobile,site_responsible_name,site_responsible_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions,pricing_opens_at,pricing_countdown_starts_at)),quote_request_items(product_name_snapshot,notes,variant_label_snapshot,product_specifications_snapshot)",
        )
        .eq("id", event.aggregate_id)
        .maybeSingle(),
    ]);
    if (!provider.data?.owner_profile_id || !item.data) return [];
    const source = item.data.internal_sourcing_requests as unknown as {
      internal_code: string;
      response_deadline_at: string;
      quote_requests: {
        location_hint: string;
        google_maps_url: string | null;
        delivery_mode: string;
        recipient_name: string | null;
        recipient_mobile: string | null;
        site_responsible_name: string | null;
        site_responsible_mobile: string | null;
        working_hours: string | null;
        loading_option: string | null;
        unloading_option: string | null;
        road_access: string | null;
        access_instructions: string | null;
        pricing_opens_at: string;
        pricing_countdown_starts_at: string;
      } | null;
    };
    const product = item.data.quote_request_items as unknown as {
      product_name_snapshot: string;
      notes: string | null;
      variant_label_snapshot: string | null;
      product_specifications_snapshot: string[];
    };
    const request = source.quote_requests;
    const prefix =
      event.event_type === "provider.rfq_new"
        ? "طلب تسعير جديد"
        : event.event_type === "provider.rfq_outbid"
          ? "وصل سعر أقل — يمكنك تخفيض عرضك"
          : event.event_type === "provider.rfq_reminder"
            ? "تذكير: مهلة التسعير قاربت على الانتهاء"
            : "انتهت مهلة طلب التسعير";
    return [
      {
        profileId: provider.data.owner_profile_id,
        mobile: provider.data.mobile,
        actionUrl: `/merchant/quote-requests/${item.data.id}`,
        text: `${prefix}\nالطلب: ${source.internal_code}\nالمنتج: ${product.product_name_snapshot}\n${event.event_type === "provider.rfq_outbid" ? `أقل تكلفة منافسة الآن: ${event.payload?.competitor_landed_cost || "—"} ر.س. عرضك السابق محفوظ ومقفل؛ افتح الطلب إذا رغبت في تخفيضه قبل نهاية المهلة.\n` : ""}هذا الطلب خاص بهذا المنتج فقط؛ سعّره حتى لو لم توفر بقية منتجات العميل.\nالكمية: ${item.data.quantity} ${item.data.unit_snapshot}\nالقياس: ${item.data.measurement_snapshot || "—"}\nالخيارات المحددة: ${product.variant_label_snapshot || "—"}\nالمواصفات: ${product.product_specifications_snapshot?.join(" · ") || "—"}\nملاحظات العميل: ${product.notes || "—"}\nوصف موقع التسليم: ${request?.location_hint || "—"}\nالمستلم: ${request?.recipient_name || "—"} · ${request?.recipient_mobile || "—"}\nمسؤول الموقع: ${request?.site_responsible_name || "—"} · ${request?.site_responsible_mobile || "—"}\nمواعيد العمل: ${request?.working_hours || "—"}\nالتحميل: ${request?.loading_option || "—"}\nالتنزيل: ${request?.unloading_option || "—"}\nسهولة الوصول: ${request?.road_access || "—"}\nتعليمات الوصول: ${request?.access_instructions || "—"}\nطريقة الاستلام: ${request?.delivery_mode === "pickup" ? "استلام" : "توصيل"}\nGoogle Maps: ${request?.google_maps_url || "غير مرفق"}\nتنبيه مهم: افتح رابط Google Maps وراجع موقع التسليم ومسار الوصول بعناية قبل اعتماد السعر والتوفر.\nفتح التسعير: ${request?.pricing_opens_at ? new Date(request.pricing_opens_at).toLocaleString("ar-SA") : "—"}\nبدء عداد 3 ساعات: ${request?.pricing_countdown_starts_at ? new Date(request.pricing_countdown_starts_at).toLocaleString("ar-SA") : "—"}\nآخر رد: ${new Date(source.response_deadline_at).toLocaleString("ar-SA")}\nالموعد المطلوب: ${new Date(item.data.required_at).toLocaleString("ar-SA")}\nيتم اعتماد أقل تكلفة مؤهلة شاملة المنتج والضريبة والتوصيل.\n${site}/merchant/quote-requests/${item.data.id}`,
      },
    ];
  }
  if (event.event_type.startsWith("customer.quote_")) {
    const quote = await admin
      .from("bunya_customer_quotes")
      .select(
        "quote_code,subtotal,vat_amount,delivery_fee,total,valid_until,expected_delivery_at,customer_request_id,bunya_customer_quote_items(product_name_snapshot,quantity,unit_snapshot,measurement_snapshot,unit_price,line_total),quote_requests(requester_id,request_code,location_hint,google_maps_url,recipient_name,recipient_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions,profiles!quote_requests_requester_id_fkey(mobile))",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    const request = quote.data?.quote_requests as unknown as {
      requester_id: string;
      request_code: string;
      location_hint: string;
      google_maps_url: string | null;
      recipient_name: string | null;
      recipient_mobile: string | null;
      working_hours: string | null;
      loading_option: string | null;
      unloading_option: string | null;
      road_access: string | null;
      access_instructions: string | null;
      profiles: { mobile: string | null };
    } | null;
    const mobile = request?.profiles?.mobile;
    if (!quote.data || !request || !mobile) return [];
    const quoteItems = (quote.data.bunya_customer_quote_items || []) as Array<{
      product_name_snapshot: string;
      quantity: number;
      unit_snapshot: string;
      measurement_snapshot: string | null;
      unit_price: number;
      line_total: number;
    }>;
    const itemLines = quoteItems
      .map(
        (item) =>
          `- ${item.product_name_snapshot}: ${item.quantity} ${item.unit_snapshot}${item.measurement_snapshot ? ` (${item.measurement_snapshot})` : ""} × ${item.unit_price} ر.س = ${item.line_total} ر.س`,
      )
      .join("\n");
    const state =
      event.event_type === "customer.quote_ready"
        ? "عرضك جاهز"
        : event.event_type === "customer.quote_expiring"
          ? "عرضك سينتهي قريبًا"
          : "انتهت صلاحية عرضك";
    return [
      {
        profileId: request.requester_id,
        mobile,
        actionUrl: `/customer/quotes/${event.aggregate_id}`,
        text: `${state}\nرقم الطلب: ${request.request_code}\nرقم العرض: ${quote.data.quote_code}\nالمنتجات:\n${itemLines || "—"}\nالمجموع: ${quote.data.subtotal} ر.س\nالضريبة: ${quote.data.vat_amount} ر.س\nالتوصيل: ${quote.data.delivery_fee} ر.س\nالإجمالي: ${quote.data.total} ر.س\nمكان التسليم: ${request.location_hint || "—"}\nGoogle Maps: ${request.google_maps_url || "—"}\nالمستلم: ${request.recipient_name || "—"} · ${request.recipient_mobile || "—"}\nمواعيد العمل: ${request.working_hours || "—"}\nالتحميل: ${request.loading_option || "—"}\nالتنزيل: ${request.unloading_option || "—"}\nسهولة الوصول: ${request.road_access || "—"}\nتعليمات الوصول: ${request.access_instructions || "—"}\nالتسليم المتوقع: ${new Date(quote.data.expected_delivery_at).toLocaleString("ar-SA")}\nالعرض صالح 48 ساعة حتى: ${new Date(quote.data.valid_until).toLocaleString("ar-SA")}\nفتح العرض واتخاذ القرار: ${site}/customer/quotes/${event.aggregate_id}`,
      },
    ];
  }
  if (event.event_type.startsWith("customer.payment_")) {
    const payment = await admin
      .from("payment_records")
      .select(
        "invoice_id,customer_profile_id,amount,profiles!payment_records_customer_profile_id_fkey(mobile),invoices(order_id)",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    const mobile = (
      payment.data?.profiles as unknown as { mobile: string | null } | null
    )?.mobile;
    const invoice = payment.data?.invoices as unknown as {
      order_id: string;
    } | null;
    if (!payment.data || !invoice) return [];
    const label = event.event_type.endsWith("succeeded")
      ? "نجح السداد"
      : event.event_type.endsWith("failed")
        ? "فشل السداد"
        : "تم رد المبلغ";
    const recipients: Recipient[] = [
      {
        profileId: payment.data.customer_profile_id,
        mobile,
        text: `${label} بمبلغ ${payment.data.amount} ر.س.\nتفاصيل الطلب: ${site}/customer/orders/${invoice.order_id}`,
      },
    ];
    if (event.event_type === "customer.payment_succeeded") {
      const [orderResult, paidPayments, adminUsersResult] = await Promise.all([
        admin
          .from("orders")
          .select("order_code,customer_quote_id,total,payment_status")
          .eq("id", invoice.order_id)
          .maybeSingle(),
        admin
          .from("payment_records")
          .select("amount")
          .eq("invoice_id", payment.data.invoice_id)
          .eq("status", "succeeded"),
        admin
          .from("admin_users")
          .select("profile_id,profiles(mobile)")
          .eq("is_active", true),
      ]);
      if (orderResult.data) {
        const fulfillmentResult = await admin
          .from("internal_fulfillment_orders")
          .select("assigned_value,providers(company_name)")
          .eq(
            "bunya_customer_quote_id",
            orderResult.data.customer_quote_id,
          );
        const paidAmount = (paidPayments.data ?? []).reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0,
        );
        const quoteTotal = Number(orderResult.data.total || 0);
        const remainingAmount = Math.max(0, quoteTotal - paidAmount);
        const providerSummaries = (fulfillmentResult.data ?? []).map(
          (fulfillment) => {
            const provider = fulfillment.providers as unknown as {
              company_name: string;
            } | null;
            return `${provider?.company_name || "مزود غير محدد"} — قيمة الترسية ${Number(fulfillment.assigned_value || 0).toFixed(2)} ر.س`;
          },
        );
        const adminMessage = `تم تأكيد دفع عرض السعر للطلب ${orderResult.data.order_code}.\nقيمة عرض السعر المعتمد: ${quoteTotal.toFixed(2)} ر.س\nالمدفوع فعليًا: ${paidAmount.toFixed(2)} ر.س\nالمتبقي: ${remainingAmount.toFixed(2)} ر.س\nالمزود الفائز:\n${providerSummaries.length ? providerSummaries.map((line) => `- ${line}`).join("\n") : "- لم يحدد بعد"}\nحالة الدفع: ${orderResult.data.payment_status === "paid" ? "مدفوع ومؤكد" : "بانتظار التحديث"}.\nراجع الطلب: ${site}/admin/orders`;
        for (const adminUser of adminUsersResult.data ?? []) {
          const adminProfile = adminUser.profiles as unknown as {
            mobile: string | null;
          } | null;
          recipients.push({
            profileId: adminUser.profile_id,
            mobile: adminProfile?.mobile,
            title: "تم دفع عرض السعر",
            actionUrl: "/admin/orders",
            entityType: "admin_order_payment_succeeded",
            text: adminMessage,
          });
        }
      }
    }
    return recipients;
  }
  if (event.event_type === "provider.fulfillment_assigned") {
    const [f, links] = await Promise.all([
      admin
        .from("internal_fulfillment_orders")
        .select(
          "fulfillment_code,provider_id,required_at,providers(owner_profile_id,mobile)",
        )
        .eq("id", event.aggregate_id)
        .maybeSingle(),
      admin
        .from("internal_fulfillment_order_items")
        .select(
          "selected_provider_items(quantity,internal_sourcing_request_items(unit_snapshot,quote_request_items(product_name_snapshot)))",
        )
        .eq("fulfillment_order_id", event.aggregate_id),
    ]);
    const provider = f.data?.providers as unknown as {
      owner_profile_id: string;
      mobile: string | null;
    } | null;
    if (!f.data || !provider?.mobile) return [];
    const itemLines = (links.data ?? [])
      .map((link) => {
        const selected = link.selected_provider_items as unknown as {
          quantity: number;
          internal_sourcing_request_items: {
            unit_snapshot: string;
            quote_request_items: { product_name_snapshot: string };
          };
        };
        return `- ${selected.internal_sourcing_request_items.quote_request_items.product_name_snapshot}: ${selected.quantity} ${selected.internal_sourcing_request_items.unit_snapshot}`;
      })
      .join("\n");
    return [
      {
        profileId: provider.owner_profile_id,
        mobile: provider.mobile,
        text: `تم تأكيد السداد وإسناد أمر التجهيز ${f.data.fulfillment_code}.\n${itemLines}\nالموعد المطلوب: ${new Date(f.data.required_at).toLocaleString("ar-SA")}\nافتح الأمر: ${site}/merchant/orders/${event.aggregate_id}`,
      },
    ];
  }
  if (event.event_type.startsWith("customer.fulfillment_")) {
    const f = await admin
      .from("internal_fulfillment_orders")
      .select(
        "fulfillment_code,bunya_customer_quotes(customer_request_id,quote_requests(requester_id,profiles!quote_requests_requester_id_fkey(mobile)))",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    const quote = f.data?.bunya_customer_quotes as unknown as {
      quote_requests: {
        requester_id: string;
        profiles: { mobile: string | null };
      };
    } | null;
    const request = quote?.quote_requests;
    if (!f.data || !request?.profiles?.mobile) return [];
    return [
      {
        profileId: request.requester_id,
        mobile: request.profiles.mobile,
        text: `تحديث طلبك: ${event.event_type.endsWith("preparing") ? "بدأ المزود التجهيز" : "أصبح الجزء المسند جاهزًا"}.\nتابع الطلب من لوحة العميل.`,
      },
    ];
  }
  if (event.event_type.startsWith("customer.delivery_")) {
    const orderId = String(event.payload?.order_id || "");
    const order = await admin
      .from("orders")
      .select(
        "order_code,customer_profile_id,customer_quote_id,profiles!orders_customer_profile_id_fkey(mobile)",
      )
      .eq("id", orderId)
      .maybeSingle();
    const mobile = (
      order.data?.profiles as unknown as { mobile: string | null } | null
    )?.mobile;
    if (!order.data || !mobile) return [];
    const label = event.event_type.endsWith("assigned")
      ? "تم إسناد التوصيل"
      : event.event_type.endsWith("out_for_delivery")
        ? "خرج طلبك للتوصيل"
        : event.event_type.endsWith("failed")
          ? "تعثر توصيل طلبك"
          : "وصل السائق";
    const recipients: Recipient[] = [];
    if (event.event_type.endsWith("assigned")) {
      const [assignment, deliveryOrder] = await Promise.all([
        admin
          .from("provider_delivery_assignments")
          .select(
            "assigned_driver_id,fulfillment_order_id,expected_at,provider_drivers(full_name,mobile,provider_driver_accounts(auth_user_id)),internal_fulfillment_orders(fulfillment_code)",
          )
          .eq("id", event.aggregate_id)
          .maybeSingle(),
        admin
          .from("orders")
          .select(
            "bunya_customer_quotes(quote_requests(google_maps_url,location_hint,recipient_name,recipient_mobile,site_responsible_name,site_responsible_mobile,contractor_name,contractor_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions))",
          )
          .eq("id", orderId)
          .maybeSingle(),
      ]);
      const driver = assignment.data?.provider_drivers as unknown as {
        full_name: string;
        mobile: string;
        provider_driver_accounts:
          | { auth_user_id?: string | null }
          | { auth_user_id?: string | null }[]
          | null;
      } | null;
      const fulfillment = assignment.data
        ?.internal_fulfillment_orders as unknown as {
        fulfillment_code?: string | null;
      } | null;
      const quote = deliveryOrder.data?.bunya_customer_quotes as unknown as {
        quote_requests?: {
          google_maps_url?: string | null;
          location_hint?: string | null;
          recipient_name?: string | null;
          recipient_mobile?: string | null;
          site_responsible_name?: string | null;
          site_responsible_mobile?: string | null;
          contractor_name?: string | null;
          contractor_mobile?: string | null;
          working_hours?: string | null;
          loading_option?: string | null;
          unloading_option?: string | null;
          road_access?: string | null;
          access_instructions?: string | null;
        } | null;
      } | null;
      const delivery = quote?.quote_requests;
      const itemResult = assignment.data?.fulfillment_order_id
        ? await admin
            .from("internal_fulfillment_order_items")
            .select(
              "selected_provider_items(quantity,internal_sourcing_request_items(unit_snapshot,measurement_snapshot,quote_request_items(product_name_snapshot,notes)))",
            )
            .eq("fulfillment_order_id", assignment.data.fulfillment_order_id)
        : { data: [] };
      const itemLines = (itemResult.data ?? []).map((link) => {
        const selected = link.selected_provider_items as unknown as {
          quantity?: number | string | null;
          internal_sourcing_request_items?: {
            unit_snapshot?: string | null;
            measurement_snapshot?: string | null;
            quote_request_items?: {
              product_name_snapshot?: string | null;
              notes?: string | null;
            } | null;
          } | null;
        } | null;
        const source = selected?.internal_sourcing_request_items;
        const product = source?.quote_request_items;
        const measurement = notificationValue(source?.measurement_snapshot, "");
        const notes = notificationValue(product?.notes, "");
        return `- ${notificationValue(product?.product_name_snapshot)}: ${notificationValue(selected?.quantity)} ${notificationValue(source?.unit_snapshot)}${measurement ? ` (${measurement})` : ""}${notes ? ` — ${notes}` : ""}`;
      });
      const expectedAt = notificationDate(assignment.data?.expected_at);

      recipients.push({
        profileId: order.data.customer_profile_id,
        customerProfileId: order.data.customer_profile_id,
        mobile,
        actionUrl: `/customer/quotes/${order.data.customer_quote_id}`,
        text: `تم إسناد السائق للطلب ${order.data.order_code}.\nالسائق: ${notificationValue(driver?.full_name)}\nرقم السائق: ${notificationValue(driver?.mobile)}\nموعد التوصيل: ${expectedAt}\nيمكنك الاتصال بالسائق ومتابعة حالة التوصيل من عرض السعر المدفوع داخل طلباتك.`,
      });
      const account = driver?.provider_driver_accounts;
      const profileId = Array.isArray(account)
        ? account[0]?.auth_user_id
        : account?.auth_user_id;
      if (driver?.mobile)
        recipients.push({
          profileId: profileId || undefined,
          mobile: driver.mobile,
          actionUrl: "/driver",
          text: `مرحبًا ${driver.full_name}، أُسندت لك مهمة توصيل جديدة.\nالطلب: ${order.data.order_code}\nأمر التوريد: ${notificationValue(fulfillment?.fulfillment_code)}\nموعد التوصيل: ${expectedAt}\n\nالمنتجات:\n${itemLines.length ? itemLines.join("\n") : "- راجع تفاصيل الطلب في بوابة السائق"}\n\nبيانات موقع التسليم:\nالمستلم: ${notificationValue(delivery?.recipient_name)} — ${notificationValue(delivery?.recipient_mobile)}\nمسؤول الموقع: ${notificationValue(delivery?.site_responsible_name)} — ${notificationValue(delivery?.site_responsible_mobile)}\nالمقاول: ${notificationValue(delivery?.contractor_name, "لا يوجد")} — ${notificationValue(delivery?.contractor_mobile, "لا يوجد")}\nمواعيد العمل: ${notificationValue(delivery?.working_hours)}\nالتحميل: ${notificationValue(delivery?.loading_option)}\nالتنزيل: ${notificationValue(delivery?.unloading_option)}\nسهولة الطريق: ${notificationValue(delivery?.road_access)}\nتعليمات الوصول: ${notificationValue(delivery?.access_instructions)}\nوصف الموقع: ${notificationValue(delivery?.location_hint)}\n\nموقع Google Maps:\n${notificationValue(delivery?.google_maps_url)}\n\nراجع المهمة وحدّث حالتها من بوابة السائق: ${site}/driver`,
        });
    } else {
      recipients.push({
        profileId: order.data.customer_profile_id,
        customerProfileId: order.data.customer_profile_id,
        mobile,
        text: `${label} للطلب ${order.data.order_code}.\nتابع الحالة من عرض السعر المدفوع داخل طلباتك.`,
      });
    }
    return recipients;
  }
  if (event.event_type === "customer.driver_arrived") {
    const orderId = String(event.payload?.order_id || "");
    const order = await admin
      .from("orders")
      .select(
        "order_code,customer_profile_id,profiles!orders_customer_profile_id_fkey(mobile)",
      )
      .eq("id", orderId)
      .maybeSingle();
    const mobile = (
      order.data?.profiles as unknown as { mobile: string | null } | null
    )?.mobile;
    if (!order.data || !mobile) return [];
    return [
      {
        profileId: order.data.customer_profile_id,
        customerProfileId: order.data.customer_profile_id,
        mobile,
        text: `وصل السائق للطلب ${order.data.order_code}. لا تسلم رمز التأكيد إلا بعد استلام الشحنة.`,
      },
    ];
  }
  if (event.event_type.startsWith("ticket.")) {
    const ticket = await admin
      .from("support_tickets")
      .select(
        "ticket_code,subject,opened_by,assigned_to,profiles!support_tickets_opened_by_fkey(mobile)",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (!ticket.data) return [];
    if (event.event_type === "ticket.created") {
      const users = await admin
        .from("admin_users")
        .select("profile_id,profiles(mobile,email)")
        .eq("is_active", true);
      return (users.data ?? []).map((row) => {
        const profile = row.profiles as unknown as {
          mobile: string | null;
          email: string | null;
        } | null;
        return {
          profileId: row.profile_id,
          mobile: profile?.mobile,
          email: profile?.email,
          emailSubject: `تذكرة دعم جديدة — ${ticket.data.ticket_code}`,
          text: `تذكرة دعم جديدة ${ticket.data.ticket_code}: ${ticket.data.subject}\\n${site}/admin/support`,
        };
      });
    }
    const mobile = (
      ticket.data.profiles as unknown as { mobile: string | null } | null
    )?.mobile;
    if (!mobile) return [];
    return [
      {
        profileId: ticket.data.opened_by,
        mobile,
        text: `تحديث تذكرة الدعم ${ticket.data.ticket_code}: ${event.event_type}\\n${site}/${String(event.payload?.requester_role || "customer")}/support`,
      },
    ];
  }
  if (event.event_type.startsWith("settlement.")) {
    const settlement = await admin
      .from("contractor_settlement_requests")
      .select(
        "settlement_code,amount,contractor_profile_id,contractor_profiles(profile_id,phone,display_name)",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (!settlement.data) return [];
    if (event.event_type === "settlement.requested") {
      const users = await admin
        .from("admin_users")
        .select("profile_id,profiles(mobile)")
        .eq("is_active", true);
      return (users.data ?? []).flatMap((row) => {
        const mobile = (
          row.profiles as unknown as { mobile: string | null } | null
        )?.mobile;
        return mobile
          ? [
              {
                profileId: row.profile_id,
                mobile,
                text: `طلب تسوية جديد ${settlement.data.settlement_code} بمبلغ ${settlement.data.amount} ر.س.\\n${site}/admin/settlements/contractors`,
              },
            ]
          : [];
      });
    }
    const contractor = settlement.data.contractor_profiles as unknown as {
      profile_id: string;
      phone: string | null;
      display_name: string;
    } | null;
    if (!contractor?.phone) return [];
    return [
      {
        profileId: contractor.profile_id,
        mobile: contractor.phone,
        text: `مرحبًا ${contractor.display_name}، تحديث التسوية ${settlement.data.settlement_code}: ${event.event_type}.\\n${site}/contractor/finance`,
      },
    ];
  }
  if (event.event_type === "contractor.proposal_submitted") {
    const proposal = await admin
      .from("contractor_proposals")
      .select(
        "proposal_code,amount,contractor_profiles(display_name),contractor_opportunities(project_requests(customer_profile_id,title,request_code))",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    const opportunity = proposal.data?.contractor_opportunities as unknown as {
      project_requests?: {
        customer_profile_id: string;
        title: string;
        request_code: string;
      } | null;
    } | null;
    const request = opportunity?.project_requests;
    if (!proposal.data || !request) return [];
    const customer = await admin
      .from("profiles")
      .select("mobile,email")
      .eq("id", request.customer_profile_id)
      .maybeSingle();
    const contractor = proposal.data.contractor_profiles as unknown as {
      display_name?: string;
    } | null;
    const text = `تم استلام عرض جديد من ${contractor?.display_name || "مقاول"} للطلب ${request.request_code} (${request.title}) بقيمة ${proposal.data.amount} ر.س.\nراجع العرض واتخذ القرار من حسابك: ${site}/customer/project-requests`;
    const recipients: Recipient[] = [
      {
        profileId: request.customer_profile_id,
        customerProfileId: request.customer_profile_id,
        mobile: customer.data?.mobile,
        email: customer.data?.email,
        title: "عرض مقاول جديد",
        actionUrl: "/customer/project-requests",
        text,
      },
    ];
    const admins = await admin
      .from("admin_users")
      .select("profile_id,profiles(mobile)")
      .eq("is_active", true);
    recipients.push(
      ...(admins.data ?? []).map((row) => ({
        profileId: row.profile_id,
        mobile: (row.profiles as unknown as { mobile: string | null } | null)
          ?.mobile,
        title: "عرض مقاول جديد",
        actionUrl: "/admin/contractor-proposals",
        text: `عرض جديد ${proposal.data.proposal_code} على الطلب ${request.request_code}.\n${site}/admin/contractor-proposals`,
      })),
    );
    return recipients;
  }
  if (event.event_type === "customer.milestone_approval_requested") {
    const milestone = await admin
      .from("contractor_project_milestones")
      .select(
        "name,contractor_projects(project_code,name,customer_profile_id,contractor_profiles(display_name))",
      )
      .eq("id", event.aggregate_id)
      .maybeSingle();
    const project = milestone.data?.contractor_projects as unknown as {
      project_code: string;
      name: string;
      customer_profile_id: string;
      contractor_profiles?: { display_name?: string } | null;
    } | null;
    if (!milestone.data || !project) return [];
    const customer = await admin
      .from("profiles")
      .select("mobile,email")
      .eq("id", project.customer_profile_id)
      .maybeSingle();
    return [
      {
        profileId: project.customer_profile_id,
        customerProfileId: project.customer_profile_id,
        mobile: customer.data?.mobile,
        email: customer.data?.email,
        title: "مرحلة جاهزة للاعتماد",
        actionUrl: "/customer/project-requests",
        text: `طلب ${project.contractor_profiles?.display_name || "المقاول"} اعتماد المرحلة «${milestone.data.name}» في المشروع ${project.project_code} (${project.name}).\nراجع المرحلة من حسابك: ${site}/customer/project-requests`,
      },
    ];
  }
  if (
    event.event_type.startsWith("contractor.opportunity_") ||
    event.event_type.startsWith("contractor.proposal_") ||
    event.event_type.startsWith("contractor.milestone_") ||
    event.event_type.startsWith("contractor.document_")
  ) {
    let contractorId = String(
      event.payload?.contractor_id ||
        event.payload?.contractor_profile_id ||
        "",
    );
    if (!contractorId && event.event_type.startsWith("contractor.proposal_")) {
      const p = await admin
        .from("contractor_proposals")
        .select("contractor_profile_id")
        .eq("id", event.aggregate_id)
        .maybeSingle();
      contractorId = p.data?.contractor_profile_id ?? "";
    }
    if (!contractorId && event.event_type.includes("milestone_")) {
      const m = await admin
        .from("contractor_project_milestones")
        .select("contractor_projects(contractor_profile_id)")
        .eq("id", event.aggregate_id)
        .maybeSingle();
      contractorId =
        (
          m.data?.contractor_projects as unknown as {
            contractor_profile_id: string;
          } | null
        )?.contractor_profile_id ?? "";
    }
    const contractor = await admin
      .from("contractor_profiles")
      .select("profile_id,phone,display_name")
      .eq("id", contractorId)
      .maybeSingle();
    if (!contractor.data) return [];
    return [
      {
        profileId: contractor.data.profile_id,
        contractorProfileId: contractorId,
        mobile: contractor.data.phone,
        text: `مرحبًا ${contractor.data.display_name}، لديك تحديث: ${event.event_type}.\\n${site}/contractor`,
      },
    ];
  }
  if (
    event.event_type.startsWith("contractor.service_") ||
    event.event_type.startsWith("contractor.portfolio_")
  ) {
    const contractorId = String(event.payload?.contractor_id || "");
    const contractor = await admin
      .from("contractor_profiles")
      .select("profile_id,phone,display_name")
      .eq("id", contractorId)
      .maybeSingle();
    if (!contractor.data) return [];
    const service = event.event_type.includes(".service_"),
      decision = event.event_type.endsWith("approved")
        ? "تم اعتماده"
        : event.event_type.endsWith("rejected")
          ? "تم رفضه"
          : "يحتاج تعديلات";
    return [
      {
        profileId: contractor.data.profile_id,
        contractorProfileId: contractorId,
        mobile: contractor.data.phone,
        text: `مرحبًا ${contractor.data.display_name}، ${service ? "الخدمة" : "عنصر معرض الأعمال"} ${decision}.\nملاحظات المراجعة: ${String(event.payload?.notes || "—")}\n${site}/contractor/${service ? "services" : "portfolio"}`,
      },
    ];
  }
  if (event.event_type.startsWith("admin.")) {
    const users = await admin
      .from("admin_users")
      .select("profile_id,profiles(mobile)")
      .eq("is_active", true);
    return (users.data ?? []).map((row) => ({
      profileId: row.profile_id,
      mobile: (row.profiles as unknown as { mobile: string | null } | null)
        ?.mobile,
      text: `تنبيه تشغيلي: ${event.event_type}\nالمعرف: ${event.aggregate_id}\nالمراجعة: ${site}/admin/operations`,
    }));
  }
  return [];
}
