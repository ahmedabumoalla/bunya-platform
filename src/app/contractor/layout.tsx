import type {ReactNode} from "react";
import {ContractorShell} from "@/components/contractor/ContractorShell";
import {RoleGuard} from "@/components/RoleGuard";
import "./contractor.css";
export default function ContractorLayout({children}:{children:ReactNode}){return <RoleGuard role="contractor"><ContractorShell>{children}</ContractorShell></RoleGuard>}
