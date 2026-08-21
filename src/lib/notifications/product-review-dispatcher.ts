import "server-only";

import sharp from "sharp";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  maskWhatsAppDestination,
  sendGreenApiFile,
  sendGreenApiMessage,
  type ProviderSubmission,
} from "./providers/green-api";
import { recordProviderSubmission } from "./submissions";

const IMAGE_BUCKET = "provider-product-images";
const IMAGE_CAPTION_LIMIT = 1024;
const TEXT_MESSAGE_LIMIT = 20_000;

type ProductReviewOutbox = {
  id: string;
  aggregate_id: string;
};

type ProductReviewDetails = {
  name: string;
  sku: string | null;
  base_unit: string;
  description: string;
  availability_summary: string;
  availability_status: string;
  lead_time_label: string;
  delivery_label: string;
  delivery_window: string;
  delivery_notes: string;
  offer_type: string;
  unit_price: number | string | null;
  minimum_order: number | string | null;
  stock_quantity: number | string | null;
  vat_inclusive: boolean;
  rental_duration_value: number | string | null;
  rental_duration_unit: string | null;
  custom_category: string | null;
  providers: { company_name: string } | null;
  product_categories: { name: string } | null;
};

type ProductImage = {
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
};

export async function dispatchProductReviewNotifications(limit = 10) {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_notification_outbox", {
    p_limit: limit,
    p_event_types: ["admin.product_pending_review"],
  });
  if (claimed.error) throw new Error("product_review_outbox_claim_failed");

  let processed = 0;
  let failed = 0;

  for (const event of (claimed.data ?? []) as ProductReviewOutbox[]) {
    try {
      const [recipients, productResult, imageResult] = await Promise.all([
        admin.from("admin_users").select("profile_id,profiles(mobile)").eq("is_active", true),
        admin
          .from("products")
          .select(
            "name,sku,base_unit,description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,offer_type,unit_price,minimum_order,stock_quantity,vat_inclusive,rental_duration_value,rental_duration_unit,custom_category,providers(company_name),product_categories(name)",
          )
          .eq("id", event.aggregate_id)
          .maybeSingle(),
        admin
          .from("product_images")
          .select("storage_path,file_name,mime_type")
          .eq("product_id", event.aggregate_id)
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (recipients.error) throw new Error("admin_recipients_lookup_failed");
      if (productResult.error || !productResult.data) throw new Error("product_review_details_not_found");
      if (imageResult.error) throw new Error("product_review_image_lookup_failed");

      const ready = (recipients.data ?? []).flatMap((row) => {
        const profile = row.profiles as unknown as { mobile: string | null } | null;
        return profile?.mobile ? [{ profileId: String(row.profile_id), mobile: profile.mobile }] : [];
      });
      if (!ready.length) throw new Error("admin_mobile_not_ready");

      const product = productResult.data as unknown as ProductReviewDetails;
      const siteUrl = process.env.APP_URL || "https://bunya-platform.vercel.app";
      const reviewUrl = `${siteUrl}/admin/products/review/${event.aggregate_id}`;
      const text = buildProductReviewMessage(product, reviewUrl);
      const image = await downloadProductImage(admin, imageResult.data as ProductImage | null);

      let success = true;
      for (const recipient of ready) {
        const baseKey = `product-review-${event.id}-${recipient.profileId}`;
        const destinationMasked = maskWhatsAppDestination(recipient.mobile);

        if (image) {
          const caption = buildImageCaption(product, reviewUrl, text);
          const imageResult = await sendGreenApiFile({
            to: recipient.mobile,
            file: image,
            caption,
            idempotencyKey: `${baseKey}-image`,
          });
          await recordSubmission(destinationMasked, `${baseKey}-image`, imageResult);

          if (imageResult.status === "submitted") {
            if (text.length > IMAGE_CAPTION_LIMIT) {
              const detailsResult = await sendGreenApiMessage({
                to: recipient.mobile,
                text,
                idempotencyKey: `${baseKey}-details`,
              });
              await recordSubmission(destinationMasked, `${baseKey}-details`, detailsResult);
              success = success && detailsResult.status === "submitted";
            }
            continue;
          }
        }

        const fallbackResult = await sendGreenApiMessage({
          to: recipient.mobile,
          text,
          idempotencyKey: `${baseKey}-text`,
        });
        await recordSubmission(destinationMasked, `${baseKey}-text`, fallbackResult);
        success = success && fallbackResult.status === "submitted";
      }

      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: success,
        p_error: success ? null : "provider_submission_failed",
      });
      if (success) processed += 1;
      else failed += 1;
    } catch {
      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: false,
        p_error: "product_review_notification_failed",
      });
      failed += 1;
    }
  }

  return { claimed: (claimed.data ?? []).length, processed, failed };
}

