import { NextRequest, NextResponse } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { assertSameOrigin } from "@/lib/join/security";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const identity = await getAuthIdentity();
    if (!identity || identity.status !== "ready") return NextResponse.json({ error: "يلزم تسجيل الدخول." }, { status: 401 });
    const body = await request.json() as { token?: unknown; platform?: unknown };
    const token = String(body.token ?? "").trim();
    const platform = String(body.platform ?? "");
    if (token.length < 24 || !["android", "ios"].includes(platform)) return NextResponse.json({ error: "بيانات الجهاز غير صالحة." }, { status: 400 });
    const db = await createClient();
    const result = await db.from("push_subscriptions").upsert({ profile_id: identity.userId, token, platform, active: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "token" });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذر تسجيل إشعارات الجهاز." }, { status: 500 });
  }
}
