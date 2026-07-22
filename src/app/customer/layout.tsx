import type {ReactNode} from "react";
import {CustomerShell} from "@/components/customer/CustomerShell";
import {AuthIdentityProvider} from "@/components/auth/AuthIdentityProvider";
import {RoleDatabasePortal} from "@/components/database/RoleDatabasePortal";
import {requirePortalRole} from "@/lib/auth/server";
import "./customer.css";
export default async function CustomerLayout({children}:{children:ReactNode}){void children;const identity=await requirePortalRole("customer");return <AuthIdentityProvider identity={identity}><CustomerShell><RoleDatabasePortal role="customer"/></CustomerShell></AuthIdentityProvider>}
