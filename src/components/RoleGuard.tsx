/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import type {ReactNode} from "react";
import {useEffect,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import type {LocalRole} from "@/lib/driver-types";
import {currentRoleSession,driverStorageKeys} from "@/lib/driver-storage";

const roleRoot:Record<LocalRole,string>={customer:"/customer",provider:"/merchant",contractor:"/contractor",driver:"/driver",admin:"/admin"};
export function RoleGuard({role,children}:{role:LocalRole;children:ReactNode}){const router=useRouter();const pathname=usePathname();const[allowed,setAllowed]=useState(false);useEffect(()=>{const session=currentRoleSession();if(!session||session.role!==role){localStorage.setItem("bunya-auth-return-to",pathname);router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);return}localStorage.setItem(driverStorageKeys.lastRoleRoute,roleRoot[role]);setAllowed(true)},[pathname,role,router]);return allowed?children:<div className="portal-route-guard">جارٍ التحقق من صلاحية الوصول…</div>}
