import { redirect } from "next/navigation";
import { PhoneVerificationFlow } from "@/components/PhoneVerificationFlow";
import { quoteReturnToQuery, resolveSafeReturnTo } from "@/lib/auth/return-to";
import { requiresPhoneVerification } from "@/lib/auth/phone-verification";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { createClient } from "@/lib/supabase/server";

export default async function VerifyPhonePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const supabase = await createClient();
  const [{ data, error }, params] = await Promise.all([supabase.auth.getUser(), searchParams]);
  if (error || !data.user) redirect(`/login${quoteReturnToQuery(params.returnTo)}`);
  let identity = await resolveAuthIdentity(supabase, data.user);

  if (data.user.phone && data.user.phone_confirmed_at && identity.status === "missing_role") {
    const initialized = await supabase.rpc("initialize_customer_account");
    if (initialized.error) redirect("/login?error=role_not_ready");
    identity = await resolveAuthIdentity(supabase, data.user);
  }

  if (!requiresPhoneVerification(data.user, identity)) {
    if (identity.status === "ready" && identity.primaryRole) redirect(resolveSafeReturnTo(identity.primaryRole, params.returnTo));
    redirect(`/login?error=${identity.status}`);
  }

  return <PhoneVerificationFlow returnTo={params.returnTo} />;
}
