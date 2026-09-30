import "server-only";
import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Call only after establishing the caller's access to this document/application. */
export async function providerDocumentDownload(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  applicationId: string,
  scanStatus?: unknown,
  kind: "provider" | "contractor" = "provider",
) {
  const segments = path.split("/");
  const safe = segments.length >= 4 && segments.every(segment => segment && segment !== "." && segment !== ".." && !/[\\%\u0000-\u001f\u007f]/u.test(segment));
  if (!safe || !applicationId || segments[0] !== "join-applications" || segments[1] !== kind || segments[2] !== applicationId
    || ["quarantined", "rejected"].includes(String(scanStatus))) {
    return NextResponse.json({ message: "المستند غير متاح أو لا يطابق الطلب المرتبط به." }, { status: 403 });
  }
  const signed = await admin.storage.from("join-applications").createSignedUrl(path, 300);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ message: "تعذر عرض المستند." }, { status: 500 });
  return new NextResponse(null, { status: 307, headers: {
    Location: signed.data.signedUrl,
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
  } });
}

/** The caller must first authorize this exact contractor application and document. */
export function contractorDocumentDownload(admin: ReturnType<typeof createAdminClient>, path: string, applicationId: string, scanStatus?: unknown) {
  return providerDocumentDownload(admin, path, applicationId, scanStatus, "contractor");
}
