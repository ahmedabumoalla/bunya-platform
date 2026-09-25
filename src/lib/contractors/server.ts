import "server-only";

import type { ContractorProfile } from "@/lib/bunya-types";
import { createAdminClient } from "@/lib/supabase/admin";

type Media = {
  storage_path: string;
  mime_type: string;
  is_primary: boolean;
  sort_order: number;
};

export async function loadPublicContractors(): Promise<ContractorProfile[]> {
  const admin = createAdminClient();
  const profiles = await admin
    .from("contractor_profiles")
    .select("id,display_name,commercial_name,city,badge,years_experience,summary,phone,email,google_maps_url,average_rating,projects_count,availability,subscription_active,approval_status")
    .eq("approval_status", "approved")
    .order("commercial_name");
  if (profiles.error) throw new Error(`تعذر تحميل دليل المقاولين: ${profiles.error.message}`);

  const rows = profiles.data ?? [];
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];

  const [specialties, regions, services, portfolio] = await Promise.all([
    admin.from("contractor_profile_specialties").select("profile_id,specialty_name,sort_order").in("profile_id", ids).order("sort_order"),
    admin.from("contractor_profile_regions").select("profile_id,region_name").in("profile_id", ids).order("region_name"),
    admin.from("contractor_services").select("contractor_profile_id,title,primary_specialty").in("contractor_profile_id", ids).eq("review_status", "approved").eq("is_active", true).is("deleted_at", null),
    admin.from("contractor_portfolio_items").select("id,profile_id,title,sort_order,contractor_portfolio_media(storage_path,mime_type,is_primary,sort_order)").in("profile_id", ids).eq("is_visible", true).eq("review_status", "approved").is("deleted_at", null).order("sort_order"),
  ]);
  const dataError = specialties.error || regions.error || services.error || portfolio.error;
  if (dataError) throw new Error(`تعذر تحميل تفاصيل المقاولين: ${dataError.message}`);

  const signed = new Map<string, string>();
  await Promise.all((portfolio.data ?? []).flatMap((item) =>
    ((item.contractor_portfolio_media as unknown as Media[]) ?? [])
      .sort(mediaSort)
      .slice(0, 1)
      .map(async (media) => {
        const result = await admin.storage.from("contractor-portfolio").createSignedUrl(media.storage_path, 300);
        if (result.data?.signedUrl) signed.set(media.storage_path, result.data.signedUrl);
      }),
  ));

  return rows.map((row) => {
    const profileSpecialties = (specialties.data ?? []).filter((item) => item.profile_id === row.id).map((item) => item.specialty_name);
    const profileRegions = (regions.data ?? []).filter((item) => item.profile_id === row.id).map((item) => item.region_name);
    const approvedServices = (services.data ?? []).filter((item) => item.contractor_profile_id === row.id);
    const serviceTypes = Array.from(new Set([
      ...profileSpecialties,
      ...approvedServices.flatMap((item) => [item.title, item.primary_specialty]),
    ].filter(Boolean)));
    return {
      id: row.id,
      displayName: row.display_name,
      commercialName: row.commercial_name,
      city: row.city ?? profileRegions[0] ?? "غير محدد",
      badge: row.badge ?? "مقاول معتمد من بُنية",
      serviceTypes,
      workRegions: profileRegions,
      yearsExperience: row.years_experience ?? 0,
      summary: row.summary ?? (serviceTypes.length ? `متخصص في ${serviceTypes.join("، ")}.` : "ملف مقاول معتمد من إدارة بُنية."),
      workItems: (portfolio.data ?? []).filter((item) => item.profile_id === row.id).slice(0, 3).map((item) => {
        const media = ((item.contractor_portfolio_media as unknown as Media[]) ?? []).sort(mediaSort)[0];
        return { title: item.title, mediaUrl: media ? signed.get(media.storage_path) ?? null : null, mimeType: media?.mime_type ?? null };
      }),
      phone: row.phone,
      email: row.email,
      mapsUrl: row.google_maps_url,
      averageRating: Number(row.average_rating ?? 0),
      projectsCount: Number(row.projects_count ?? 0),
      availability: row.availability ?? "available",
      subscriptionActive: row.subscription_active,
      approvalStatus: "approved" as const,
    };
  });
}

function mediaSort(a: Media, b: Media) {
  return Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order;
}
