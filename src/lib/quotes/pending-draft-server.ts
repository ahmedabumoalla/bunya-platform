import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PendingStorefrontQuote } from "./pending-draft";

export const pendingQuoteCookie = "bunya_pending_quote";

export function createPendingQuoteToken() {
  return randomBytes(32).toString("base64url");
}

export function isPendingQuoteToken(value?: string) {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function readPendingQuote(token: string) {
  const result = await createAdminClient()
    .from("pending_quote_drafts")
    .select("payload")
    .eq("token_hash", tokenHash(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.payload ?? null;
}

export async function savePendingQuote(token: string, draft: PendingStorefrontQuote) {
  const now = new Date();
  const result = await createAdminClient().from("pending_quote_drafts").upsert({
    token_hash: tokenHash(token),
    payload: draft,
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "token_hash" });
  if (result.error) throw result.error;
}

export async function deletePendingQuote(token?: string) {
  if (!isPendingQuoteToken(token)) return;
  const result = await createAdminClient().from("pending_quote_drafts").delete().eq("token_hash", tokenHash(token!));
  if (result.error) throw result.error;
}

export const pendingQuoteCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 24 * 60 * 60,
  priority: "high" as const,
};
