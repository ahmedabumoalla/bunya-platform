import type {ReactNode} from "react";
import {CustomerShell} from "@/components/customer/CustomerShell";
import {RoleGuard} from "@/components/RoleGuard";
import "./customer.css";
export default function CustomerLayout({children}:{children:ReactNode}){return <RoleGuard role="customer"><CustomerShell>{children}</CustomerShell></RoleGuard>}
