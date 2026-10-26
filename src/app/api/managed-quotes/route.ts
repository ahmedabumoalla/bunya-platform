import { NextRequest, NextResponse } from "next/server";
import { managedQuoteContext, ManagedQuoteError, visibleManagedQuote } from "@/lib/quotes/managed-server";
import type { ManagedQuote } from "@/lib/quotes/managed-types";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await managedQuoteContext(request);
    const adminScope = request.nextUrl.searchParams.get("scope") === "admin";
    if (adminScope && !context.canManage) throw new ManagedQuoteError(403, "لا تملك صلاحية التسعير.");
    const page = Number(request.nextUrl.searchParams.get("page") || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new ManagedQuoteError(400, "رقم الصفحة غير صالح.");
    let query = context.admin.from("managed_quote_requests").select("*", { count: "exact" });
    if (!adminScope) query = query.eq("customer_id", context.userId);
    const result = await query.order("created_at", { ascending: false }).range(page * 50, page * 50 + 49);
    if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل عروض الأسعار.");
    return NextResponse.json({ requests: (result.data as ManagedQuote[]).map(row => visibleManagedQuote(row, adminScope)), count: result.count ?? 0, canManage: adminScope }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof ManagedQuoteError ? error.message : "تعذر تحميل البيانات." }, { status: error instanceof ManagedQuoteError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
