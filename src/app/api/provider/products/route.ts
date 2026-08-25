import { getAuthIdentity } from "@/lib/auth/server";
import { dispatchProductReviewNotifications } from "@/lib/notifications/product-review-dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const IMAGE_BUCKET = "provider-product-images";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_TONES = new Set(["cement", "steel", "blocks", "insulation", "plumbing", "electric", "wood", "paint", "tools"]);

type ProductInsert = {
  provider_id: string;
  created_by: string;
  category_id: string | null;
  custom_category: string | null;
  slug: string;
  sku: string | null;
  name: string;
  base_unit: string;
  short_description: string;
  description: string;
  full_description: string;
  availability_summary: string;
  availability_status: string;
  lead_time_label: string;
  delivery_label: string;
  delivery_window: string;
  delivery_notes: string;
  offer_type: string;
  unit_price: number;
  minimum_order: number | null;
  stock_quantity: number | null;
  vat_inclusive: boolean;
  rental_duration_value: number | null;
  rental_duration_unit: string | null;
  review_status: "draft" | "pending_review";
  is_published: false;
  is_new: true;
};

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function optionalNumber(form: FormData, name: string) {
  const value = text(form, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function jsonArray(form: FormData, name: string): unknown[] | null {
  try {
    const value = JSON.parse(text(form, name) || "[]");
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "product-image";
}

function availabilitySummary(status: string, quantity: number | null, unit: string) {
  if (status === "limited" && quantity !== null) return `كمية محدودة: ${quantity} ${unit}`;
  if (status === "on_request") return "متوفر حسب الطلب";
  if (status === "unavailable") return "غير متوفر حاليًا";
  return "متوفر لدى المزود";
}

async function rollbackProduct(productId: string, uploadedPaths: string[]) {
  const supabase = await createClient();
  if (uploadedPaths.length) await supabase.storage.from(IMAGE_BUCKET).remove(uploadedPaths);
  const removed = await supabase.from("products").delete().eq("id", productId);
  if (removed.error)
    console.error("provider_product_rollback_failed", {
      productId,
      code: removed.error.code,
    });
}

export async function POST(request: Request) {
  const identity = await getAuthIdentity();
  const provider = identity?.details.provider;
  if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider") || !provider) {
    return Response.json({ error: "يلزم تسجيل الدخول بحساب مزود فعّال." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "تعذر قراءة بيانات المنتج والصور." }, { status: 400 });
  }

  const intent = text(form, "intent") === "pending_review" ? "pending_review" : "draft";
  const name = text(form, "name");
  const categoryId = text(form, "category_id");
  const customCategory = text(form, "custom_category");
  const baseUnit = text(form, "base_unit");
  const description = text(form, "description");
  const offerType = text(form, "offer_type") === "rental" ? "rental" : "sale";
  const unitPrice = optionalNumber(form, "unit_price");
  const minimumOrder = optionalNumber(form, "minimum_order");
  const stockQuantity = optionalNumber(form, "stock_quantity");
  const availabilityStatus = text(form, "availability_status") || "available";
  const rentalDuration = optionalNumber(form, "rental_duration_value");
  const rentalDurationUnit = text(form, "rental_duration_unit") || null;
  const images = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
  const measurementInput = jsonArray(form, "measurements");
  const variantInput = jsonArray(form, "variants");
  if (!measurementInput || !variantInput) {
    return Response.json({ error: "تعذر قراءة المقاسات أو فئات المنتج." }, { status: 400 });
  }
  const measurements = [...new Set(measurementInput.map((value) => String(value).trim()).filter(Boolean))].slice(0, 40);
  const variants = variantInput
    .map((value) =>
      value && typeof value === "object"
        ? {
            type: String((value as Record<string, unknown>).type ?? "").trim(),
            value: String((value as Record<string, unknown>).value ?? "").trim(),
          }
        : null,
    )
    .filter((value): value is { type: string; value: string } => Boolean(value?.type && value.value))
    .slice(0, 60);
  if (measurements.some((value) => value.length > 120) || variants.some((item) => item.type.length > 40 || item.value.length > 120)) {
    return Response.json({ error: "أحد المقاسات أو خيارات المنتج أطول من الحد المسموح." }, { status: 400 });
  }
  const specificationFields: Array<[string, string]> = [
    ["GTIN / الباركود", "gtin"],
    ["المصنّع / العلامة", "manufacturer"],
    ["بلد المنشأ", "country_of_origin"],
    ["المادة / التركيبة", "material"],
    ["الدرجة / الفئة", "grade"],
    ["الوزن", "weight"],
    ["اللون / التشطيب", "color"],
    ["التعبئة", "packaging"],
    ["المواصفة أو شهادة المطابقة", "standard_reference"],
    ["الاستخدام المخصص", "intended_use"],
    ["السلامة والمناولة", "safety_notes"],
    ["شروط التخزين", "storage_conditions"],
  ];
  const specifications = specificationFields
    .map(([label, field]) => [label, text(form, field)] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  const warrantyDuration = text(form, "warranty_duration");
  const warrantyDetails = text(form, "warranty_details");

  const usesCustomCategory = categoryId === "other";
  if (name.length < 2 || !categoryId || (usesCustomCategory && (customCategory.length < 2 || customCategory.length > 80)) || !baseUnit || description.length < 10 || unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return Response.json({ error: "أكمل اسم المنتج والتصنيف والوحدة والوصف والسعر بصورة صحيحة." }, { status: 400 });
  }
  if ([minimumOrder, stockQuantity, rentalDuration].some((value) => value !== null && !Number.isFinite(value))) {
    return Response.json({ error: "تحقق من القيم الرقمية المدخلة." }, { status: 400 });
  }
  if (minimumOrder !== null && minimumOrder <= 0) return Response.json({ error: "الحد الأدنى للطلب يجب أن يكون أكبر من صفر." }, { status: 400 });
  if (stockQuantity !== null && stockQuantity < 0) return Response.json({ error: "كمية المخزون لا يمكن أن تكون سالبة." }, { status: 400 });
  if (!["available", "limited", "on_request", "unavailable"].includes(availabilityStatus)) {
    return Response.json({ error: "حالة التوفر المحددة غير صالحة." }, { status: 400 });
  }
  if (availabilityStatus === "limited" && (stockQuantity === null || stockQuantity <= 0)) {
    return Response.json({ error: "حدد كمية أكبر من صفر عند اختيار «كمية محدودة»." }, { status: 400 });
  }
  if (offerType === "rental" && (rentalDuration === null || rentalDuration <= 0 || !rentalDurationUnit)) {
    return Response.json({ error: "حدد مدة التأجير ووحدتها." }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) return Response.json({ error: `يمكن رفع ${MAX_IMAGES} صور كحد أقصى.` }, { status: 400 });
  if (intent === "pending_review" && images.length === 0) {
    return Response.json({ error: "أضف صورة واحدة على الأقل قبل إرسال المنتج للمراجعة." }, { status: 400 });
  }
  const invalidImage = images.find((image) => !IMAGE_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES);
  if (invalidImage) return Response.json({ error: `الصورة ${invalidImage.name} غير مدعومة أو أكبر من 5MB.` }, { status: 400 });

  const supabase = await createClient();
  let categorySlug = "tools";
  if (!usesCustomCategory) {
    const categoryResult = await supabase.from("product_categories").select("slug").eq("id", categoryId).eq("is_active", true).maybeSingle();
    categorySlug = String(categoryResult.data?.slug ?? "");
    if (categoryResult.error || !PRODUCT_TONES.has(categorySlug)) {
      return Response.json({ error: "التصنيف المحدد غير متاح." }, { status: 400 });
    }
  }

  const requiredDelivery = ["lead_time_label", "delivery_window", "delivery_notes"];
  if (requiredDelivery.some((field) => !text(form, field))) {
    return Response.json({ error: "أكمل بيانات التوفر والتوصيل." }, { status: 400 });
  }

  const product: ProductInsert = {
    provider_id: provider.providerId,
    created_by: identity.userId,
    category_id: usesCustomCategory ? null : categoryId,
    custom_category: usesCustomCategory ? customCategory : null,
    slug: `product-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sku: text(form, "sku") || null,
    name,
    base_unit: baseUnit,
    short_description: description,
    description,
    full_description: description,
    availability_summary: availabilitySummary(availabilityStatus, stockQuantity, baseUnit),
    availability_status: availabilityStatus,
    lead_time_label: text(form, "lead_time_label"),
    delivery_label: "يتم تنسيق التسليم مع العميل",
    delivery_window: text(form, "delivery_window"),
    delivery_notes: text(form, "delivery_notes"),
    offer_type: offerType,
    unit_price: unitPrice,
    minimum_order: minimumOrder,
    stock_quantity: stockQuantity,
    vat_inclusive: text(form, "vat_inclusive") === "on",
    rental_duration_value: offerType === "rental" ? rentalDuration : null,
    rental_duration_unit: offerType === "rental" ? rentalDurationUnit : null,
    review_status: intent,
    is_published: false,
    is_new: true,
  };

  const inserted = await supabase.from("products").insert(product).select("id").single();
  if (inserted.error || !inserted.data) {
    const message = inserted.error?.code === "23505" ? "رمز SKU مستخدم لمنتج آخر." : "تعذر إنشاء المنتج في قاعدة البيانات.";
    console.error("provider_product_insert_failed", {
      code: inserted.error?.code,
      details: inserted.error?.details,
    });
    return Response.json(
      {
        error: message,
        diagnostic: process.env.NODE_ENV === "development" ? { code: inserted.error?.code, message: inserted.error?.message } : undefined,
      },
      { status: 400 },
    );
  }

  const productId = String(inserted.data.id);
  const uploadedPaths: string[] = [];
  try {
    if (measurements.length) {
      const baseUnitResult = await supabase.from("product_units").select("id").eq("product_id", productId).eq("is_base", true).maybeSingle();
      if (baseUnitResult.error || !baseUnitResult.data) throw new Error("تعذر ربط المقاسات بوحدة المنتج الأساسية.");
      const baseUnitId = baseUnitResult.data.id;
      const measurementRows = measurements.map((value, index) => ({
        product_id: productId,
        unit_id: baseUnitId,
        label: value,
        is_default: index === 0,
        sort_order: index,
      }));
      const measurementResult = await supabase.from("product_measurements").insert(measurementRows);
      if (measurementResult.error) throw new Error("تعذر حفظ مقاسات المنتج.");
    }
    if (variants.length) {
      const variantRows = variants.map((item, index) => ({
        product_id: productId,
        sku: `${product.sku || "WEB"}-${productId.slice(0, 8)}-${index + 1}`,
        name: `${item.type}: ${item.value}`,
        attributes: { [item.type]: item.value },
        is_active: true,
        sort_order: index,
      }));
      const variantResult = await supabase.from("product_variants").insert(variantRows);
      if (variantResult.error) throw new Error("تعذر حفظ فئات وخيارات المنتج.");
    }
    if (specifications.length) {
      const specificationResult = await supabase.from("product_specifications").insert(
        specifications.map((value, index) => ({
          product_id: productId,
          value,
          sort_order: index,
        })),
      );
      if (specificationResult.error) throw new Error("تعذر حفظ المواصفات الفنية.");
    }
    if (warrantyDuration) {
      const warrantyResult = await supabase.from("product_warranties").insert({
        product_id: productId,
        label: "ضمان المنتج",
        duration: warrantyDuration,
        details: warrantyDetails || "حسب شروط وضمان المزوّد",
      });
      if (warrantyResult.error) throw new Error("تعذر حفظ بيانات الضمان.");
    }
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const path = `${provider.providerId}/${productId}/${crypto.randomUUID()}-${safeFileName(image.name)}`;
      const uploaded = await supabase.storage.from(IMAGE_BUCKET).upload(path, image, { contentType: image.type, upsert: false });
      if (uploaded.error) throw new Error(`تعذر رفع الصورة ${image.name}.`);
      uploadedPaths.push(path);
      const imageRow = await supabase.from("product_images").insert({
        product_id: productId,
        label: `${name} - صورة ${index + 1}`,
        alt_text: `صورة المنتج ${name}`,
        tone: categorySlug,
        storage_path: path,
        file_name: image.name,
        mime_type: image.type,
        file_size_bytes: image.size,
        is_primary: index === 0,
        sort_order: index,
      });
      if (imageRow.error) throw new Error(`تعذر تسجيل الصورة ${image.name}.`);
    }

    if (intent === "pending_review") {
      const admin = createAdminClient();
      const recipients = await admin.from("admin_users").select("profile_id").eq("is_active", true);
      if (recipients.error || !recipients.data?.length) throw new Error("لا يوجد مدير نشط لاستقبال طلب المراجعة.");
      const profileIds = recipients.data.map((row) => String(row.profile_id));
      const existing = await admin.from("notifications").select("profile_id").eq("type", "admin.product_pending_review").eq("entity_type", "product").eq("entity_id", productId).in("profile_id", profileIds);
      if (existing.error) throw new Error("تعذر التحقق من إشعار المراجعة.");
      const notified = new Set((existing.data ?? []).map((row) => String(row.profile_id)));
      const notifications = profileIds
        .filter((profileId) => !notified.has(profileId))
        .map((profileId) => ({
          profile_id: profileId,
          actor_profile_id: identity.userId,
          type: "admin.product_pending_review",
          title: "منتج جديد بانتظار المراجعة",
          message: `أضافت منشأة ${provider.companyName} المنتج «${name}» وأرسلته للمراجعة.`,
          action_url: `/admin/products/review/${productId}`,
          entity_type: "product",
          entity_id: productId,
          metadata: {
            provider_id: provider.providerId,
            provider_name: provider.companyName,
            product_name: name,
          },
        }));
      if (notifications.length) {
        const notificationResult = await admin.from("notifications").insert(notifications);
        if (notificationResult.error) throw new Error("تعذر إرسال إشعار المنتج إلى الإدارة.");
      }
    }
  } catch (error) {
    await rollbackProduct(productId, uploadedPaths);
    const message = error instanceof Error ? error.message : "تعذر إكمال إنشاء المنتج.";
    console.error("provider_product_completion_failed", { productId, message });
    return Response.json({ error: `${message} تم التراجع عن إنشاء المنتج بأمان.` }, { status: 500 });
  }

  if (intent === "pending_review" && process.env.NOTIFICATIONS_ENABLED === "true") {
    await dispatchProductReviewNotifications().catch((error) => {
      console.error("product_review_whatsapp_dispatch_failed", {
        productId,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }

  return Response.json({ id: productId, reviewStatus: intent }, { status: 201 });
}
