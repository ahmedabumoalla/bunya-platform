import "server-only";

import { createSign } from "node:crypto";
import { connect } from "node:http2";
import { createAdminClient } from "@/lib/supabase/admin";

type PushPayload = { title: string; body: string; url: string };
type Subscription = { platform: "android" | "ios"; token: string };
let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

async function googleAccessToken() {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.value;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const account = JSON.parse(raw) as { client_email: string; private_key: string; project_id: string };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key.replaceAll("\\n", "\n"));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }) });
  if (!response.ok) throw new Error("fcm_auth_failed");
  const data = await response.json() as { access_token: string; expires_in: number };
  cachedGoogleToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sendAndroid(token: string, payload: PushPayload) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const accessToken = await googleAccessToken();
  if (!raw || !accessToken) return false;
  const projectId = (JSON.parse(raw) as { project_id: string }).project_id;
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { token, notification: { title: payload.title, body: payload.body }, data: { url: payload.url } } }) });
  return response.ok;
}

function appleJwt() {
  const keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID, key = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !key) return null;
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${base64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))}`;
  const signature = createSign("SHA256").update(unsigned).sign({ key: key.replaceAll("\\n", "\n"), dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(signature)}`;
}

async function sendIos(token: string, payload: PushPayload) {
  const jwt = appleJwt(), topic = process.env.APNS_BUNDLE_ID;
  if (!jwt || !topic) return false;
  return new Promise<boolean>((resolve) => {
    const client = connect(process.env.APNS_USE_SANDBOX === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
    client.on("error", () => resolve(false));
    const request = client.request({ ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${jwt}`, "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10" });
    let status = 0;
    request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    request.on("end", () => { client.close(); resolve(status === 200); });
    request.on("error", () => { client.close(); resolve(false); });
    request.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: payload.url }));
  });
}

export async function sendNativePush(profileId: string, payload: PushPayload) {
  const admin = createAdminClient();
  const result = await admin.from("push_subscriptions").select("platform,token").eq("profile_id", profileId).eq("active", true);
  if (result.error || !result.data?.length) return { sent: 0 };
  const attempts = await Promise.allSettled((result.data as Subscription[]).map((item) => item.platform === "android" ? sendAndroid(item.token, payload) : sendIos(item.token, payload)));
  return { sent: attempts.filter((item) => item.status === "fulfilled" && item.value).length };
}
