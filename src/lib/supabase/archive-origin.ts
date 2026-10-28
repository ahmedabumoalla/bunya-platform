import "server-only";
import { headers } from "next/headers";
import { getSiteUrl } from "./env";

export async function archiveProxyOrigin() {
  if (process.env.NODE_ENV === "development") {
    const host = (await headers()).get("host") ?? "";
    if (/^(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/.test(host)) return `http://${host}`;
  }
  // Never forward user credentials to an arbitrary Host/X-Forwarded-Host value.
  return new URL(getSiteUrl()).origin;
}
