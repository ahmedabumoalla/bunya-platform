import { redirect } from "next/navigation";
import { PhoneVerificationFlow } from "@/components/PhoneVerificationFlow";
import { createClient } from "@/lib/supabase/server";

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 7 ? "***" : `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

export default async function VerifyPhonePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!data.user.phone) redirect("/login");

  if (data.user.phone_confirmed_at) {
    const initialized = await supabase.rpc("initialize_customer_account");
    if (initialized.error) redirect("/login?error=role_not_ready");
    redirect("/customer");
  }

  return <PhoneVerificationFlow maskedPhone={maskPhone(data.user.phone)} />;
}
