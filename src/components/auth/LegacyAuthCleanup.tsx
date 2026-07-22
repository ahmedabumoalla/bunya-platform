"use client";

import { useEffect } from "react";
import { clearLegacyAuthStorage } from "@/lib/auth/legacy-cleanup";

export function LegacyAuthCleanup() {
  useEffect(() => clearLegacyAuthStorage(), []);
  return null;
}
