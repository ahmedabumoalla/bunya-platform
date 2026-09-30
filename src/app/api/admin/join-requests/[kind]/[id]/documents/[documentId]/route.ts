import { NextResponse } from "next/server";
import { requireJoinReviewer } from "@/lib/join/admin";
import { providerDocumentDownload, contractorDocumentDownload } from "@/lib/join/provider-document-download";

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

  if (kind === "provider") {
    const document = await auth.admin
      .from("provider_application_documents")
      .select("id,files(object_path,original_name,mime_type,bucket_id,scan_status)")
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
      bucket_id?: string;
      scan_status?: string;
    } | null;
    objectPath = file?.object_path ?? null;
    if (!objectPath) return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });
    if (file?.bucket_id !== "join-applications") return NextResponse.json({ message: "المستند غير متاح." }, { status: 403 });
    return providerDocumentDownload(auth.admin, objectPath, id, file.scan_status);
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
  }

  if (!objectPath) {
    return NextResponse.json({ message: "المستند غير موجود." }, { status: 404 });
  }

  return contractorDocumentDownload(auth.admin, objectPath, id);
}
