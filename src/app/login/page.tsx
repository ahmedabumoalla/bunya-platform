import {LoginFlow} from "@/components/LoginFlow";
import {redirect} from "next/navigation";
import {getAuthIdentity} from "@/lib/auth/server";
import {routeForRole} from "@/lib/auth/types";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const [identity,params]=await Promise.all([getAuthIdentity(),searchParams]);
  if(identity?.status==="ready"&&identity.primaryRole)redirect(routeForRole(identity.primaryRole));
  return <LoginFlow initialError={params.error}/>;
}
