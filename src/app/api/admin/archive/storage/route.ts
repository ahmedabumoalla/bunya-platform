import type { NextRequest } from "next/server";
import { createAuthRequestClient } from "@/lib/auth/request-client";
import { ARCHIVE_ACTORS, ARCHIVE_SCHEMA } from "@/lib/supabase/archive-fetch";
import { signArchiveAsset } from "@/lib/supabase/archive-server";

export async function POST(request: NextRequest) {
  const auth = await createAuthRequestClient(request);
  if (auth.error || !auth.user || !ARCHIVE_ACTORS.has(auth.user.id)) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 32768) return new Response(null, { status: 413 });
  const body = await request.json().catch(() => null);
  const paths: unknown[] = body?.path ? [body.path] : body?.paths;
  if (typeof body?.bucket !== "string" || !/^[a-z0-9-]+$/.test(body.bucket) || !Array.isArray(paths) || !paths.length || paths.length > 100
    || paths.some(path => typeof path !== "string" || path.length > 2048 || path.split("/").some(part => !part || part === "." || part === ".." || /[\\%\u0000-\u001f]/.test(part)))) return new Response(null, { status: 400 });
  const visible = await auth.supabase.schema(ARCHIVE_SCHEMA).from("archive_storage_objects").select("name").eq("bucket_id", body.bucket).in("name", paths);
  if (visible.error) return new Response(null, { status: 403 });
  const allowed = new Set((visible.data ?? []).map(row => row.name));
  const ttl = Math.min(21600, Math.max(1, Math.floor(Number(body.expiresIn) || 300)));
  const results = [];
  for (const path of paths as string[]) {
    if (!allowed.has(path)) { results.push({ path, error: "File not found", signedURL: null }); continue; }
    const signed = await signArchiveAsset(auth.user.id, body.bucket, path, ttl);
    if (!signed?.data || signed.error) { results.push({ path, error: "File not found", signedURL: null }); continue; }
    const url = new URL(signed.data.signedUrl);
    results.push({ path, error: null, signedURL: url.pathname.replace(/^\/storage\/v1/, "") + url.search });
  }
  if (body.path && results[0].error) return Response.json({ message: "File not found" }, { status: 404 });
  return Response.json(body.path ? { signedURL: results[0].signedURL } : results, { headers: { "Cache-Control": "private, no-store" } });
}
