import type {ReactNode} from "react";
import {AdminShell} from "@/components/admin/AdminShell";
import {AuthIdentityProvider} from "@/components/auth/AuthIdentityProvider";
import {RoleDatabasePortal} from "@/components/database/RoleDatabasePortal";
import {requirePortalRole} from "@/lib/auth/server";
import "./admin.css";
export default async function AdminLayout({children}:{children:ReactNode}){void children;const identity=await requirePortalRole("admin");return <AuthIdentityProvider identity={identity}><AdminShell><RoleDatabasePortal role="admin"/></AdminShell></AuthIdentityProvider>}
