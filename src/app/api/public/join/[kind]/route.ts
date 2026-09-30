import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, enforceRateLimit, normalizeEmail, normalizeMobile, PublicJoinError, verifyTurnstile } from "@/lib/join/security";
import { submitProvider } from "@/lib/join/submit-provider";
import { submitContractor } from "@/lib/join/submit-contractor";
import { readBoundedBytes } from "@/lib/join/provider-upload-batches";

export const runtime = "nodejs";

function isLocalAppOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch { return false; }
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || (origin !== request.nextUrl.origin && !isLocalAppOrigin(request))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const headers = corsHeaders(request);
  return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
}

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  try {
    if (!isLocalAppOrigin(request)) assertSameOrigin(request);
    const { kind } = await context.params;
    if (kind !== "provider" && kind !== "contractor") throw new PublicJoinError("نوع الطلب غير صالح.", 404);
    const data = kind === "contractor"
      ? await new Response(await readBoundedBytes(request.body, 128 * 1024), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData()
      : await request.formData();
    if (String(data.get("website") || "")) throw new PublicJoinError("تعذر إرسال الطلب.", 400);
    const email = normalizeEmail(data.get("email"));
    const mobile = normalizeMobile(data.get("mobile"));
    enforceRateLimit(request, createHash("sha256").update(`${kind}:${email}:${mobile}`).digest("hex"));
    // A verified, identity-bound upload batch already passed Turnstile at initiation.
    if (!data.has("uploadToken")) await verifyTurnstile(String(data.get("turnstileToken") || "") || null, request.headers.get("x-forwarded-for"));
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw new PublicJoinError("تعذر تأكيد معرّف المحاولة. أعد الإرسال.", 400);
    const receipt = kind === "provider" ? await submitProvider(data, idempotencyKey) : await submitContractor(data, idempotencyKey);
    return NextResponse.json(receipt, { status: 201, headers: corsHeaders(request) });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status, headers: corsHeaders(request) });
    return NextResponse.json({ message: "تعذر حفظ الطلب حاليًا. حاول مرة أخرى لاحقًا." }, { status: 500, headers: corsHeaders(request) });
  }
}
