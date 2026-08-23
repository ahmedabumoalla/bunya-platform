import { NextResponse } from "next/server";
import { requireJoinReviewer } from "@/lib/join/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string; id: string; documentId: string }> },
) {
  const auth = await requireJoinReviewer(request);
  if ("error" in auth) {
    return NextResponse.json(
      { message: "غير مصرح بعرض هذا المستند." },
      { status: auth.error === "unauthorized" ? 401 : 403 },
    );
  }

  const { kind, id, documentId } = await context.params;
  if (kind !== "provider" && kind !== "contractor") {
    return NextResponse.json({ message: "المسار غير صالح." }, { status: 404 });
  }

  let objectPath: string | null = null;
  let fileName = "document";
  let mimeType = "application/octet-stream";

  if (kind === "provider") {
    const document = await auth.admin
      .from("provider_application_documents")
      .select("id,files(object_path,original_name,mime_type)")
      .eq("application_id", id)
      .eq("id", documentId)
      .maybeSingle();

    if (document.error) {
      return NextResponse.json({ message: "تعذر تحميل بيانات المستند." }, { status: 500 });
    }

    const file = document.data?.files as unknown as {
      object_path?: string;
      original_name?: string;
      mime_type?: string;
    } | null;
    objectPath = file?.object_path ?? null;
    fileName = file?.original_name ?? fileName;
    mimeType = file?.mime_type ?? mimeType;
  } else {
    const document = await auth.admin
      .from("contractor_documents")
      .select("storage_path,file_name,mime_type")
      .eq("application_id", id)
      .eq("id", documentId)
      .maybeSingle();

    if (document.error) {
      return NextResponse.json({ message: "تعذر تحميل بيانات المستند." }, { status: 500 });
    }

    objectPath = document.data?.storage_path ?? null;
    fileName = document.data?.file_name ?? fileName;
    mimeType = document.data?.mime_type ?? mimeType;
  }

  if (!objectPath) {
    return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });
  }

  const { url } = getSupabasePublicEnv();
  const storageKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!storageKey) {
    return NextResponse.json({ message: "مفتاح تخزين Supabase غير مضبوط." }, { status: 500 });
  }

  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const downloaded = await fetch(`${url}/storage/v1/object/authenticated/join-applications/${encodedPath}`, {
    cache: "no-store",
    headers: {
      apikey: storageKey,
      Authorization: `Bearer ${storageKey}`,
    },
  });

  if (!downloaded.ok || !downloaded.body) {
    return NextResponse.json({ message: "تعذر تنزيل المستند من التخزين." }, { status: 500 });
  }

  return new NextResponse(downloaded.body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
