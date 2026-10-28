import type { NextRequest } from "next/server";
import { createAuthRequestClient } from "@/lib/auth/request-client";
import { ARCHIVE_ACTORS, ARCHIVE_SCHEMA } from "@/lib/supabase/archive-fetch";
import { downloadArchiveAsset } from "@/lib/supabase/archive-server";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await createAuthRequestClient(request);
  if (auth.error || !auth.user || !ARCHIVE_ACTORS.has(auth.user.id)) return new Response(null, { status: 403 });
  const { path } = await context.params;
  if (path.length < 2 || path.some(part => !part || part === "." || part === ".." || /[\\/%\u0000-\u001f]/.test(part))) return new Response(null, { status: 404 });
  const [bucket, ...segments] = path;
  // The immutable manifest's RLS preserves the original actor's file scope.
  const visible = await auth.supabase.schema(ARCHIVE_SCHEMA).from("archive_storage_objects").select("id,metadata").eq("bucket_id", bucket).eq("name", segments.join("/")).maybeSingle();
  if (visible.error || !visible.data) return new Response(null, { status: 404 });
  const file = await downloadArchiveAsset(auth.user.id, bucket, segments.join("/"));
  if (!file?.data || file.error) return new Response(null, { status: 404 });
  const mime = file.data.type || "application/octet-stream";
  const inline = ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(mime);
  return new Response(file.data, { headers: {
    "Content-Type": inline ? mime : "application/octet-stream", "Cache-Control": "private, no-store",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(segments.at(-1)!)}`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
  } });
}
