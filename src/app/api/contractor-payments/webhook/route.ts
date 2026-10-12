import { NextRequest, NextResponse } from "next/server";
import { verifyPaymobHmac, type PaymobTransaction } from "@/lib/payments/paymob";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyContractorTransaction } from "@/lib/payments/contractor-payments";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 131072) return NextResponse.json({ accepted: false }, { status: 413 });
    const body = JSON.parse(text) as { obj?: PaymobTransaction; hmac?: string };
    if (!body.obj || !verifyPaymobHmac(body.obj, request.nextUrl.searchParams.get("hmac") || body.hmac || null)) return NextResponse.json({ accepted: false }, { status: 401 });
    const result = await applyContractorTransaction(createAdminClient(), body.obj);
    return NextResponse.json({ accepted: true, status: result.status });
  } catch {
    // A callback can arrive before the intention is persisted. Let Paymob retry.
    return NextResponse.json({ accepted: false }, { status: 503 });
  }
}
