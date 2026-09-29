import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOrigin,
  normalizeEmail,
  normalizeMobile,
  PublicJoinError,
  randomObjectName,
  requiredText,
  stringArray,
  validateFiles,
} from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareUpload } from "@/lib/uploads/server";
import { submitProvider } from "@/lib/join/submit-provider";

export const runtime = "nodejs";

type RevisionToken = {
  id: string;
  application_kind: "provider" | "contractor";
  application_id: string;
  attempts: number;
  max_attempts: number;
};

async function resolveToken(token: string) {
  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await admin
    .from("join_application_revision_tokens")
    .select("id,application_kind,application_id,attempts,max_attempts")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (result.error || !result.data) return null;
  const record = result.data as RevisionToken;
  if (record.attempts >= record.max_attempts) return null;
  return { admin, record };
}

async function consumeAttempt(admin: ReturnType<typeof createAdminClient>, record: RevisionToken) {
  await admin
    .from("join_application_revision_tokens")
    .update({ attempts: record.attempts + 1 })
    .eq("id", record.id)
    .eq("attempts", record.attempts)
    .is("used_at", null);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const found = await resolveToken(token);
  if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });

  const application = found.record.application_kind === "provider"
    ? await found.admin
        .from("provider_applications")
        .select("id,email,mobile,company_name,company_name_en,service_cities,contact_name,requested_username,google_maps_url,latitude,longitude,delivery_available,status,review_notes,provider_application_categories(custom_category,product_categories(name)),provider_delivery_regions(region_name),provider_application_documents(id,document_type,is_current,files(original_name))")
        .eq("id", found.record.application_id)
        .maybeSingle()
    : await found.admin
        .from("contractor_applications")
        .select("id,email,mobile,contractor_name,status,review_notes,contractor_work_regions(region_name),contractor_specialties(specialty_name),contractor_documents(id,file_name)")
        .eq("id", found.record.application_id)
        .maybeSingle();

  if (application.error || !application.data) {
    return NextResponse.json({ message: "الطلب غير موجود." }, { status: 404 });
  }
  if (application.data.status !== "needs_changes") {
    return NextResponse.json({ message: "تم استخدام رابط التعديل أو لم يعد الطلب متاحًا للتعديل." }, { status: 410 });
  }

  const row = application.data as Record<string, unknown>;
  const categories = ((row.provider_application_categories as Record<string, unknown>[] | undefined) ?? []).map((item) => {
    const standard = item.product_categories as { name?: string } | null;
    return standard?.name || String(item.custom_category || "");
  }).filter(Boolean);
  const regions = found.record.application_kind === "provider"
    ? ((row.provider_delivery_regions as { region_name: string }[] | undefined) ?? []).map((item) => item.region_name)
    : ((row.contractor_work_regions as { region_name: string }[] | undefined) ?? []).map((item) => item.region_name);
  const specialties = ((row.contractor_specialties as { specialty_name: string }[] | undefined) ?? []).map((item) => item.specialty_name);
  const documents = found.record.application_kind === "provider"
    ? ((row.provider_application_documents as Record<string, unknown>[] | undefined) ?? []).filter(item => item.is_current !== false).map((item) => ({
        id: String(item.id),
        documentType: String(item.document_type),
        name: String((item.files as { original_name?: string } | null)?.original_name || "مستند"),
        url: `/api/public/join/revise/${encodeURIComponent(token)}/documents/${item.id}`,
      }))
    : ((row.contractor_documents as { id: string; file_name: string }[] | undefined) ?? []).map((item) => ({
        id: item.id,
        name: item.file_name,
        url: `/api/public/join/revise/${encodeURIComponent(token)}/documents/${item.id}`,
      }));
  const availableCategories = found.record.application_kind === "provider"
    ? (await found.admin.from("product_categories").select("name").eq("is_active", true).order("sort_order")).data?.map((item) => item.name) ?? []
    : [];

  return NextResponse.json(
    {
      kind: found.record.application_kind,
      application: {
        ...row,
        provider_application_categories: undefined,
        provider_delivery_regions: undefined,
        provider_application_documents: undefined,
        contractor_work_regions: undefined,
        contractor_specialties: undefined,
        contractor_documents: undefined,
        categories,
        regions,
        specialties,
        documents,
      },
      availableCategories,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let found: Awaited<ReturnType<typeof resolveToken>> = null;
  const uploaded: string[] = [];
  const contractorDocumentIds: string[] = [];
  try {
    assertSameOrigin(request);
    found = await resolveToken((await params).token);
    if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });

    const data = await request.formData();
    if (found.record.application_kind === "provider") {
      const receipt = await submitProvider(data, null, { applicationId: found.record.application_id, token: (await params).token });
      return NextResponse.json(receipt);
    }
    const email = normalizeEmail(data.get("email"));
    const mobile = normalizeMobile(data.get("mobile"));
    const files = validateFiles(data);
    const applicationId = found.record.application_id;
    const kind = found.record.application_kind;
    const table = "contractor_applications";
    const current = await found.admin.from(table).select("id,status").eq("id", applicationId).maybeSingle();
    if (current.error || !current.data) throw new PublicJoinError("الطلب غير موجود.", 404);
    if (current.data.status !== "needs_changes") throw new PublicJoinError("لم يعد الطلب متاحًا للتعديل.", 409);

    const documentTable = "contractor_documents";
    const existingDocuments = await found.admin.from(documentTable).select("id", { count: "exact", head: true }).eq("application_id", applicationId);
    if (existingDocuments.error) throw existingDocuments.error;
    if ((existingDocuments.count ?? 0) + files.length > 5) {
      throw new PublicJoinError("الحد الأقصى خمسة مستندات إجمالًا. ارفع الملفات المصححة المطلوبة فقط.", 400);
    }

    const regions = stringArray(data, "regions");
    const specialties = stringArray(data, "specialties");
    const update = { contractor_name: requiredText(data, "contractorName", 3, 160), email, mobile };

    for (const file of files) {
      const prepared = await prepareUpload(file);
      const objectPath = `join-applications/${kind}/${applicationId}/${randomObjectName()}`;
      const storage = await found.admin.storage.from("join-applications").upload(objectPath, prepared.bytes, {
        contentType: prepared.mimeType,
        upsert: false,
      });
      if (storage.error) throw storage.error;
      uploaded.push(objectPath);

        const linked = await found.admin.from("contractor_documents").insert({
          application_id: applicationId,
          document_type: "supporting_document",
          storage_path: objectPath,
          file_name: prepared.fileName,
          mime_type: prepared.mimeType,
          size_bytes: prepared.size,
        }).select("id").single();
        if (linked.error) throw linked.error;
        contractorDocumentIds.push(linked.data.id);
    }

      const removedRegions = await found.admin.from("contractor_work_regions").delete().eq("application_id", applicationId);
      if (removedRegions.error) throw removedRegions.error;
      const savedRegions = await found.admin.from("contractor_work_regions").insert(regions.map((name) => ({ application_id: applicationId, region_name: name })));
      if (savedRegions.error) throw savedRegions.error;

      const removedSpecialties = await found.admin.from("contractor_specialties").delete().eq("application_id", applicationId);
      if (removedSpecialties.error) throw removedSpecialties.error;
      const savedSpecialties = await found.admin.from("contractor_specialties").insert(specialties.map((name) => ({ application_id: applicationId, specialty_name: name })));
      if (savedSpecialties.error) throw savedSpecialties.error;

    const result = await found.admin.from(table).update({
      ...update,
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
    }).eq("id", applicationId).eq("status", "needs_changes").select("id").maybeSingle();

    if (result.error) throw result.error;
    if (!result.data) throw new PublicJoinError("لم يعد الطلب بانتظار التعديلات.", 409);

    await found.admin.from("join_application_revision_tokens").update({
      used_at: new Date().toISOString(),
      attempts: found.record.attempts + 1,
    }).eq("id", found.record.id).is("used_at", null);

    return NextResponse.json({ status: "pending" });
  } catch (error) {
    if (found) {
      if (uploaded.length) await found.admin.storage.from("join-applications").remove(uploaded).catch(() => undefined);

      if (contractorDocumentIds.length) {
        await found.admin.from("contractor_documents").delete().in("id", contractorDocumentIds);
      }
      await consumeAttempt(found.admin, found.record);
    }
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر حفظ التعديلات." }, { status: 500 });
  }
}
