import "server-only";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
export async function requireAdminPermission(permission:string){const session=await createClient();const {data}=await session.auth.getUser();if(!data.user)return{error:"unauthorized" as const};const allowed=await session.rpc("admin_has_permission",{requested_permission:permission});if(allowed.error||allowed.data!==true)return{error:"forbidden" as const};return{userId:data.user.id,admin:createAdminClient()}}
