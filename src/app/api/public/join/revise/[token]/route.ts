import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, normalizeEmail, normalizeMobile, PublicJoinError } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const found = await resolveToken((await params).token);
  if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });

  const application = found.record.application_kind === "provider"
    ? await found.admin.from("provider_applications").select("id,email,mobile,company_name,contact_name").eq("id", found.record.application_id).maybeSingle()
    : await found.admin.from("contractor_applications").select("id,email,mobile,contractor_name").eq("id", found.record.application_id).maybeSingle();

  if (application.error || !application.data) {
    return NextResponse.json({ message: "الطلب غير موجود." }, { status: 404 });
  }

  return NextResponse.json({ kind: found.record.application_kind, application: application.data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let found: Awaited<ReturnType<typeof resolveToken>> = null;
  try {
    assertSameOrigin(request);
    found = await resolveToken((await params).token);
    if (!found) return NextResponse.json({ message: "الرابط غير صالح أو منتهي." }, { status: 410 });

    const data = await request.formData();
    const name = String(data.get("name") || "").trim();
    if (name.length < 3 || name.length > 160) throw new PublicJoinError("الاسم غير صالح.", 400);
    const email = normalizeEmail(data.get("email"));
    const mobile = normalizeMobile(data.get("mobile"));

    const result = found.record.application_kind === "provider"
      ? await found.admin.from("provider_applications").update({
          email,
          mobile,
          company_name: name,
          contact_name: String(data.get("contactName") || "").trim(),
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
        }).eq("id", found.record.application_id).eq("status", "needs_changes").select("id").maybeSingle()
      : await found.admin.from("contractor_applications").update({
          email,
          mobile,
          contractor_name: name,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
        }).eq("id", found.record.application_id).eq("status", "needs_changes").select("id").maybeSingle();

    if (result.error) throw result.error;
    if (!result.data) throw new PublicJoinError("لم يعد الطلب بانتظار التعديلات.", 409);

    await found.admin.from("join_application_revision_tokens").update({
      used_at: new Date().toISOString(),
      attempts: found.record.attempts + 1,
    }).eq("id", found.record.id).is("used_at", null);

    return NextResponse.json({ status: "pending" });
  } catch (error) {
    if (found) await consumeAttempt(found.admin, found.record);
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر حفظ التعديلات." }, { status: 500 });
  }
}
