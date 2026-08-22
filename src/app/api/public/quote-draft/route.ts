import { NextRequest, NextResponse } from "next/server";
import { normalizePendingStorefrontQuote } from "@/lib/quotes/pending-draft";
import {
  createPendingQuoteToken,
  deletePendingQuote,
  isPendingQuoteToken,
  pendingQuoteCookie,
  pendingQuoteCookieOptions,
  readPendingQuote,
  savePendingQuote,
} from "@/lib/quotes/pending-draft-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(pendingQuoteCookie)?.value;
  if (!isPendingQuoteToken(token)) return NextResponse.json({ draft: null });
  try {
    return NextResponse.json({ draft: await readPendingQuote(token!) });
  } catch {
    return NextResponse.json({ message: "تعذر استعادة طلب عرض السعر المحفوظ." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 100_000) return NextResponse.json({ message: "حجم الطلب أكبر من المسموح." }, { status: 413 });
  const draft = normalizePendingStorefrontQuote(await request.json().catch(() => null));
  if (!draft) return NextResponse.json({ message: "بيانات طلب عرض السعر غير صالحة." }, { status: 400 });

  const currentToken = request.cookies.get(pendingQuoteCookie)?.value;
  const token = isPendingQuoteToken(currentToken) ? currentToken! : createPendingQuoteToken();
  try {
    await savePendingQuote(token, draft);
    const response = NextResponse.json({ saved: true });
    response.cookies.set(pendingQuoteCookie, token, pendingQuoteCookieOptions);
    return response;
  } catch {
    return NextResponse.json({ message: "تعذر حفظ الطلب قبل تسجيل الدخول." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(pendingQuoteCookie)?.value;
  try {
    await deletePendingQuote(token);
  } catch {
    return NextResponse.json({ message: "تعذر حذف المسودة." }, { status: 500 });
  }
  const response = NextResponse.json({ deleted: true });
  response.cookies.set(pendingQuoteCookie, "", { ...pendingQuoteCookieOptions, maxAge: 0 });
  return response;
}
