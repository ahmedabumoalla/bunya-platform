import type { ReactNode } from "react";
import { ProviderShell } from "@/components/provider/ProviderShell";
import {RoleGuard} from "@/components/RoleGuard";
import "./provider.css";
import "./drivers.css";

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return <RoleGuard role="provider"><ProviderShell>{children}</ProviderShell></RoleGuard>;
}
