import { redirect } from "next/navigation";
import { PhoneVerificationFlow } from "@/components/PhoneVerificationFlow";
import { requiresPhoneVerification } from "@/lib/auth/phone-verification";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { routeForRole } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export default async function VerifyPhonePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  let identity = await resolveAuthIdentity(supabase, data.user);

  if (data.user.phone && data.user.phone_confirmed_at && identity.status === "missing_role") {
    const initialized = await supabase.rpc("initialize_customer_account");
    if (initialized.error) redirect("/login?error=role_not_ready");
    identity = await resolveAuthIdentity(supabase, data.user);
  }

  if (!requiresPhoneVerification(data.user, identity)) {
    if (identity.status === "ready" && identity.primaryRole) redirect(routeForRole(identity.primaryRole));
    redirect(`/login?error=${identity.status}`);
  }

  return <PhoneVerificationFlow />;
}
