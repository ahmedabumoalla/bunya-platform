import "server-only";
import type { ContractorProfile } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/server";

export async function loadPublicContractors(): Promise<ContractorProfile[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("contractor_directory_cards");
  if (error) throw new Error("تعذر تحميل دليل المقاولين");
  return (data ?? []).map((row: { id: string; display_name: string; commercial_name: string; city: string; badge: string; service_types: string[]; work_regions: string[]; years_experience: number; projects_count: number; availability: string }) => ({
    id: row.id, displayName: row.display_name, commercialName: row.commercial_name,
    city: row.city, badge: row.badge, serviceTypes: row.service_types, workRegions: row.work_regions,
    yearsExperience: row.years_experience ?? 0, summary: "", workItems: [],
    projectsCount: row.projects_count ?? 0, availability: row.availability,
    subscriptionActive: true, approvalStatus: "approved" as const,
  }));
}
