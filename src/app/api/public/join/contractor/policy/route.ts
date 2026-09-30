import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { policyParagraphs } from "@/lib/policies/registry";

export async function GET(request: NextRequest) {
  const headers: Record<string, string> = { "Cache-Control": "no-store, max-age=0", Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (origin === request.nextUrl.origin || ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) headers["Access-Control-Allow-Origin"] = origin; } catch {}
  }
  const { data, error } = await createAdminClient().from("platform_policies").select("id,title,version,body,updated_at").eq("policy_key", "contractor-join").eq("is_published", true).maybeSingle();
  if (error) return NextResponse.json({ message: "تعذر تحميل سياسة الانضمام." }, { status: 503, headers });
  const body = policyParagraphs(data?.body).map(paragraph => paragraph.trim()).filter(Boolean);
  return NextResponse.json({ policy: data && body.length ? { id: data.id, title: data.title, version: data.version, body, updatedAt: data.updated_at } : null }, { headers });
}
