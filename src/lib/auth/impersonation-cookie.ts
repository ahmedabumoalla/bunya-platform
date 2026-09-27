import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const IMPERSONATION_COOKIE = "bunya-maintenance";
export const IMPERSONATION_MARKER = "bunya-maintenance-active";
export type ImpersonationTicket = {
  id: string; actorId: string; actorSessionId: string; targetId: string;
  targetSessionId: string; accessToken: string; expiresAt: number;
};
function key() {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Server authentication is unavailable.");
  return Buffer.from(hkdfSync("sha256", secret, "bunya-maintenance-v1", "http-only-session", 32));
}
export function sealImpersonation(ticket: ImpersonationTicket) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(ticket), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url");
}
export function openImpersonation(value?: string): ImpersonationTicket | null {
  if (!value || value.length > 6000) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const ticket = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"));
    if (![ticket.id, ticket.actorId, ticket.actorSessionId, ticket.targetId, ticket.targetSessionId].every(isUuid) ||
      typeof ticket.accessToken !== "string" || !Number.isFinite(ticket.expiresAt)) return null;
    return ticket as ImpersonationTicket;
  } catch { return null; }
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
// Only inspect tokens already verified by Supabase; this is not token validation.
export function sessionId(accessToken: string) {
  const value = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")).session_id;
  if (!isUuid(value)) throw new Error("A verified session is required.");
  return value;
}
