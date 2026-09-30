import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitContractor } from "@/lib/join/submit-contractor";
import { submitProvider } from "@/lib/join/submit-provider";
import { readBoundedBytes } from "@/lib/join/provider-upload-batches";

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

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const found = await resolveToken(token);
  if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });

  const application = found.record.application_kind === "provider"
    ? await found.admin
        .from("provider_applications")
        .select("id,email,mobile,company_name,company_name_en,service_cities,contact_name,requested_username,username_is_custom,google_maps_url,latitude,longitude,delivery_available,status,review_notes,provider_application_categories(custom_category,product_categories(name)),provider_delivery_regions(region_name),provider_application_documents(id,document_type,is_current,files(original_name))")
        .eq("id", found.record.application_id)
        .maybeSingle()
    : await found.admin
        .from("contractor_applications")
        .select("id,email,mobile,contractor_type,contractor_name,contractor_name_en,contact_name,requested_username,username_is_custom,status,review_notes,contractor_work_regions(region_name),contractor_specialties(specialty_name),contractor_documents(id,file_name,document_key,document_type,is_current)")
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
    : ((row.contractor_documents as { id: string; file_name: string; document_key: string; document_type: string; is_current: boolean }[] | undefined) ?? []).filter(item => item.is_current !== false).map((item) => ({
        id: item.id,
        documentKey: item.document_key,
        documentType: item.document_type,
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
  try {
    assertSameOrigin(request);
    const token = (await params).token;
    const found = await resolveToken(token);
    if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });
    const data = found.record.application_kind === "contractor"
      ? await new Response(await readBoundedBytes(request.body, 128 * 1024), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData()
      : await request.formData();
    const revision = { applicationId: found.record.application_id, token };
    const receipt = found.record.application_kind === "provider"
      ? await submitProvider(data, null, revision) : await submitContractor(data, null, revision);
    return NextResponse.json(receipt);
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر حفظ التعديلات." }, { status: 500 });
  }
}
