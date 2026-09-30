import { NextResponse } from "next/server";
import { documentQuery, requireUserDetailAccess, rows, UserDetailError, userDetailFailure, userDetailHeaders, userDetailLinks, userIdPattern } from "@/lib/admin/user-details";
import type { AdminRow } from "@/lib/admin/records";
import { providerDocumentDownload } from "@/lib/join/provider-document-download";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await context.params;
    if (!userIdPattern.test(documentId)) throw new UserDetailError(404, "المستند غير موجود.");
    const access = await requireUserDetailAccess(id);
    const links = await userDetailLinks(access, id);
    const source = new URL(request.url).searchParams.get("source") ?? "files";
    // The same account-scoped, permission-checked query guards both list and download.
    const document = rows(await documentQuery(access, links, id, source, true).eq("id", documentId).limit(1))[0];
    if (!document) throw new UserDetailError(404, "المستند غير موجود لهذا الحساب.");
    const file = (Array.isArray(document.files) ? document.files[0] : document.files) as AdminRow | undefined;
    const metadata = file ?? document;
    if (["quarantined", "rejected"].includes(String(metadata.scan_status))) throw new UserDetailError(403, "المستند محجوب أمنياً.");
    const bucket = String(metadata.bucket_id || (source === "provider" ? "provider-documents" : document.application_id ? "join-applications" : "contractor-documents"));
    const path = String(metadata.object_path || document.storage_path || "");
    if (!path) throw new UserDetailError(404, "ملف المستند غير متاح.");
    // Registry ownership alone is insufficient: uploaded metadata can contain a forged object path.
    const safeSegments = path.split("/").every(part => part && part !== "." && part !== ".." && !/[\\\u0000-\u001f]/.test(part));
    const ownPrefixes = [id, ...links.providerIds, ...links.contractorIds].map(value => `${value}/`);
    const applicationPrefixes = [...links.providerApplicationIds.map(value => `join-applications/provider/${value}/`), ...links.contractorApplicationIds.map(value => `join-applications/contractor/${value}/`)];
    const scoped = source === "provider" ? bucket === "provider-documents" && links.providerIds.some(value => path.startsWith(`${value}/`))
      : source === "provider_application" ? (bucket === "join-applications" && applicationPrefixes.some(value => path.startsWith(value))) || (bucket === "provider-application-documents" && path.startsWith(`${id}/`))
      : source === "contractor" ? (bucket === "join-applications" && applicationPrefixes.some(value => path.startsWith(value))) || (bucket === "contractor-documents" && path.startsWith(`${id}/`))
      : ownPrefixes.some(value => path.startsWith(value)) || (bucket === "join-applications" && applicationPrefixes.some(value => path.startsWith(value)));
    if (!safeSegments || !scoped) throw new UserDetailError(403, "مسار المستند لا يطابق الحساب المرتبط به.");
    if (bucket === "join-applications" && (source === "provider_application" || path.startsWith("join-applications/provider/"))) {
      const applicationId = source === "provider_application" ? String(document.application_id || "") : links.providerApplicationIds.find(value => path.startsWith(`join-applications/provider/${value}/`)) || "";
      if (!links.providerApplicationIds.includes(applicationId)) throw new UserDetailError(403, "مسار المستند لا يطابق الحساب المرتبط به.");
      return providerDocumentDownload(access.admin, path, applicationId, metadata.scan_status);
    }
    const downloaded = await access.admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) throw new UserDetailError(404, "تعذر تنزيل المستند.");
    const filename = String(metadata.original_name || document.file_name || "document");
    const mime = String(metadata.mime_type || "application/octet-stream");
    const safeInline = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime);
    return new NextResponse(downloaded.data, { headers: { ...userDetailHeaders, "Content-Type": safeInline ? mime : "application/octet-stream", "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none';" } });
  } catch (error) { return userDetailFailure(error); }
}
