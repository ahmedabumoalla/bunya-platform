import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Search deadlines advance even when outgoing notifications are temporarily disabled.
export async function GET(request: NextRequest) {
  const configured = Buffer.from(process.env.CRON_SECRET || "");
  const provided = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "");
  if (!configured.length || configured.length !== provided.length || !timingSafeEqual(configured, provided)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await createAdminClient().rpc("process_contractor_searches", { p_limit: 50 });
    if (result.error) throw result.error;
    return NextResponse.json({ searches: result.data });
  } catch {
    return NextResponse.json({ message: "Contractor search unavailable" }, { status: 503 });
  }
}
