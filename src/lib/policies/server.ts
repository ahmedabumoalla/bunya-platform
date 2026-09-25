import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PublishedPolicy = { id: string; policy_key: string; title: string; summary: string; body: unknown; version: number; published_at: string | null; updated_at: string };
export async function publishedPolicy(key: string): Promise<PublishedPolicy | null> {
  const db = await createClient();
  const { data, error } = await db.from("platform_policies").select("id,policy_key,title,summary,body,version,published_at,updated_at").eq("policy_key", key).eq("is_published", true).maybeSingle();
  if (error) return null;
  return data;
}
