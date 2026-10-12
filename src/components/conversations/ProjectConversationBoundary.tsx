"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ProjectConversationBoundary({ projectId, children }: { projectId: string; children: ReactNode }) {
  const router = useRouter();
  const [legacyId, setLegacyId] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void createClient().from("contractor_conversations").select("id").eq("project_id", projectId).maybeSingle().then(result => {
      if (!active) return;
      if (result.error) setError(true);
      else if (result.data) router.replace(`/contractor/conversations?id=${result.data.id}`);
      else setLegacyId(projectId);
    });
    return () => { active = false; };
  }, [projectId, router]);
  if (error) return <p role="alert">تعذر تحميل الاتفاق. حدّث الصفحة لإعادة المحاولة.</p>;
  return legacyId === projectId ? children : <p role="status">جارٍ فتح الاتفاق الموثق…</p>;
}
