"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ClientAuthIdentity } from "@/lib/auth/types";

const AuthIdentityContext = createContext<ClientAuthIdentity | null>(null);

export function AuthIdentityProvider({
  identity,
  children,
}: {
  identity: ClientAuthIdentity;
  children: ReactNode;
}) {
  return <AuthIdentityContext value={identity}>{children}</AuthIdentityContext>;
}

export function useAuthIdentity() {
  const identity = useContext(AuthIdentityContext);
  if (!identity) throw new Error("useAuthIdentity must be used inside AuthIdentityProvider.");
  return identity;
}
