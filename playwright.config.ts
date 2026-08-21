import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

const harnessSeed = "bunya-e2e-20260813-034000-e19f73";
const hookSecret = createHash("sha256").update(`${harnessSeed}:hook`).digest("base64");
const paymentSecret = createHash("sha256").update(`${harnessSeed}:payment`).digest("hex");
const cronSecret = createHash("sha256").update(`${harnessSeed}:cron`).digest("hex");

process.env.E2E_HOOK_SECRET = hookSecret;
process.env.PAYMENT_EVENTS_SECRET = paymentSecret;
process.env.CRON_SECRET = cronSecret;
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --experimental-websocket node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-e2e",
      APP_URL: "http://127.0.0.1:3100",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      GREEN_API_URL: "http://127.0.0.1:3199",
      GREEN_API_MEDIA_URL: "http://127.0.0.1:3199",
      GREEN_API_ID_INSTANCE: "e2e-instance",
      GREEN_API_TOKEN_INSTANCE: "e2e-token",
      GREEN_API_SEND_DELAY_MS: "0",
      RESEND_API_URL: "http://127.0.0.1:3199/resend/emails",
      RESEND_API_KEY: "e2e-resend-key",
      RESEND_FROM_EMAIL: "e2e@invalid.example",
      SUPABASE_SEND_SMS_HOOK_SECRET: `whsec_${hookSecret}`,
      PAYMENT_EVENTS_SECRET: paymentSecret,
      CRON_SECRET: cronSecret,
      NOTIFICATIONS_ENABLED: "true",
    },
  },
});
