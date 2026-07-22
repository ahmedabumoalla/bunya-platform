"use client";
import {useEffect} from "react";
import {usePathname,useRouter} from "next/navigation";
import {resolveAuthIdentity} from "@/lib/auth/resolve-identity";
import {routeForRole} from "@/lib/auth/types";
import {createClient} from "@/lib/supabase/client";

export function PwaRuntime(){const router=useRouter();const pathname=usePathname();useEffect(()=>{if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>undefined)}const standalone=window.matchMedia('(display-mode: standalone)').matches;if(!standalone||pathname!=='/')return;let active=true;const restore=async()=>{const supabase=createClient();const{data}=await supabase.auth.getUser();if(!active||!data.user)return;const identity=await resolveAuthIdentity(supabase,data.user);if(active&&identity.status==="ready"&&identity.primaryRole)router.replace(routeForRole(identity.primaryRole))};void restore();return()=>{active=false}},[pathname,router]);return null}
