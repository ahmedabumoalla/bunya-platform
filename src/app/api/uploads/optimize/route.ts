import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin, enforceRateLimit } from "@/lib/join/security";
import { prepareVideoUpload } from "@/lib/uploads/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "يجب تسجيل الدخول لمعالجة الفيديو." }, { status: 401 });
    enforceRateLimit(request, `video-optimize:${user.id}`);

    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File) || file.type !== "video/mp4" || file.size < 1 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ message: "فيديو MP4 غير صالح أو أكبر من 10MB." }, { status: 400 });
    }

    const prepared = await prepareVideoUpload(file);
    return new Response(Buffer.from(prepared.bytes), {
      headers: {
        "cache-control": "no-store",
        "content-length": String(prepared.size),
        "content-type": prepared.mimeType,
        "x-upload-file-name": encodeURIComponent(prepared.fileName),
      },
    });
  } catch {
    return NextResponse.json({ message: "تعذر ضغط الفيديو حاليًا." }, { status: 500 });
  }
}
