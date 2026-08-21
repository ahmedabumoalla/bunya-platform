import { NextRequest, NextResponse } from "next/server";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";

export const runtime = "nodejs";

const MAX_REDIRECTS = 5;

function isAllowedGoogleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return host === "maps.app.goo.gl"
    || host === "goo.gl" && url.pathname.startsWith("/maps")
    || host === "google.com"
    || host.endsWith(".google.com");
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as { url?: unknown };
    const originalUrl = String(body.url ?? "").trim();
    const initial = parseGoogleMapsLink(originalUrl);

    if (initial.kind === "invalid") throw new PublicJoinError(initial.message, 400);
    if (initial.kind !== "short-link") return NextResponse.json(initial);

    enforceRateLimit(request, `maps:${originalUrl}`);
    let current = new URL(originalUrl);

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (!isAllowedGoogleMapsUrl(current)) throw new PublicJoinError("أعاد الرابط التوجيه إلى نطاق غير مسموح.", 400);

      const parsed = parseGoogleMapsLink(current.toString());
      if (parsed.kind === "coordinates") {
        return NextResponse.json({
          ...parsed,
          url: originalUrl,
          message: "تم فك الرابط واستخراج الإحداثيات بنجاح.",
        });
      }

      const response = await fetch(current, {
        cache: "no-store",
        redirect: "manual",
        headers: { "user-agent": "BunyaPlatform/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current);
    }

    return NextResponse.json({
      url: originalUrl,
      kind: "maps-link",
      message: "الرابط صالح، لكن تعذر العثور على إحداثيات صريحة داخله.",
    });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر تحليل رابط Google Maps حاليًا. حاول مجددًا." }, { status: 502 });
  }
}
