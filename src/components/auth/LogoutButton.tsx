"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clearLegacyAuthStorage } from "@/lib/auth/legacy-cleanup";
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
    const supabase = createClient();
    await supabase.auth.signOut();
    clearLegacyAuthStorage();
    router.replace("/login");
    router.refresh();
  };

  return (
    <button className={className} title={title} type="button" disabled={busy} onClick={logout}>
      {children}
    </button>
  );
}
