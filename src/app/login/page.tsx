import {LoginFlow} from "@/components/LoginFlow";
import {redirect} from "next/navigation";
import {resolveAuthIdentity} from "@/lib/auth/resolve-identity";
import {routeForRole} from "@/lib/auth/types";
import {createClient} from "@/lib/supabase/server";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const supabase=await createClient();
  const [{data},params]=await Promise.all([supabase.auth.getUser(),searchParams]);
  if(data.user?.phone&&!data.user.phone_confirmed_at)redirect("/verify-phone");
  const identity=data.user?await resolveAuthIdentity(supabase,data.user):null;
  if(identity?.status==="ready"&&identity.primaryRole)redirect(routeForRole(identity.primaryRole));
  return <LoginFlow initialError={params.error}/>;
}
