import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanupProviderUploads } from "@/lib/join/provider-upload-batches";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ removed: await cleanupProviderUploads() }); }
  catch { return NextResponse.json({ message: "Cleanup unavailable" }, { status: 503 }); }
}
