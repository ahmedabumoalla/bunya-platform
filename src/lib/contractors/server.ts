import "server-only";

import type { ContractorProfile } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/server";

export async function loadPublicContractors(): Promise<ContractorProfile[]> {
  const supabase = await createClient();
  const profilesResult = await supabase
    .from("contractor_profiles")
    .select("id,display_name,commercial_name,city,badge,years_experience,summary,phone,email,subscription_active,approval_status")
    .eq("approval_status", "approved")
    .eq("subscription_active", true)
    .eq("directory_visible", true)
    .order("commercial_name");

  if (profilesResult.error) throw new Error(`تعذر تحميل دليل المقاولين: ${profilesResult.error.message}`);
  const rows = profilesResult.data ?? [];
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [specialties, portfolio] = await Promise.all([
    supabase.from("contractor_profile_specialties").select("profile_id,specialty_name,sort_order").in("profile_id", ids).order("sort_order"),
    supabase.from("contractor_portfolio_items").select("profile_id,title,sort_order").in("profile_id", ids).eq("is_visible", true).eq("is_approved", true).order("sort_order"),
  ]);
  if (specialties.error) throw new Error(`تعذر تحميل تخصصات المقاولين: ${specialties.error.message}`);
  if (portfolio.error) throw new Error(`تعذر تحميل أعمال المقاولين: ${portfolio.error.message}`);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    commercialName: row.commercial_name,
    city: row.city ?? "غير محدد",
    badge: row.badge ?? "مقاول معتمد",
    serviceTypes: (specialties.data ?? []).filter((item) => item.profile_id === row.id).map((item) => item.specialty_name),
    yearsExperience: row.years_experience ?? 0,
    summary: row.summary ?? "لم يضف المقاول نبذة مهنية بعد.",
    mockWorkImages: (portfolio.data ?? []).filter((item) => item.profile_id === row.id).slice(0, 3).map((item) => item.title),
    phone: row.phone,
    email: row.email,
    subscriptionActive: row.subscription_active,
    approvalStatus: row.approval_status === "approved" ? "approved" : "pending",
  }));
}
