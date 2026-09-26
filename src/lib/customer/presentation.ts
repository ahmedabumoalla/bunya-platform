export function customerReadableText(
  value: unknown,
  fallback = "النص المحفوظ غير مقروء. تواصل مع الدعم.",
): string {
  if (value === null || value === undefined) return "غير مذكور";
  const text = String(value);
  if (!text.trim()) return "غير مذكور";
  return /\?{3,}|\uFFFD/.test(text) ? fallback : text;
}

export function customerMapUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const directMapHosts = ["maps.app.goo.gl", "maps.google.com", "maps.google.com.sa"];
    const googleHosts = ["google.com", "www.google.com", "google.com.sa", "www.google.com.sa", "goo.gl"];
    if (!directMapHosts.includes(host) && !(googleHosts.includes(host) && /^\/maps(?:\/|$)/.test(url.pathname))) return null;
    return url.href;
  } catch {
    return null;
  }
}
