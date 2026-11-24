import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

// Shared parts of حارس السرعة layers 2 and 3. They run on GitHub, outside the platform, and only read public pages

export const AGENT = "Mozilla/5.0 (compatible; BrandaSpeedGuard/1.0)";
export const config = JSON.parse(readFileSync(path.join(process.cwd(), "speed-guard.config.json"), "utf8"));

/** WhatsApp alert through the notifications number. Skipped when the GitHub secrets are not set. Never logs the phone or the token */
export async function sendWhatsApp(message) {
  const { SPEED_GUARD_WA_API_URL: apiUrl, SPEED_GUARD_WA_INSTANCE: instance, SPEED_GUARD_WA_TOKEN: token, SPEED_GUARD_WA_TO: to } = process.env;
  if (config.whatsAppEnabled !== true || !apiUrl || !instance || !token || !to) { console.log("[speed-guard] WhatsApp inactive; alert recorded in the workflow"); return false; }
  const phone = String(to).replace(/\D/g, "");
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/waInstance${instance}/sendMessage/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: `${phone}@c.us`, linkPreview: false, message }),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`[speed-guard] WhatsApp alert ${response.ok ? "sent" : `refused with ${response.status}`}`);
    return response.ok;
  } catch (error) {
    console.log(`[speed-guard] WhatsApp alert failed: ${error instanceof Error ? error.name : "error"}`);
    return false;
  }
}

export function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

export const riyadhTime = (date = new Date()) => date.toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
