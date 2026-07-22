import type { ReactNode } from "react";
import { ProviderShell } from "@/components/provider/ProviderShell";
import {AuthIdentityProvider} from "@/components/auth/AuthIdentityProvider";
import {RoleDatabasePortal} from "@/components/database/RoleDatabasePortal";
import {requirePortalRole} from "@/lib/auth/server";
import "./provider.css";
import "./drivers.css";

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const identity=await requirePortalRole("provider");
  void children;
  return <AuthIdentityProvider identity={identity}><ProviderShell><RoleDatabasePortal role="provider"/></ProviderShell></AuthIdentityProvider>;
}
