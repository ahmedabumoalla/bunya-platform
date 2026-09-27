import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOriginalClient } from "@/lib/supabase/session";
import { assertMaintenanceOrigin, getImpersonation, impersonatedClient } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE, IMPERSONATION_MARKER, openImpersonation } from "@/lib/auth/impersonation-cookie";

export async function GET() {
  try {
    const ticket = await getImpersonation();
    if (!ticket) return NextResponse.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
    const { data, error } = await impersonatedClient(ticket).from("profiles").select("full_name").eq("id", ticket.targetId).single();
    if (error) throw error;
    return NextResponse.json({ active: true, name: data.full_name || "المستخدم", expiresAt: ticket.expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ active: true, expired: true, message: "انتهت صلاحية الدخول بالنيابة. ارجع لحساب الإدارة." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
export async function DELETE(request: Request) {
  try {
    assertMaintenanceOrigin(request);
    const store = await cookies(), ticket = openImpersonation(store.get(IMPERSONATION_COOKIE)?.value);
    if (ticket) {
      const { data } = await (await createOriginalClient()).auth.getUser();
      // Exit remains possible after expiry/revocation. Possession of the sealed ticket
      // can only terminate that ticket; it cannot gain an administrator session.
      if (data.user && data.user.id !== ticket.actorId) return NextResponse.json({ message: "الجلسة لا تخص هذا الحساب." }, { status: 403 });
      const admin = createAdminClient();
      const { error } = await admin.from("admin_impersonation_sessions").update({ ended_at: new Date().toISOString() }).eq("id", ticket.id).is("ended_at", null);
      if (error) throw error;
      await admin.auth.admin.signOut(ticket.accessToken, "local");
    }
    store.delete(IMPERSONATION_COOKIE);
    store.delete(IMPERSONATION_MARKER);
    return NextResponse.json({ redirectTo: "/admin/users" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "تعذر إنهاء الجلسة الآن. حاول مرة أخرى." }, { status: 500 });
  }
}
