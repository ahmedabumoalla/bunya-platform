import type {ReactNode} from "react";
import {AuthIdentityProvider} from "@/components/auth/AuthIdentityProvider";
import {RoleDatabasePortal} from "@/components/database/RoleDatabasePortal";
import {requirePortalRole} from "@/lib/auth/server";
import "./driver.css";
export default async function Layout({children}:{children:ReactNode}){const identity=await requirePortalRole("driver");return <AuthIdentityProvider identity={identity}><RoleDatabasePortal role="driver">{children}</RoleDatabasePortal></AuthIdentityProvider>}
