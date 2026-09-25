import { NextRequest } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
  isLocalAppOrigin,
} from "@/lib/auth/request-client";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const IMAGE_BUCKET = "provider-product-images";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PRODUCT_TONES = new Set(["cement", "steel", "blocks", "insulation", "plumbing", "electric", "wood", "paint", "tools"]);

type ExistingImage = {
  id: string;
  label: string;
  alt_text: string;
  tone: string;
  image_url: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  is_primary: boolean;
  sort_order: number;
};

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").normalize("NFKC").trim();
}

function number(form: FormData, name: string) {
  const value = text(form, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new PublicJoinError("تحقق من القيم الرقمية المدخلة.", 400);
  return parsed;
}

function array(form: FormData, name: string): unknown[] {
  try {
    const parsed = JSON.parse(text(form, name) || "[]");
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new PublicJoinError("تعذر قراءة بعض بيانات المنتج المتكررة.", 400);
  }
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "product-image";
}

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const uploadedPaths: string[] = [];
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user) throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 401);
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    const provider = identity?.details.provider;
    if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider") || !provider) {
      throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 403);
    }

    const { id: productId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new PublicJoinError("معرف المنتج غير صالح.", 400);
    const form = await request.formData().catch(() => null);
    if (!form) throw new PublicJoinError("تعذر قراءة بيانات طلب التعديل.", 400);

    const admin = createAdminClient();
    const productResult = await admin
      .from("products")
      .select("id,provider_id,review_status,is_published")
      .eq("id", productId)
      .maybeSingle();
    if (productResult.error) throw new Error("product_change_product_lookup_failed");
    if (!productResult.data || productResult.data.provider_id !== provider.providerId) throw new PublicJoinError("المنتج غير موجود ضمن منشأتك.", 404);
    if (productResult.data.review_status !== "approved" || !productResult.data.is_published) {
      throw new PublicJoinError("يمكن طلب تعديل المنتجات المعتمدة والمنشورة فقط.", 409);
    }

    const name = text(form, "name");
    const categoryValue = text(form, "category_id");
    const customCategory = text(form, "custom_category");
    const baseUnit = text(form, "base_unit");
    const description = text(form, "description");
    const offerType = text(form, "offer_type") === "rental" ? "rental" : "sale";
    const availabilityStatus = text(form, "availability_status") || "available";
    const unitPrice = number(form, "unit_price");
    const minimumOrder = number(form, "minimum_order");
    const stockQuantity = number(form, "stock_quantity");
    const rentalDuration = number(form, "rental_duration_value");
    const rentalDurationUnit = text(form, "rental_duration_unit") || null;
    const usesCustomCategory = categoryValue === "other";
    const categoryId = usesCustomCategory ? null : categoryValue;
    if (name.length < 2 || name.length > 160 || !categoryValue || (usesCustomCategory && (customCategory.length < 2 || customCategory.length > 80)) || !baseUnit || description.length < 10 || unitPrice === null || unitPrice < 0) {
      throw new PublicJoinError("أكمل اسم المنتج والتصنيف والوحدة والوصف والسعر بصورة صحيحة.", 400);
    }
    if (minimumOrder !== null && minimumOrder <= 0) throw new PublicJoinError("الحد الأدنى للطلب يجب أن يكون أكبر من صفر.", 400);
    if (stockQuantity !== null && stockQuantity < 0) throw new PublicJoinError("المخزون لا يمكن أن يكون سالبًا.", 400);
    if (!new Set(["available", "limited", "on_request", "unavailable"]).has(availabilityStatus)) throw new PublicJoinError("حالة التوفر غير صالحة.", 400);
    if (availabilityStatus === "limited" && (!stockQuantity || stockQuantity <= 0)) throw new PublicJoinError("حدد الكمية المتوفرة.", 400);
    if (offerType === "rental" && (!rentalDuration || rentalDuration <= 0 || !rentalDurationUnit)) throw new PublicJoinError("حدد مدة التأجير ووحدتها.", 400);

    let categoryTone = "tools";
    if (categoryId) {
      const categoryResult = await admin.from("product_categories").select("slug").eq("id", categoryId).eq("is_active", true).maybeSingle();
      if (categoryResult.error || !categoryResult.data) throw new PublicJoinError("التصنيف المحدد غير متاح.", 400);
      categoryTone = String(categoryResult.data.slug || "tools");
      if (!PRODUCT_TONES.has(categoryTone)) categoryTone = "tools";
    }

    const measurementValues = [...new Set(array(form, "measurements").map((value) => String(value).trim()).filter(Boolean))].slice(0, 40);
    const variantValues = array(form, "variants")
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const item = value as Record<string, unknown>;
        const type = String(item.type ?? "").trim();
        const option = String(item.value ?? "").trim();
        return type && option ? { type, value: option } : null;
      })
      .filter((value): value is { type: string; value: string } => Boolean(value))
      .slice(0, 60);
    const specificationFields: Array<[string, string]> = [
      ["GTIN / الباركود", "gtin"], ["المصنّع / العلامة", "manufacturer"], ["بلد المنشأ", "country_of_origin"],
      ["المادة / التركيبة", "material"], ["الدرجة / الفئة", "grade"], ["الوزن", "weight"],
      ["اللون / التشطيب", "color"], ["التعبئة", "packaging"], ["المواصفة أو شهادة المطابقة", "standard_reference"],
      ["الاستخدام المخصص", "intended_use"], ["السلامة والمناولة", "safety_notes"], ["شروط التخزين", "storage_conditions"],
    ];
    const specifications = specificationFields
      .map(([label, field]) => [label, text(form, field)] as const)
      .filter(([, value]) => value)
      .map(([label, value], index) => ({ value: `${label}: ${value}`, sort_order: index }));

    const retainedIds = new Set(array(form, "retained_image_ids").map(String));
    const currentImages = await admin
      .from("product_images")
      .select("id,label,alt_text,tone,image_url,storage_path,file_name,mime_type,file_size_bytes,is_primary,sort_order")
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order");
    if (currentImages.error) throw new Error("product_change_images_lookup_failed");
    const retained = (currentImages.data as ExistingImage[]).filter((image) => retainedIds.has(image.id));
    const newImages = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
    if (retained.length + newImages.length < 1 || retained.length + newImages.length > 6) throw new PublicJoinError("يجب الإبقاء على صورة واحدة وحتى 6 صور للمنتج.", 400);
    const invalidImage = newImages.find((image) => !IMAGE_TYPES.has(image.type) || image.size > 5 * 1024 * 1024);
    if (invalidImage) throw new PublicJoinError(`الصورة ${invalidImage.name} غير مدعومة أو أكبر من 5MB.`, 400);

    const requestToken = crypto.randomUUID();
    const proposedImages: Array<Record<string, unknown>> = retained.map((image) => ({ ...image }));
    for (let index = 0; index < newImages.length; index += 1) {
      const image = newImages[index];
      const path = `${provider.providerId}/${productId}/changes/${requestToken}-${index + 1}-${safeFileName(image.name)}`;
      const uploaded = await admin.storage.from(IMAGE_BUCKET).upload(path, image, { contentType: image.type, upsert: false });
      if (uploaded.error) throw new Error("product_change_image_upload_failed");
      uploadedPaths.push(path);
      proposedImages.push({
        label: `${name} - صورة ${proposedImages.length + 1}`,
        alt_text: `صورة المنتج ${name}`,
        tone: categoryTone,
        image_url: null,
        storage_path: path,
        file_name: image.name,
        mime_type: image.type,
        file_size_bytes: image.size,
        is_primary: false,
        sort_order: proposedImages.length,
      });
    }
    proposedImages.forEach((image, index) => {
      image.is_primary = index === 0;
      image.sort_order = index;
      image.tone = PRODUCT_TONES.has(String(image.tone)) ? image.tone : categoryTone;
    });

    const availabilityRegions = array(form, "availability_regions").map((value) => {
      const item = value as Record<string, unknown>;
      return { city: String(item?.city ?? "").trim(), scope: String(item?.scope ?? "المدينة").trim() };
    }).filter((item) => item.city);
    const deliveryRegions = array(form, "delivery_regions").map((value) => ({ region_name: String((value as Record<string, unknown>)?.region_name ?? value).trim() })).filter((item) => item.region_name);
    const deliveryAvailable = text(form, "delivery_available") === "true";
    const deliveryConfig = {
      is_available: deliveryAvailable,
      maximum_duration: deliveryAvailable ? number(form, "delivery_maximum_duration") : null,
      duration_unit: deliveryAvailable ? text(form, "delivery_duration_unit") || null : null,
      price_per_km: deliveryAvailable ? number(form, "delivery_price_per_km") : null,
      maximum_distance_km: deliveryAvailable ? number(form, "delivery_maximum_distance_km") : null,
      notes: text(form, "delivery_config_notes") || null,
    };
    if (deliveryAvailable && (!deliveryConfig.maximum_duration || !deliveryConfig.duration_unit)) throw new PublicJoinError("حدد مدة التوصيل القصوى ووحدتها.", 400);

    const warrantyDuration = text(form, "warranty_duration");
    const warranty = warrantyDuration
      ? { label: "ضمان المنتج", duration: warrantyDuration, details: text(form, "warranty_details") || "حسب شروط وضمان المزود", is_available: true, duration_value: 1, duration_unit: warrantyDuration, no_warranty_accepted: false }
      : null;
    const proposed = {
      core: {
        category_id: categoryId,
        custom_category: usesCustomCategory ? customCategory : null,
        sku: text(form, "sku") || null,
        name,
        base_unit: baseUnit,
        short_description: description,
        description,
        full_description: description,
        availability_status: availabilityStatus,
        lead_time_label: text(form, "lead_time_label"),
        delivery_window: text(form, "delivery_window"),
        delivery_notes: text(form, "delivery_notes"),
        offer_type: offerType,
        unit_price: unitPrice,
        minimum_order: minimumOrder,
        stock_quantity: stockQuantity,
        vat_inclusive: text(form, "vat_inclusive") === "true" || text(form, "vat_inclusive") === "on",
        rental_duration_value: offerType === "rental" ? rentalDuration : null,
        rental_duration_unit: offerType === "rental" ? rentalDurationUnit : null,
      },
      images: proposedImages,
      measurements: measurementValues.map((label, index) => ({ label, is_default: index === 0, sort_order: index })),
      variants: variantValues.map((item, index) => ({ name: `${item.type}: ${item.value}`, attributes: { [item.type]: item.value }, is_active: true, sort_order: index })),
      specifications,
      warranty,
      availability_regions: availabilityRegions,
      delivery_config: deliveryConfig,
      delivery_regions: deliveryRegions,
    };

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || `product-change-${requestToken}`;
    const result = await auth.supabase.rpc("submit_product_change_request", {
      p_product_id: productId,
      p_proposed_snapshot: proposed,
      p_request_note: text(form, "request_note") || null,
      p_idempotency_key: idempotencyKey,
    });
    if (result.error) {
      if (result.error.message.includes("already pending")) throw new PublicJoinError("يوجد طلب تعديل لهذا المنتج بانتظار قرار الإدارة.", 409);
      if (result.error.message.includes("No product data was changed")) throw new PublicJoinError("لم تغيّر أي بيانات في المنتج.", 400);
      throw new PublicJoinError(`تعذر حفظ طلب التعديل: ${result.error.message}`, 400);
    }
    const payload = result.data as { request_id?: string; event_id?: string };
    if (payload.event_id) await dispatchNotificationEvent(payload.event_id).catch((error) => console.error("product_change_notification_dispatch_failed", error instanceof Error ? error.message : "unknown"));
    return authRouteResponse(request, { requestId: payload.request_id, status: "pending" }, 201);
  } catch (error) {
    if (uploadedPaths.length) await createAdminClient().storage.from(IMAGE_BUCKET).remove(uploadedPaths).catch(() => undefined);
    if (error instanceof PublicJoinError) return authRouteResponse(request, { error: error.message }, error.status);
    console.error("product_change_request_failed", error instanceof Error ? error.message : "unknown_error");
    return authRouteResponse(request, { error: "تعذر إرسال طلب تعديل المنتج حاليًا." }, 500);
  }
}
