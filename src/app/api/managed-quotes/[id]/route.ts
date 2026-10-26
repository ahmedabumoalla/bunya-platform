import { NextRequest, NextResponse } from "next/server";
import { managedQuoteContext, ManagedQuoteError, readManagedQuote, visibleManagedQuote, issueManagedDeliveryCode } from "@/lib/quotes/managed-server";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) { return response({ message: error instanceof ManagedQuoteError ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى." }, error instanceof ManagedQuoteError ? error.status : 500); }
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, route: Context) {
  try {
    const context = await managedQuoteContext(request);
    const row = await readManagedQuote(context, (await route.params).id);
    return response({ request: visibleManagedQuote(row, context.canManage), canManage: context.canManage });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, route: Context) {
  try {
    const context = await managedQuoteContext(request);
    const id = (await route.params).id;
    const row = await readManagedQuote(context, id);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !["save_quote", "publish_quote", "accept", "reject", "confirm_delivery", "reissue_code"].includes(body.action)) throw new ManagedQuoteError(400, "عملية غير صالحة.");
    const adminAction = ["save_quote", "publish_quote", "confirm_delivery", "reissue_code"].includes(body.action);
    if (adminAction ? !context.canManage : !context.isCustomer || row.customer_id !== context.userId) throw new ManagedQuoteError(403, "لا تملك صلاحية هذه العملية.");
    if (body.action === "reissue_code") {
      await issueManagedDeliveryCode(context, id, true);
      return response({ request: visibleManagedQuote(await readManagedQuote(context, id), true), message: "أعيد إصدار الرمز، ويظهر للعميل في حسابه." });
    }
    if (body.action === "confirm_delivery") {
      if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new ManagedQuoteError(400, "أدخل رمز التسليم المكون من 6 أرقام.");
      const result = await context.admin.rpc("managed_quote_confirm_delivery", { p_actor: context.userId, p_request_id: id, p_plain_code: body.code });
      if (result.error) throw new ManagedQuoteError(409, "لا يمكن تأكيد التسليم في الحالة الحالية.");
      if (!result.data?.ok) return response({ message: "الرمز غير صحيح أو منتهي أو مقفل. تحقق منه أو أعد إصداره للعميل.", attemptsRemaining: result.data?.attempts_remaining }, 409);
      return response({ request: visibleManagedQuote(await readManagedQuote(context, id), true), message: "تم إثبات التسليم وتسجيل العملية." });
    }
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new ManagedQuoteError(400, "حدّث صفحة العرض ثم حاول مجددًا.");
    if (adminAction && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))) throw new ManagedQuoteError(400, "بيانات التسعير غير صالحة.");
    const result = await context.admin.rpc("managed_quote_command", { p_actor: context.userId, p_request_id: id, p_action: body.action,
      p_payload: { ...(adminAction ? body.payload : {}), revision: body.revision } });
    if (result.error) throw new ManagedQuoteError(409, "تعذر حفظ العملية. راجع الأسعار والمواعيد والوحدات، وحدّث الصفحة إذا تغير العرض.");
    return response({ request: visibleManagedQuote(await readManagedQuote(context, id), context.canManage), message: "تم حفظ العملية." });
  } catch (error) { return failure(error); }
}
