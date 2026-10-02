import { NextRequest } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { readBoundedBytes } from "@/lib/join/provider-upload-batches";
import { MAX_PRODUCT_MEDIA, PRODUCT_MEDIA_BUCKET, validProductMedia } from "@/lib/products/media";

export const runtime = "nodejs";
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const identity = await getAuthIdentity();
    const provider = identity?.details.provider;
    if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider") || !provider) throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 401);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBoundedBytes(request.body, 16000))); }
    catch (error) { if (error instanceof PublicJoinError) throw error; throw new PublicJoinError("بيانات الرفع غير صالحة.", 400); }
    if (!body || !Array.isArray(body.files) || !body.files.length || body.files.length > MAX_PRODUCT_MEDIA) throw new PublicJoinError("اختر من ملف واحد إلى 6 ملفات.", 400);
    const admin = createAdminClient();
    const productId = body.productId || crypto.randomUUID();
    if (typeof productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) throw new PublicJoinError("معرف المنتج غير صالح.", 400);
    if (body.productId) {
      const product = await admin.from("products").select("provider_id,review_status,is_published").eq("id", productId).maybeSingle();
      if (product.error) throw new Error("product_upload_lookup_failed");
      if (!product.data || product.data.provider_id !== provider.providerId) throw new PublicJoinError("المنتج غير موجود ضمن منشأتك.", 404);
      if (product.data.review_status !== "needs_changes" && !(product.data.review_status === "approved" && product.data.is_published)) throw new PublicJoinError("المنتج غير متاح للتعديل الآن.", 409);
    }
    const files = [];
    for (const file of body.files) {
      if (!file || typeof file.name !== "string" || !file.name.trim() || file.name.length > 200 || /[\u0000-\u001f\u007f]/u.test(file.name)
        || typeof file.mimeType !== "string" || !validProductMedia(file.mimeType, file.size)) throw new PublicJoinError("اختر صورة حتى 5MB أو فيديو MP4 أو WebM أو MOV حتى 100MB.", 400);
    }
    for (const file of body.files) {
      const path = `${provider.providerId}/${productId}/uploads/${crypto.randomUUID()}.${extensions[file.mimeType]}`;
      const signed = await admin.storage.from(PRODUCT_MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (signed.error) throw new Error("product_upload_sign_failed");
      files.push({ path, token: signed.data.token, name: file.name, mimeType: file.mimeType, size: file.size });
    }
    const url = new URL(getSupabasePublicEnv().url);
    if (url.hostname.endsWith(".supabase.co")) url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
    return Response.json({ productId, bucket: PRODUCT_MEDIA_BUCKET, endpoint: `${url.origin}/storage/v1/upload/resumable/sign`, files });
  } catch (error) {
    if (error instanceof PublicJoinError) return Response.json({ error: error.message }, { status: error.status });
    console.error("product_media_init_failed");
    return Response.json({ error: "تعذر تجهيز رفع مرفقات المنتج." }, { status: 500 });
  }
}
