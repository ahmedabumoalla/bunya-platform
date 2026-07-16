"use client";
import {useEffect} from "react";
import {usePathname,useRouter} from "next/navigation";
import {currentRoleSession} from "@/lib/driver-storage";
const roots={customer:"/customer",provider:"/merchant",contractor:"/contractor",driver:"/driver",admin:"/admin"} as const;
export function PwaRuntime(){const router=useRouter();const pathname=usePathname();useEffect(()=>{if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>undefined)}const standalone=window.matchMedia('(display-mode: standalone)').matches;if(standalone&&pathname==='/'){const session=currentRoleSession();if(session)router.replace(roots[session.role])}},[pathname,router]);return null}
