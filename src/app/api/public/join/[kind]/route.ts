import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, normalizeEmail, normalizeMobile, PublicJoinError, randomObjectName, requiredText, stringArray, validateFiles, verifyTurnstile } from "@/lib/join/security";
import { submitProvider } from "@/lib/join/submit-provider";
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

function corsHeaders(request: NextRequest): Record<string, string> {
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
  let createdApplication: { table: "provider_applications" | "contractor_applications"; id: string } | null = null;
  try {
    if (!isLocalAppOrigin(request)) assertSameOrigin(request);
    const { kind } = await context.params;
    if (kind !== "provider" && kind !== "contractor") throw new PublicJoinError("نوع الطلب غير صالح.", 404);
    const data = await request.formData();
    if (String(data.get("website") || "")) throw new PublicJoinError("تعذر إرسال الطلب.", 400);
    const email = normalizeEmail(data.get("email"));
    const mobile = normalizeMobile(data.get("mobile"));
    enforceRateLimit(request, createHash("sha256").update(`${kind}:${email}:${mobile}`).digest("hex"));
    // A verified, identity-bound upload batch already passed Turnstile at initiation.
    if (!(kind === "provider" && data.has("uploadToken"))) await verifyTurnstile(String(data.get("turnstileToken") || "") || null, request.headers.get("x-forwarded-for"));
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw new PublicJoinError("تعذر تأكيد معرّف المحاولة. أعد الإرسال.", 400);
    if (kind === "provider") {
      const receipt = await submitProvider(data, idempotencyKey);
      return NextResponse.json(receipt, { status: 201, headers: corsHeaders(request) });
    }
    const files = validateFiles(data);
    const supabase = createAdminClient();
    const table = "contractor_applications";
    const duplicate = await supabase.from(table).select("id").in("status", ["pending", "needs_changes"]).or(`email.eq.${email},mobile.eq.${mobile}`).limit(1);
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data?.length) throw new PublicJoinError("يوجد طلب نشط مرتبط بالبريد أو الجوال المدخل.", 409);

    const regions = stringArray(data, "regions");
    const specialties = stringArray(data, "specialties");
    const base = { applicant_profile_id: null, contractor_name: requiredText(data, "contractorName", 3, 160), mobile, email, status: "pending", public_idempotency_key: idempotencyKey };
    const inserted = await supabase.from(table).insert(base as never).select("id,status,created_at").single();
    if (inserted.error) {
      if (inserted.error.code === "23505") throw new PublicJoinError("تم تسجيل هذه المحاولة مسبقًا أو يوجد طلب نشط مماثل.", 409);
      throw inserted.error;
    }
    const applicationId = inserted.data.id as string;
    createdApplication = { table, id: applicationId };
    const detailResults = [await supabase.from("contractor_work_regions").insert(regions.map((name) => ({ application_id: applicationId, region_name: name }))), await supabase.from("contractor_specialties").insert(specialties.map((name) => ({ application_id: applicationId, specialty_name: name })))];
    const detailError = detailResults.find((result) => result.error)?.error;
    if (detailError) { await supabase.from(table).delete().eq("id", applicationId); createdApplication = null; throw detailError; }

    for (const file of files) {
      const objectPath = `join-applications/${kind}/${applicationId}/${randomObjectName()}`;
      const prepared = await prepareUpload(file);
      const upload = await supabase.storage.from("join-applications").upload(objectPath, prepared.bytes, { contentType: prepared.mimeType, upsert: false });
      if (upload.error) throw upload.error;
      uploaded.push(objectPath);
        const document = await supabase.from("contractor_documents").insert({ application_id: applicationId, document_type: "supporting_document", storage_path: objectPath, file_name: prepared.fileName, mime_type: prepared.mimeType, size_bytes: prepared.size });
        if (document.error) throw document.error;
    }
    const applicantName = base.contractor_name;
    const notificationDetails = [
      { label: "اسم المقاول", value: applicantName }, { label: "رقم الجوال", value: mobile },
      { label: "البريد الإلكتروني", value: email }, { label: "مناطق العمل", value: regions.join("، ") },
      { label: "التخصصات", value: specialties.join("، ") },
    ];
    await notifyJoinReviewers({ kind, applicationId, applicantEmail: email, applicantName, submittedAt: String(inserted.data.created_at), details: notificationDetails }).catch(() => undefined);
    return NextResponse.json({ applicationId, status: inserted.data.status, submittedAt: inserted.data.created_at }, { status: 201, headers: corsHeaders(request) });
  } catch (error) {
    if (uploaded.length || createdApplication) {
      try {
        const admin = createAdminClient();
        if (uploaded.length) await admin.storage.from("join-applications").remove(uploaded);
        if (createdApplication) await admin.from(createdApplication.table).delete().eq("id", createdApplication.id);
      } catch {}
    }
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status, headers: corsHeaders(request) });
    return NextResponse.json({ message: "تعذر حفظ الطلب حاليًا. حاول مرة أخرى لاحقًا." }, { status: 500, headers: corsHeaders(request) });
  }
}
