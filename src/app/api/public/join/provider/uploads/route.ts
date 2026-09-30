import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, enforceRateLimit, normalizeEmail, normalizeMobile, PublicJoinError, stringArray, verifyTurnstile } from "@/lib/join/security";
import { providerFields, providerPolicyAcceptance } from "@/lib/join/provider-validation";
import { beginProviderUpload, readBoundedBytes } from "@/lib/join/provider-upload-batches";

export const runtime = "nodejs";
function headers(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = origin && (origin === request.nextUrl.origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key", Vary: "Origin" } : {};
}
export function OPTIONS(request: NextRequest) {
  const cors = headers(request);
  return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
}
export async function POST(request: NextRequest) {
  try {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.get("origin") || "")) assertSameOrigin(request);
    enforceRateLimit(request, "provider-upload");
    if (Number(request.headers.get("content-length") || 0) > 128 * 1024) throw new PublicJoinError("أرسل بيانات المستندات فقط لبدء الرفع.", 413);
    const bytes = await readBoundedBytes(request.body, 128 * 1024);
    const data = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    if ([...data.values()].some(value => value instanceof File) || String(data.get("website") || "")) throw new PublicJoinError("تعذر بدء الرفع.", 400);
    normalizeEmail(data.get("email")); normalizeMobile(data.get("mobile")); providerFields(data);
    stringArray(data, "categories");
    if (data.get("deliveryAvailable") === "true") stringArray(data, "regions");
    await verifyTurnstile(String(data.get("turnstileToken") || "") || null, request.headers.get("x-forwarded-for"));
    await providerPolicyAcceptance(data);
    return NextResponse.json(await beginProviderUpload(data, request.headers.get("idempotency-key")), { headers: { ...headers(request), "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof PublicJoinError ? error.message : "تعذر بدء رفع المستندات. أعد المحاولة." }, { status: error instanceof PublicJoinError ? error.status : 500, headers: headers(request) });
  }
}
