import {LoginFlow} from "@/components/LoginFlow";
import {redirect} from "next/navigation";
import {resolveAuthIdentity} from "@/lib/auth/resolve-identity";
import {requiresPhoneVerification} from "@/lib/auth/phone-verification";
import {routeForRole} from "@/lib/auth/types";
import {createClient} from "@/lib/supabase/server";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const supabase=await createClient();
  const [{data},params]=await Promise.all([supabase.auth.getUser(),searchParams]);
  const identity=data.user?await resolveAuthIdentity(supabase,data.user):null;
  if(data.user&&identity&&requiresPhoneVerification(data.user,identity))redirect("/verify-phone");
  if(identity?.status==="ready"&&identity.primaryRole)redirect(routeForRole(identity.primaryRole));
  return <LoginFlow initialError={params.error}/>;
}
