import { NextRequest, NextResponse } from "next/server";
import { customerManagedDeliveryCode, managedQuoteContext, ManagedQuoteError } from "@/lib/quotes/managed-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await managedQuoteContext(request);
    const result = await customerManagedDeliveryCode(context, (await route.params).id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof ManagedQuoteError ? error.message : "تعذر إظهار رمز التسليم بأمان." }, { status: error instanceof ManagedQuoteError ? error.status : 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
