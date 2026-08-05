import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, normalizeEmail, normalizeMobile, PublicJoinError, randomObjectName, requiredText, stringArray, validateFiles, verifyTurnstile } from "@/lib/join/security";
import { notifyJoinReviewers } from "@/lib/notifications/join-reviewers";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const uploaded: string[] = [];
  try {
    assertSameOrigin(request);
    const { kind } = await context.params;
    if (kind !== "provider" && kind !== "contractor") throw new PublicJoinError("نوع الطلب غير صالح.", 404);
    const data = await request.formData();
    if (String(data.get("website") || "")) throw new PublicJoinError("تعذر إرسال الطلب.", 400);
    const email = normalizeEmail(data.get("email"));
    const mobile = normalizeMobile(data.get("mobile"));
    enforceRateLimit(request, createHash("sha256").update(`${kind}:${email}:${mobile}`).digest("hex"));
    await verifyTurnstile(String(data.get("turnstileToken") || "") || null, request.headers.get("x-forwarded-for"));
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw new PublicJoinError("تعذر تأكيد معرّف المحاولة. أعد الإرسال.", 400);
    const files = validateFiles(data);
    const supabase = createAdminClient();
    const table = kind === "provider" ? "provider_applications" : "contractor_applications";
    const duplicate = await supabase.from(table).select("id").in("status", ["pending", "needs_changes"]).or(`email.eq.${email},mobile.eq.${mobile}`).limit(1);
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data?.length) throw new PublicJoinError("يوجد طلب نشط مرتبط بالبريد أو الجوال المدخل.", 409);

    const base = kind === "provider"
      ? { applicant_profile_id: null, company_name: requiredText(data, "companyName", 2, 160), contact_name: requiredText(data, "contactName", 2, 120), mobile, email, requested_username: requiredText(data, "username", 4, 40), google_maps_url: requiredText(data, "mapsUrl", 8, 2000), latitude: optionalNumber(data.get("latitude"), -90, 90), longitude: optionalNumber(data.get("longitude"), -180, 180), discount_code: String(data.get("discountCode") || "").trim() || null, delivery_available: data.get("deliveryAvailable") === "true", status: "pending", public_idempotency_key: idempotencyKey }
      : { applicant_profile_id: null, contractor_name: requiredText(data, "contractorName", 3, 160), mobile, email, status: "pending", public_idempotency_key: idempotencyKey };
    const inserted = await supabase.from(table).insert(base as never).select("id,status,created_at").single();
    if (inserted.error) {
      if (inserted.error.code === "23505") throw new PublicJoinError("تم تسجيل هذه المحاولة مسبقًا أو يوجد طلب نشط مماثل.", 409);
      throw inserted.error;
    }
    const applicationId = inserted.data.id as string;
    const categories = kind === "provider" ? stringArray(data, "categories") : [];
    const regions = stringArray(data, "regions");
    const specialties = kind === "contractor" ? stringArray(data, "specialties") : [];
    const detailResults = kind === "provider"
      ? [await supabase.from("provider_application_categories").insert(categories.map((name) => ({ application_id: applicationId, custom_category: name }))), ...(data.get("deliveryAvailable") === "true" ? [await supabase.from("provider_delivery_regions").insert(regions.map((name) => ({ application_id: applicationId, region_name: name })))] : [])]
      : [await supabase.from("contractor_work_regions").insert(regions.map((name) => ({ application_id: applicationId, region_name: name }))), await supabase.from("contractor_specialties").insert(specialties.map((name) => ({ application_id: applicationId, specialty_name: name })))];
    const detailError = detailResults.find((result) => result.error)?.error;
    if (detailError) { await supabase.from(table).delete().eq("id", applicationId); throw detailError; }

    for (const file of files) {
      const objectPath = `join-applications/${kind}/${applicationId}/${randomObjectName()}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await supabase.storage.from("join-applications").upload(objectPath, bytes, { contentType: file.type, upsert: false });
      if (upload.error) throw upload.error;
      uploaded.push(objectPath);
      if (kind === "provider") {
        const registry = await supabase.from("files").insert({ owner_profile_id: null, bucket_id: "join-applications", object_path: objectPath, purpose: "provider_join_document", original_name: file.name, mime_type: file.type, size_bytes: file.size, checksum_sha256: createHash("sha256").update(bytes).digest("hex"), uploaded_at: new Date().toISOString() }).select("id").single();
        if (registry.error) throw registry.error;
        const link = await supabase.from("provider_application_documents").insert({ application_id: applicationId, file_id: registry.data.id, document_type: "supporting_document" });
        if (link.error) throw link.error;
      } else {
        const document = await supabase.from("contractor_documents").insert({ application_id: applicationId, document_type: "supporting_document", storage_path: objectPath, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (document.error) throw document.error;
      }
    }
    await notifyJoinReviewers({kind,applicationId,name:kind==="provider"?String("contact_name" in base?base.contact_name:""):String("contractor_name" in base?base.contractor_name:""),company:kind==="provider"?String("company_name" in base?base.company_name:""):undefined,submittedAt:String(inserted.data.created_at)}).catch(()=>undefined);
    return NextResponse.json({ applicationId, status: inserted.data.status, submittedAt: inserted.data.created_at }, { status: 201 });
  } catch (error) {
    if (uploaded.length) { try { await createAdminClient().storage.from("join-applications").remove(uploaded); } catch {} }
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر حفظ الطلب حاليًا. حاول مرة أخرى لاحقًا." }, { status: 500 });
  }
}

function optionalNumber(value: FormDataEntryValue | null, min: number, max: number) {
  if (value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new PublicJoinError("الإحداثيات غير صالحة.", 400);
  return number;
}
