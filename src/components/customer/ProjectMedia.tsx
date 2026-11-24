"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./ProjectMedia.module.css";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
export const mediaAccept = Object.keys(extensions).join(",");
export function mediaError(files: File[]) {
  if (files.length > 8) return "اختر حتى ٨ ملفات للمشروع.";
  const bad = files.find(file => !extensions[file.type] || file.size === 0 || file.size > 50 * 1024 * 1024);
  return bad ? `تحقق من صيغة وحجم الملف «${bad.name}». الحد الأقصى ٥٠ ميغابايت للملف.` : "";
}

export async function stageProjectMedia(files: File[], uploaded: Map<File, string>, progress: (label: string) => void) {
  const client = createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("سجّل الدخول مجددًا لرفع المرفقات.");
  const attachments = [];
  for (const [i, file] of files.entries()) {
    progress(`جارٍ رفع الملف ${i + 1} من ${files.length}…`);
    let path = uploaded.get(file);
    if (!path || !path.startsWith(user.id + "/")) {
      path = `${user.id}/media/${crypto.randomUUID()}.${extensions[file.type]}`;
      const { error } = await client.storage.from("project-media").upload(path, file, {contentType: file.type});
      if (error) throw new Error(`تعذر رفع «${file.name}». تحقق من الاتصال وأعد المحاولة.`);
      uploaded.set(file, path);
    }
    attachments.push({path, name: file.name.slice(0,240)});
  }
  return attachments;
}

type Media = { storage_path: string; file_name: string; mime_type: string; url: string };

export function ProjectMediaGallery({ projectId }: { projectId: string }) {
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const client = createClient();
    async function load() {
      const list = await client.rpc("project_visible_media", {p_project_id: projectId});
      if (list.error) throw list.error;
      const rows = (list.data ?? []) as Omit<Media,"url">[];
      if (!rows.length) { if (active) setMedia([]); return; }
      const signed = await client.storage.from("project-media").createSignedUrls(rows.map(row => row.storage_path), 3600);
      if (signed.error) throw signed.error;
      const urls = new Map(signed.data.map(item => [item.path, item.signedUrl]));
      const items = rows.map(row => {
        const url = urls.get(row.storage_path);
        if (!url) throw new Error("media unavailable");
        return {...row, url};
      });
      if (active) setMedia(items);
    }
    void load().catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [projectId, attempt]);

  return <section className={styles.gallery} aria-label="صور وفيديوهات المشروع">
    <h2>صور وفيديوهات المشروع</h2>
    {!error && !media.length && <p>{loaded ? "لم يرفق العميل صورًا أو فيديوهات لهذا المشروع." : "جارٍ تحميل المرفقات…"}</p>}
    {error && <p role="status">تعذر تحميل بعض المرفقات. <button type="button" onClick={() => { setError(false); setAttempt(n => n + 1); }}>إعادة التحميل</button></p>}
    <div className={styles.grid}>{media.map(item => <figure key={item.storage_path}>
      {item.mime_type.startsWith("video/")
        ? <video controls playsInline preload="metadata" aria-label={item.file_name} src={item.url} onError={() => setError(true)}/>
        : <a href={item.url} target="_blank" rel="noreferrer" aria-label={`فتح الصورة بالحجم الكامل: ${item.file_name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Private, short-lived Storage URL. */}
            <img loading="lazy" src={item.url} alt={item.file_name} onError={() => setError(true)}/>
          </a>}
      <figcaption>{item.file_name}{item.mime_type.startsWith("video/") && <> · <a href={item.url} target="_blank" rel="noreferrer">فتح الفيديو</a></>}</figcaption>
    </figure>)}</div>
  </section>;
}
