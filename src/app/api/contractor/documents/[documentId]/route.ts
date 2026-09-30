import { NextResponse } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contractorDocumentDownload } from "@/lib/join/provider-document-download";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const identity = await getAuthIdentity();
  if (!identity) return NextResponse.json({ message: "سجّل دخولك أولاً." }, { status: 401, headers });
  if (identity.status !== "ready" || identity.profile?.mustChangePassword || !identity.activeRoles.includes("contractor") || !identity.details.contractor) {
    return NextResponse.json({ message: "لا تملك صلاحية عرض هذا المستند." }, { status: 403, headers });
  }
  const { documentId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
    return NextResponse.json({ message: "المستند غير موجود." }, { status: 404, headers });
  }
  const admin = createAdminClient();
  const document = await admin.from("contractor_documents").select("application_id,storage_path")
    .eq("id", documentId).eq("contractor_profile_id", identity.details.contractor.contractorProfileId)
    .eq("is_current", true).maybeSingle();
  if (document.error) return NextResponse.json({ message: "تعذر تحميل بيانات المستند." }, { status: 500, headers });
  if (!document.data?.application_id || !document.data.storage_path) return NextResponse.json({ message: "المستند غير موجود." }, { status: 404, headers });
  // Document metadata is owner-writable: independently bind the application to this account.
  const application = await admin.from("contractor_applications").select("id")
    .eq("id", document.data.application_id).eq("applicant_profile_id", identity.userId).maybeSingle();
  if (application.error) return NextResponse.json({ message: "تعذر التحقق من المستند." }, { status: 500, headers });
  if (!application.data) return NextResponse.json({ message: "المستند غير موجود لهذا الحساب." }, { status: 404, headers });
  return contractorDocumentDownload(admin, document.data.storage_path, application.data.id);
}
