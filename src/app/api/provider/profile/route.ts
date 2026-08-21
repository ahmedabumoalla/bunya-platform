import { NextRequest, NextResponse } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { allowedMimeTypes, assertSameOrigin, normalizeEmail, normalizeMobile, PublicJoinError, randomObjectName } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function requireProvider() {
  const identity = await getAuthIdentity();
  const provider = identity?.details.provider;
  if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider") || !provider) throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعال.", 401);
  return { identity, provider };
}
const text = (form: FormData, key: string, max = 500) => String(form.get(key) || "").normalize("NFKC").trim().slice(0, max) || null;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { identity, provider } = await requireProvider();
    const form = await request.formData();
    const action = String(form.get("action") || "save");
    const admin = createAdminClient();
    if (action === "document") {
      const file = form.get("file");
      const documentType = String(form.get("documentType") || "");
      if (!(file instanceof File) || !allowedMimeTypes.has(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new PublicJoinError("المستند يجب أن يكون PDF أو صورة وبحد أقصى 10 ميجابايت.", 400);
      if (!['commercial_registration','vat_certificate','national_address','bank_certificate','license','other'].includes(documentType)) throw new PublicJoinError("نوع المستند غير صالح.", 400);
      const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
      const storagePath = `${provider.providerId}/${randomObjectName()}.${extension}`;
      const uploaded = await admin.storage.from("provider-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploaded.error) throw new Error("document_upload_failed");
      const saved = await admin.from("provider_documents").insert({ provider_id: provider.providerId, document_type: documentType, document_number: text(form, "documentNumber", 120), storage_path: storagePath, file_name: file.name.slice(0, 255), mime_type: file.type, size_bytes: file.size, expires_at: text(form, "expiresAt", 10) }).select("id").single();
      if (saved.error) { await admin.storage.from("provider-documents").remove([storagePath]); throw new Error("document_save_failed"); }
      await admin.from("audit_logs").insert({ actor_profile_id: identity.userId, entity_table: "provider_documents", entity_id: saved.data.id, action: "provider_document_uploaded", new_data: { provider_id: provider.providerId, document_type: documentType } });
      return NextResponse.json({ id: saved.data.id }, { status: 201 });
    }

    const companyName = text(form, "companyName", 160);
    const contactName = text(form, "contactName", 120);
    if (!companyName || companyName.length < 2 || !contactName || contactName.length < 2) throw new PublicJoinError("اسم المنشأة واسم المسؤول مطلوبان.", 400);
    const core = { company_name: companyName, contact_name: contactName, mobile: normalizeMobile(form.get("mobile")), email: normalizeEmail(form.get("email")), google_maps_url: text(form, "googleMapsUrl", 500) };
    const profile = {
      provider_id: provider.providerId, public_description: text(form, "publicDescription", 2000), username: text(form, "username", 40),
      commercial_registration_number: text(form, "commercialRegistrationNumber", 80), vat_number: text(form, "vatNumber", 80),
      national_address_short_code: text(form, "nationalAddressShortCode", 20), building_number: text(form, "buildingNumber", 20),
      street_name: text(form, "streetName", 150), district: text(form, "district", 100), city: text(form, "city", 100), region: text(form, "region", 100),
      postal_code: text(form, "postalCode", 20), secondary_number: text(form, "secondaryNumber", 20), country: text(form, "country", 80) || "السعودية", website_url: text(form, "websiteUrl", 500),
      delivery_available: form.get("deliveryAvailable") === "true", sensitive_changes_pending_review: true,
    };
    const logo = form.get("logo");
    let logoPath: string | null = null;
    if (logo instanceof File && logo.size > 0) {
      if (!new Set(["image/jpeg","image/png","image/webp"]).has(logo.type) || logo.size > 5 * 1024 * 1024) throw new PublicJoinError("الشعار يجب أن يكون صورة وبحد أقصى 5 ميجابايت.", 400);
      const extension = logo.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
      logoPath = `${provider.providerId}/logo-${randomObjectName()}.${extension}`;
      const uploaded = await admin.storage.from("provider-logos").upload(logoPath, logo, { contentType: logo.type, upsert: false });
      if (uploaded.error) throw new Error("logo_upload_failed");
    }
    const providerUpdate = await admin.from("providers").update({ ...core, ...(logoPath ? { logo_path: logoPath } : {}) }).eq("id", provider.providerId);
    const profileUpdate = await admin.from("provider_profiles").upsert(profile, { onConflict: "provider_id" });
    const settingsUpdate = await admin.from("provider_settings").upsert({ provider_id: provider.providerId, delivery_available: profile.delivery_available }, { onConflict: "provider_id" });
    if (providerUpdate.error || profileUpdate.error || settingsUpdate.error) { if (logoPath) await admin.storage.from("provider-logos").remove([logoPath]); throw new Error("profile_save_failed"); }
    await admin.from("audit_logs").insert({ actor_profile_id: identity.userId, entity_table: "providers", entity_id: provider.providerId, action: "provider_profile_updated", new_data: { provider_id: provider.providerId, logo_updated: Boolean(logoPath) } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("provider_profile_failed", { code: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "تعذر حفظ ملف المنشأة حاليًا." }, { status: 500 });
  }
}
