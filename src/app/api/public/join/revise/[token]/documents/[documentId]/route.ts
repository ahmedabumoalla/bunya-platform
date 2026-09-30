import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerDocumentDownload, contractorDocumentDownload } from "@/lib/join/provider-document-download";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; documentId: string }> },
) {
  const { token, documentId } = await params;
  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const revision = await admin
    .from("join_application_revision_tokens")
    .select("application_kind,application_id,attempts,max_attempts")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (revision.error || !revision.data || revision.data.attempts >= revision.data.max_attempts) {
    return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });
  }

  const table = revision.data.application_kind === "provider" ? "provider_applications" : "contractor_applications";
  const application = await admin.from(table).select("status").eq("id", revision.data.application_id).maybeSingle();
  if (application.error || application.data?.status !== "needs_changes") {
    return NextResponse.json({ message: "لم يعد المستند متاحًا عبر هذا الرابط." }, { status: 410 });
  }

  let objectPath: string | null = null;

  if (revision.data.application_kind === "provider") {
    const document = await admin
      .from("provider_application_documents")
      .select("files(object_path,original_name,mime_type,bucket_id,scan_status)")
      .eq("application_id", revision.data.application_id)
      .eq("id", documentId)
      .maybeSingle();
    if (document.error) return NextResponse.json({ message: "تعذر تحميل بيانات المستند." }, { status: 500 });
    const file = document.data?.files as unknown as { object_path?: string; original_name?: string; mime_type?: string; bucket_id?: string; scan_status?: string } | null;
    objectPath = file?.object_path ?? null;
    if (!objectPath) return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });
    if (file?.bucket_id !== "join-applications") return NextResponse.json({ message: "المستند غير متاح." }, { status: 403 });
    return providerDocumentDownload(admin, objectPath, revision.data.application_id, file.scan_status);
  } else {
    const document = await admin
      .from("contractor_documents")
      .select("storage_path,file_name,mime_type")
      .eq("application_id", revision.data.application_id)
      .eq("id", documentId)
      .maybeSingle();
    if (document.error) return NextResponse.json({ message: "تعذر تحميل بيانات المستند." }, { status: 500 });
    objectPath = document.data?.storage_path ?? null;
  }

  if (!objectPath) return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });

  return contractorDocumentDownload(admin, objectPath, revision.data.application_id);
}
