import { NextRequest, NextResponse } from "next/server";

import { loadPublicContractors } from "@/lib/contractors/server";

export const runtime = "nodejs";

const localAppOrigins = new Set(["http://127.0.0.1:8090", "http://localhost:8090"]);

function responseHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  };

  if (origin && localAppOrigins.has(origin)) {
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }

  return headers;
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: responseHeaders(request) });
}

export async function GET(request: NextRequest) {
  try {
    const contractors = await loadPublicContractors();
    return NextResponse.json(
      { contractors },
      { headers: responseHeaders(request) },
    );
  } catch (error) {
    console.error("public_contractor_directory_failed", { code: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json(
      { message: "تعذر تحميل دليل المقاولين حاليًا." },
      { status: 500, headers: responseHeaders(request) },
    );
  }
}