function buildProductReviewMessage(product: ProductReviewDetails, reviewUrl: string) {
  const providerName = product.providers?.company_name || "غير محدد";
  const categoryName = product.custom_category || product.product_categories?.name || "غير محدد";
  const offerType = product.offer_type === "rental" ? "تأجير" : "بيع";
  const vat = product.vat_inclusive ? "شامل الضريبة" : "غير شامل الضريبة";
  const rental =
    product.offer_type === "rental"
      ? `مدة التأجير: ${value(product.rental_duration_value)} ${product.rental_duration_unit || ""}`.trim()
      : null;
  const body = [
    "📦 منتج جديد بانتظار المراجعة",
    "",
    `المنشأة: ${providerName}`,
    `اسم المنتج: ${product.name}`,
    `التصنيف: ${categoryName}`,
    `SKU: ${product.sku || "غير محدد"}`,
    `نوع العرض: ${offerType}`,
    `السعر: ${money(product.unit_price)} ر.س / ${product.base_unit} (${vat})`,
    `الحد الأدنى للطلب: ${value(product.minimum_order)} ${product.base_unit}`,
    `المخزون: ${value(product.stock_quantity)} ${product.base_unit}`,
    rental,
    `التوفر: ${product.availability_summary}`,
    `حالة التوفر: ${availabilityLabel(product.availability_status)}`,
    `مدة التجهيز: ${product.lead_time_label}`,
    `التوصيل: ${product.delivery_label}`,
    `نافذة التوصيل: ${product.delivery_window}`,
    `ملاحظات التوصيل: ${product.delivery_notes}`,
    "",
    "الوصف:",
    product.description,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const suffix = `\n\nفتح صفحة المراجعة:\n${reviewUrl}`;
  if (body.length + suffix.length <= TEXT_MESSAGE_LIMIT) return body + suffix;
  return `${body.slice(0, TEXT_MESSAGE_LIMIT - suffix.length - 1).trimEnd()}…${suffix}`;
}

function buildImageCaption(product: ProductReviewDetails, reviewUrl: string, fullText: string) {
  if (fullText.length <= IMAGE_CAPTION_LIMIT) return fullText;
  return [
    "📦 منتج جديد بانتظار المراجعة",
    `المنشأة: ${product.providers?.company_name || "غير محدد"}`,
    `المنتج: ${product.name}`,
    "التفاصيل الكاملة في الرسالة التالية.",
    `المراجعة: ${reviewUrl}`,
  ].join("\n");
}

async function downloadProductImage(
  admin: ReturnType<typeof createAdminClient>,
  image: ProductImage | null,
) {
  if (!image?.storage_path) return null;
  const downloaded = await admin.storage.from(IMAGE_BUCKET).download(image.storage_path);
  if (downloaded.error || !downloaded.data) return null;

  const originalType = image.mime_type || downloaded.data.type;
  const originalName = image.file_name || "product-image.jpg";
  if (originalType === "image/webp" || originalName.toLowerCase().endsWith(".webp")) {
    const jpeg = await sharp(Buffer.from(await downloaded.data.arrayBuffer())).jpeg({ quality: 90 }).toBuffer();
    const jpegBytes = new Uint8Array(jpeg.byteLength);
    jpegBytes.set(jpeg);
    return new File([jpegBytes], originalName.replace(/\.webp$/i, ".jpg"), { type: "image/jpeg" });
  }
  if (!["image/jpeg", "image/png"].includes(originalType)) return null;
  return new File([downloaded.data], originalName, { type: originalType });
}

async function recordSubmission(
  destinationMasked: string,
  idempotencyKey: string,
  result: ProviderSubmission,
) {
  await recordProviderSubmission({
    eventType: "admin.product_pending_review",
    channel: "whatsapp",
    destinationMasked,
    idempotencyKey,
    result,
  });
}

function money(input: number | string | null) {
  if (input === null) return "غير محدد";
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(Number(input));
}

function value(input: number | string | null) {
  if (input === null) return "غير محدد";
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 3 }).format(Number(input));
}

function availabilityLabel(status: string) {
  const labels: Record<string, string> = {
    available: "متوفر",
    limited: "كمية محدودة",
    on_request: "حسب الطلب",
    out_of_stock: "غير متوفر",
  };
  return labels[status] || status;
}
