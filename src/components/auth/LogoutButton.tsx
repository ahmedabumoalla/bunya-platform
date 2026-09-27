"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    if (document.cookie.split("; ").includes("bunya-maintenance-active=1")) {
      const response = await fetch("/api/maintenance", { method: "DELETE" });
      if (response.ok) window.location.assign("/admin/users");
      else setBusy(false);
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <button className={className} title={title} type="button" disabled={busy} onClick={logout}>
      {children}
    </button>
  );
}
