import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, normalizeEmail, normalizeMobile, PublicJoinError, randomObjectName, requiredText, stringArray, validateFiles, verifyTurnstile } from "@/lib/join/security";
import { isValidJoinUsername } from "@/lib/join/username";
import { notifyJoinReviewers } from "@/lib/notifications/join-reviewers";
import { prepareUpload } from "@/lib/uploads/server";

export const runtime = "nodejs";

function isLocalAppOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch { return false; }
}

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || (origin !== request.nextUrl.origin && !isLocalAppOrigin(request))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const headers = corsHeaders(request);
  return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
}

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const uploaded: string[] = [];
  try {
    if (!isLocalAppOrigin(request)) assertSameOrigin(request);
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

    const requestedUsername = kind === "provider" ? requiredText(data, "username", 4, 40) : "";
    if (kind === "provider" && !isValidJoinUsername(requestedUsername)) {
      throw new PublicJoinError("اسم المستخدم يجب أن يكون من 4 إلى 40 حرفًا وبدون مسافات. استخدم _ أو - للفصل.", 400);
    }
    const base = kind === "provider"
      ? { applicant_profile_id: null, company_name: requiredText(data, "companyName", 2, 160), contact_name: requiredText(data, "contactName", 2, 120), mobile, email, requested_username: requestedUsername, google_maps_url: requiredText(data, "mapsUrl", 8, 2000), latitude: optionalNumber(data.get("latitude"), -90, 90), longitude: optionalNumber(data.get("longitude"), -180, 180), discount_code: String(data.get("discountCode") || "").trim() || null, delivery_available: data.get("deliveryAvailable") === "true", status: "pending", public_idempotency_key: idempotencyKey }
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
      const prepared = await prepareUpload(file);
      const upload = await supabase.storage.from("join-applications").upload(objectPath, prepared.bytes, { contentType: prepared.mimeType, upsert: false });
      if (upload.error) throw upload.error;
      uploaded.push(objectPath);
      if (kind === "provider") {
        const registry = await supabase.from("files").insert({ owner_profile_id: null, bucket_id: "join-applications", object_path: objectPath, purpose: "provider_join_document", original_name: prepared.fileName, mime_type: prepared.mimeType, size_bytes: prepared.size, checksum_sha256: createHash("sha256").update(prepared.bytes).digest("hex"), uploaded_at: new Date().toISOString() }).select("id").single();
        if (registry.error) throw registry.error;
        const link = await supabase.from("provider_application_documents").insert({ application_id: applicationId, file_id: registry.data.id, document_type: "supporting_document" });
        if (link.error) throw link.error;
      } else {
        const document = await supabase.from("contractor_documents").insert({ application_id: applicationId, document_type: "supporting_document", storage_path: objectPath, file_name: prepared.fileName, mime_type: prepared.mimeType, size_bytes: prepared.size });
        if (document.error) throw document.error;
      }
    }
    const applicantName = kind === "provider" ? String("contact_name" in base ? base.contact_name : "") : String("contractor_name" in base ? base.contractor_name : "");
    const notificationDetails = kind === "provider"
      ? [
          { label: "اسم الشركة", value: String("company_name" in base ? base.company_name : "") },
          { label: "اسم المسؤول", value: applicantName },
          { label: "رقم الجوال", value: mobile },
          { label: "البريد الإلكتروني", value: email },
          { label: "اسم المستخدم المطلوب", value: String("requested_username" in base ? base.requested_username : "") },
          { label: "كود الخصم", value: String("discount_code" in base ? base.discount_code ?? "—" : "—") },
          { label: "رابط Google Maps", value: String("google_maps_url" in base ? base.google_maps_url : "") },
          { label: "الإحداثيات", value: "latitude" in base && base.latitude !== null && base.longitude !== null ? `${base.latitude}, ${base.longitude}` : "—" },
          { label: "التصنيفات الرئيسية", value: categories.join("، ") },
          { label: "هل يوجد توصيل؟", value: "delivery_available" in base && base.delivery_available ? "نعم" : "لا" },
          { label: "مناطق التوصيل", value: "delivery_available" in base && base.delivery_available ? regions.join("، ") : "لا يوجد توصيل" },
        ]
      : [
          { label: "اسم المقاول", value: applicantName },
          { label: "رقم الجوال", value: mobile },
          { label: "البريد الإلكتروني", value: email },
          { label: "مناطق العمل", value: regions.join("، ") },
          { label: "التخصصات", value: specialties.join("، ") },
        ];
    await notifyJoinReviewers({ kind, applicationId, applicantEmail: email, applicantName, submittedAt: String(inserted.data.created_at), details: notificationDetails }).catch(() => undefined);
    return NextResponse.json({ applicationId, status: inserted.data.status, submittedAt: inserted.data.created_at }, { status: 201, headers: corsHeaders(request) });
  } catch (error) {
    if (uploaded.length) { try { await createAdminClient().storage.from("join-applications").remove(uploaded); } catch {} }
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status, headers: corsHeaders(request) });
    return NextResponse.json({ message: "تعذر حفظ الطلب حاليًا. حاول مرة أخرى لاحقًا." }, { status: 500, headers: corsHeaders(request) });
  }
}

function optionalNumber(value: FormDataEntryValue | null, min: number, max: number) {
  if (value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new PublicJoinError("الإحداثيات غير صالحة.", 400);
  return number;
}
