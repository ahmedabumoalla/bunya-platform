import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

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
  let fileName = "document";
  let mimeType = "application/octet-stream";

  if (revision.data.application_kind === "provider") {
    const document = await admin
      .from("provider_application_documents")
      .select("files(object_path,original_name,mime_type)")
      .eq("application_id", revision.data.application_id)
      .eq("id", documentId)
      .maybeSingle();
    const file = document.data?.files as unknown as { object_path?: string; original_name?: string; mime_type?: string } | null;
    objectPath = file?.object_path ?? null;
    fileName = file?.original_name ?? fileName;
    mimeType = file?.mime_type ?? mimeType;
  } else {
    const document = await admin
      .from("contractor_documents")
      .select("storage_path,file_name,mime_type")
      .eq("application_id", revision.data.application_id)
      .eq("id", documentId)
      .maybeSingle();
    objectPath = document.data?.storage_path ?? null;
    fileName = document.data?.file_name ?? fileName;
    mimeType = document.data?.mime_type ?? mimeType;
  }

  if (!objectPath) return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });

  const { url } = getSupabasePublicEnv();
  const storageKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!storageKey) return NextResponse.json({ message: "تعذر عرض المستند." }, { status: 500 });
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const downloaded = await fetch(`${url}/storage/v1/object/authenticated/join-applications/${encodedPath}`, {
    cache: "no-store",
    headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` },
  });
  if (!downloaded.ok || !downloaded.body) return NextResponse.json({ message: "تعذر عرض المستند." }, { status: 500 });

  return new NextResponse(downloaded.body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
