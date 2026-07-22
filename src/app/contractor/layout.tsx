import type {ReactNode} from "react";
import {ContractorShell} from "@/components/contractor/ContractorShell";
import {AuthIdentityProvider} from "@/components/auth/AuthIdentityProvider";
import {RoleDatabasePortal} from "@/components/database/RoleDatabasePortal";
import {requirePortalRole} from "@/lib/auth/server";
import "./contractor.css";
export default async function ContractorLayout({children}:{children:ReactNode}){void children;const identity=await requirePortalRole("contractor");return <AuthIdentityProvider identity={identity}><ContractorShell><RoleDatabasePortal role="contractor"/></ContractorShell></AuthIdentityProvider>}
