import "server-only";

import type { SubscriptionPlan } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/server";

export async function loadSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("id,role,name,price_monthly,description,benefits")
    .eq("is_active", true)
    .order("price_monthly");
  if (error) throw new Error(`تعذر تحميل خطط الاشتراك: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role === "provider" ? "provider" : "contractor",
    name: row.name,
    priceMonthly: Number(row.price_monthly),
    description: row.description,
    benefits: row.benefits ?? [],
    cta: row.role === "provider" ? "انضم كمزود" : "انضم كمقاول",
  }));
}
