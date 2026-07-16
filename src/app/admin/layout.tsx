import type {ReactNode} from "react";
import {AdminShell} from "@/components/admin/AdminShell";
import {RoleGuard} from "@/components/RoleGuard";
import "./admin.css";
export default function AdminLayout({children}:{children:ReactNode}){return <RoleGuard role="admin"><AdminShell>{children}</AdminShell></RoleGuard>}
