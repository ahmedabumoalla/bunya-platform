/** Visits by the speed guard («حارس السرعة») and other Lighthouse runs never count in site statistics */
export const SPEED_GUARD_AGENT = "BrandaSpeedGuard";

export function isSpeedGuardVisit(): boolean {
  try {
    const agent = typeof navigator === "undefined" ? "" : String(navigator.userAgent ?? "");
    return agent.includes(SPEED_GUARD_AGENT) || agent.includes("Chrome-Lighthouse");
  } catch {
    return false;
  }
}
