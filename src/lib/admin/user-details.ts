import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { formatRecordField, stateLabels, type AdminRow } from "@/lib/admin/records";
import { providerDocumentLabel } from "@/lib/join/provider-fields";
import type { UserDetailField, UserDetailSection, UserDetailSource } from "./user-details-types";

export const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const userDetailHeaders = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" };
export class UserDetailError extends Error { constructor(public status: number, message: string) { super(message); } }
export function userDetailFailure(error: unknown) {
  return NextResponse.json({ message: error instanceof UserDetailError ? error.message : "تعذر تحميل بيانات الحساب. حاول مرة أخرى." }, { status: error instanceof UserDetailError ? error.status : 500, headers: userDetailHeaders });
}
export const roleNames: Record<string, string> = { customer: "عميل", provider: "مزود", contractor: "مقاول", driver: "سائق", admin: "إدارة", owner: "مالك", manager: "مدير", staff: "موظف", catalog: "إدارة المنتجات", quotes: "عروض الأسعار", finance: "المالية", driver_coordinator: "تنسيق السائقين" };
type DB = ReturnType<typeof createAdminClient>;
type Result = { data: unknown; error: unknown };
export function rows(result: Result): AdminRow[] { if (result.error) throw new Error("Account detail query failed"); return (result.data ?? []) as AdminRow[]; }
export function fields(row: AdminRow, spec: [string, string, ("date" | "money" | "boolean" | "status")?][]): UserDetailField[] {
  return spec.map(([key, label, kind]) => ({ label, value: formatRecordField(row, { key, label, kind }) }));
}
export async function requireUserDetailAccess(id: string) {
  if (!userIdPattern.test(id)) throw new UserDetailError(404, "الحساب غير موجود.");
  const session = await createClient();
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) throw new UserDetailError(401, "سجّل دخولك أولاً.");
  const identity = await resolveAuthIdentity(session, data.user);
  if (identity.status !== "ready" || !identity.activeRoles.includes("admin") || !identity.details.admin) throw new UserDetailError(403, "لا تملك صلاحية عرض الحساب.");
  const keys = ["profiles.read", "reviews.manage", "orders.manage", "sourcing.manage", "projects.manage", "finance.manage", "support.manage", "deliveries.manage", "audit.read", "roles.manage"];
  const permissions = new Set<string>();
  await Promise.all(keys.map(async key => { const result = await session.rpc("admin_has_permission", { requested_permission: key }); if (!result.error && result.data === true) permissions.add(key); }));
  if (!permissions.has("profiles.read")) throw new UserDetailError(403, "لا تملك صلاحية عرض الحساب.");
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("id,full_name,username,email,mobile,is_active,role,preferred_locale,created_at,updated_at,must_change_password,password_changed_at").eq("id", id).maybeSingle();
  if (profile.error) throw new Error("Profile lookup failed");
  if (!profile.data) throw new UserDetailError(404, "الحساب غير موجود.");
  return { admin, permissions, profile: profile.data as AdminRow, actor: identity };
}
export type UserDetailAccess = Awaited<ReturnType<typeof requireUserDetailAccess>>;
async function collectIds(db: DB, table: string, select: string, filter: string, id: string) {
  const all: AdminRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = rows(await db.from(table).select(select).eq(filter, id).order(select.split(",")[0]).range(offset, offset + 499));
    all.push(...batch); if (batch.length < 500) return all;
  }
}
export async function userDetailLinks(access: UserDetailAccess, id: string) {
  const { admin } = access;
  const [members, owned, contractors, providerApplications, contractorApplications, drivers] = await Promise.all([
    collectIds(admin, "provider_members", "provider_id,member_role,is_active", "profile_id", id),
    collectIds(admin, "providers", "id,application_id", "owner_profile_id", id),
    collectIds(admin, "contractor_profiles", "id,application_id", "profile_id", id),
    collectIds(admin, "provider_applications", "id", "applicant_profile_id", id),
    collectIds(admin, "contractor_applications", "id", "applicant_profile_id", id),
    collectIds(admin, "provider_driver_accounts", "driver_id", "auth_user_id", id),
  ]);
  const providerIds = [...new Set([...members.map(row => String(row.provider_id)), ...owned.map(row => String(row.id))])];
  const linkedProviders = providerIds.length ? rows(await admin.from("providers").select("id,application_id").in("id", providerIds)) : [];
  return {
    members, providerIds, contractorIds: contractors.map(row => String(row.id)), driverIds: drivers.map(row => String(row.driver_id)),
    providerApplicationIds: [...new Set([...providerApplications.map(row => String(row.id)), ...linkedProviders.map(row => row.application_id).filter(Boolean).map(String)])],
    contractorApplicationIds: [...new Set([...contractorApplications.map(row => String(row.id)), ...contractors.map(row => row.application_id).filter(Boolean).map(String)])],
  };
}
export type UserDetailLinks = Awaited<ReturnType<typeof userDetailLinks>>;
export type RecordSource = UserDetailSource & { table: string; select: string; filter: string; ids: string[]; permission: string; title: string; route?: string; status?: string; extra?: [string, string, ("date" | "money" | "boolean" | "status")?][] };
export function recordSources(id: string, links: UserDetailLinks, permissions: Set<string>): RecordSource[] {
  const source = (key: string, label: string, table: string, filter: string, ids: string[], permission: string, title: string, route?: string, status = "status", extra: RecordSource["extra"] = []): RecordSource => ({ key, label, table, filter, ids, permission, title, route, status, extra, select: [...new Set(["id", title, "created_at", ...(status ? [status] : []), ...extra.map(field => field[0])])].join(",") });
  return [
    source("requests", "طلبات المنتجات", "quote_requests", "requester_id", [id], "orders.manage", "request_code", "/admin/quote-requests"),
    source("orders", "طلبات الشراء", "orders", "customer_profile_id", [id], "orders.manage", "order_code", "/admin/orders", "status", [["total", "الإجمالي", "money"], ["payment_status", "الدفع", "status"]]),
    source("invoices", "الفواتير", "invoices", "customer_profile_id", [id], "finance.manage", "invoice_code", "/admin/invoices", "status", [["total", "الإجمالي", "money"]]),
    source("project_requests", "طلبات المشاريع", "project_requests", "customer_profile_id", [id], "projects.manage", "title", "/admin/project-requests", "", [["city", "المدينة"], ["is_open", "مفتوح", "boolean"]]),
    source("customer_projects", "مشاريع العميل", "contractor_projects", "customer_profile_id", [id], "projects.manage", "name", "/admin/contractor-projects", "status", [["project_value", "قيمة المشروع", "money"]]),
    source("proposals", "عروض المقاول", "contractor_proposals", "contractor_profile_id", links.contractorIds, "projects.manage", "proposal_code", "/admin/contractor-proposals", "status", [["amount", "قيمة العرض", "money"]]),
    source("contractor_projects", "مشاريع المقاول", "contractor_projects", "contractor_profile_id", links.contractorIds, "projects.manage", "name", "/admin/contractor-projects", "status", [["project_value", "قيمة المشروع", "money"]]),
    source("products", "منتجات المنشأة", "products", "provider_id", links.providerIds, "reviews.manage", "name", undefined, "review_status"),
    source("provider_quotes", "عروض المزود", "provider_quotes", "provider_id", links.providerIds, "sourcing.manage", "quote_code", undefined, "status", [["total", "الإجمالي", "money"]]),
    source("provider_settlements", "طلبات صرف المزود", "settlement_requests", "provider_id", links.providerIds, "finance.manage", "settlement_code", "/admin/settlements", "status", [["amount", "المبلغ", "money"]]),
    source("contractor_settlements", "طلبات صرف المقاول", "contractor_settlement_requests", "contractor_profile_id", links.contractorIds, "finance.manage", "settlement_code", undefined, "status", [["amount", "المبلغ", "money"]]),
    source("support", "تذاكر الدعم", "support_tickets", "opened_by", [id], "support.manage", "subject", undefined, "status", [["message", "الرسالة"], ["admin_response", "رد الإدارة"]]),
    source("addresses", "العناوين", "customer_addresses", "customer_profile_id", [id], "profiles.read", "label", undefined, "", [["project_name", "المشروع"], ["city", "المدينة"], ["region", "المنطقة"], ["description", "الوصف"], ["recipient_name", "المستلم"], ["recipient_mobile", "جوال المستلم"], ["google_maps_url", "موقع التسليم"], ["is_default", "العنوان الافتراضي", "boolean"]]),
    source("deliveries", "مهام السائق", "provider_delivery_assignments", "assigned_driver_id", links.driverIds, "deliveries.manage", "id", "/admin/deliveries", "status", [["expected_at", "موعد التوصيل", "date"], ["delivered_at", "وقت التسليم", "date"]]),
  ].filter(item => item.ids.length && permissions.has(item.permission));
}
export function documentSources(links: UserDetailLinks, permissions: Set<string>): UserDetailSource[] {
  return [{ key: "files", label: "الملفات المرفوعة" }, ...(permissions.has("reviews.manage") ? [
    ...(links.providerApplicationIds.length ? [{ key: "provider_application", label: "مستندات انضمام المزود" }] : []),
    ...(links.providerIds.length ? [{ key: "provider", label: "مستندات المنشأة" }] : []),
    ...(links.contractorIds.length || links.contractorApplicationIds.length ? [{ key: "contractor", label: "مستندات المقاول والانضمام" }] : []),
  ] : [])];
}
export function documentQuery(access: UserDetailAccess, links: UserDetailLinks, id: string, source: string, full = false) {
  if (!documentSources(links, access.permissions).some(item => item.key === source)) throw new UserDetailError(403, "لا تملك صلاحية عرض هذه المستندات.");
  const { admin } = access;
  if (source === "files") return admin.from("files").select(`id,original_name,mime_type,size_bytes,created_at,scan_status${full ? ",bucket_id,object_path" : ""}`, { count: "exact" }).eq("owner_profile_id", id).is("deleted_at", null);
  if (source === "provider") return admin.from("provider_documents").select(`id,file_name,document_type,status,expires_at,size_bytes,mime_type,created_at${full ? ",storage_path" : ""}`, { count: "exact" }).in("provider_id", links.providerIds);
  if (source === "provider_application") return admin.from("provider_application_documents").select(`id,document_type,status,created_at,files!inner(original_name,mime_type,size_bytes,scan_status,deleted_at${full ? ",bucket_id,object_path" : ""})`, { count: "exact" }).in("application_id", links.providerApplicationIds).eq("is_current", true).is("files.deleted_at", null);
  const filters = [...(links.contractorIds.length ? [`contractor_profile_id.in.(${links.contractorIds.join(",")})`] : []), ...(links.contractorApplicationIds.length ? [`application_id.in.(${links.contractorApplicationIds.join(",")})`] : [])];
  return admin.from("contractor_documents").select(`id,file_name,document_type,status,expires_at,size_bytes,mime_type,created_at${full ? ",storage_path,application_id" : ""}`, { count: "exact" }).or(filters.join(","));
}
const maintenanceLabels: Record<string, string> = { maintenance_started: "بدء الدخول بالنيابة", maintenance_ended: "إنهاء الدخول بالنيابة", admin_impersonation_sessions: "جلسات الصيانة", storage_objects: "المستندات والملفات", storage_post: "إجراء على الملفات", storage_put: "رفع ملف", storage_delete: "حذف ملف", insert: "إضافة", update: "تعديل", delete: "حذف" };
export function translated(value: unknown, fallback = "غير محدد") {
  const key = String(value);
  if (["commercial_registration", "municipal_license", "national_address", "vat_certificate"].includes(key)) return providerDocumentLabel(key);
  return maintenanceLabels[key] ?? stateLabels[key] ?? roleNames[key] ?? fallback;
}
export async function overviewSections(access: UserDetailAccess, links: UserDetailLinks): Promise<UserDetailSection[]> {
  const { admin, profile } = access;
  const sections: UserDetailSection[] = [{ title: "بيانات الحساب", fields: fields(profile, [["full_name", "الاسم الكامل"], ["username", "اسم المستخدم"], ["email", "البريد الإلكتروني"], ["mobile", "رقم الجوال"], ["created_at", "تاريخ التسجيل", "date"], ["updated_at", "آخر تحديث", "date"], ["must_change_password", "يلزم تغيير كلمة المرور", "boolean"], ["password_changed_at", "آخر تغيير لكلمة المرور", "date"]]) }];
  if (access.permissions.has("reviews.manage")) {
    if (links.providerIds.length) {
      const providers = rows(await admin.from("providers").select("id,company_name,company_name_en,contact_name,service_cities,mobile,email,status,google_maps_url,review_notes,reviewed_at").in("id", links.providerIds));
      for (const provider of providers) sections.push({ title: `المنشأة · ${provider.company_name}`, fields: fields(provider, [["company_name", "اسم المنشأة بالعربية"], ["company_name_en", "اسم المنشأة بالإنجليزية"], ["contact_name", "مسؤول التواصل (اختياري)"], ["service_cities", "المدن التي يخدمها المزود"], ["mobile", "الجوال"], ["email", "البريد"], ["status", "حالة المنشأة", "status"], ["google_maps_url", "الموقع"], ["reviewed_at", "وقت المراجعة", "date"], ["review_notes", "ملاحظات المراجعة"]]) });
      const details = rows(await admin.from("provider_profiles").select("provider_id,public_description,username,delivery_available,commercial_registration_number,vat_number,national_address_short_code,building_number,street_name,district,city,region,postal_code,secondary_number,country,website_url").in("provider_id", links.providerIds));
      for (const detail of details) sections.push({ title: `البيانات التجارية · ${providers.find(row => row.id === detail.provider_id)?.company_name ?? "المنشأة"}`, fields: fields(detail, [["public_description", "نبذة المنشأة"], ["commercial_registration_number", "السجل التجاري"], ["vat_number", "الرقم الضريبي"], ["delivery_available", "التوصيل متاح", "boolean"], ["national_address_short_code", "العنوان المختصر"], ["building_number", "رقم المبنى"], ["street_name", "الشارع"], ["district", "الحي"], ["city", "المدينة"], ["region", "المنطقة"], ["postal_code", "الرمز البريدي"], ["secondary_number", "الرقم الإضافي"], ["country", "الدولة"], ["website_url", "الموقع الإلكتروني"]]) });
    }
    if (links.providerApplicationIds.length) {
      const applications = rows(await admin.from("provider_applications").select("id,company_name,company_name_en,contact_name,service_cities,status,created_at,joining_policy_title,joining_policy_version,joining_policy_accepted_at").in("id", links.providerApplicationIds));
      for (const application of applications) sections.push({ title: `طلب انضمام المزود · ${application.company_name}`, fields: fields(application, [["company_name", "اسم الشركة بالعربية"], ["company_name_en", "اسم الشركة بالإنجليزية"], ["contact_name", "اسم المسؤول (اختياري)"], ["service_cities", "المدن التي يخدمها المزود"], ["status", "حالة الطلب", "status"], ["created_at", "تاريخ التقديم", "date"], ["joining_policy_title", "سياسة الانضمام المقبولة"], ["joining_policy_version", "إصدار السياسة"], ["joining_policy_accepted_at", "وقت الموافقة على السياسة", "date"]]) });
    }
    if (links.contractorIds.length) {
      const contractors = rows(await admin.from("contractor_profiles").select("display_name,commercial_name,city,badge,years_experience,summary,phone,email,subscription_active,approval_status,availability,google_maps_url,average_rating,projects_count,directory_visible,professional_links").in("id", links.contractorIds));
      for (const contractor of contractors) sections.push({ title: "الملف المهني للمقاول", fields: fields(contractor, [["display_name", "اسم العرض"], ["commercial_name", "الاسم التجاري"], ["city", "المدينة"], ["badge", "التصنيف المهني"], ["years_experience", "سنوات الخبرة"], ["summary", "النبذة"], ["phone", "جوال العمل"], ["email", "بريد العمل"], ["subscription_active", "الاشتراك نشط", "boolean"], ["approval_status", "حالة الاعتماد", "status"], ["availability", "التوفر", "status"], ["google_maps_url", "الموقع"], ["average_rating", "متوسط التقييم"], ["projects_count", "عدد المشاريع"], ["directory_visible", "ظاهر في الدليل", "boolean"], ["professional_links", "الروابط المهنية"]]) });
      const [specialties, regions] = await Promise.all([
        admin.from("contractor_profile_specialties").select("specialty_name").in("profile_id", links.contractorIds).order("sort_order"),
        admin.from("contractor_profile_regions").select("region_name").in("profile_id", links.contractorIds),
      ]);
      sections.push({ title: "التخصصات ومناطق العمل", fields: [{ label: "التخصصات", value: rows(specialties).map(row => row.specialty_name).join("، ") || "غير مسجل" }, { label: "مناطق العمل", value: rows(regions).map(row => row.region_name).join("، ") || "غير مسجل" }] });
    }
  }
  if (access.permissions.has("roles.manage")) {
    const administrators = rows(await admin.from("admin_users").select("is_active,last_active_at,role:admin_roles!role_id(name_ar,description)").eq("profile_id", String(profile.id)));
    for (const administrator of administrators) sections.push({ title: "الدور الإداري", fields: fields(administrator, [["role.name_ar", "الصلاحية الإدارية"], ["role.description", "وصف الدور"], ["is_active", "الوصول الإداري مفعّل", "boolean"], ["last_active_at", "آخر نشاط إداري", "date"]]) });
  }
  if (links.driverIds.length && access.permissions.has("deliveries.manage")) {
    for (const driver of rows(await admin.from("provider_drivers").select("full_name,mobile,email,username,status,internal_notes,violations,last_active_at").in("id", links.driverIds))) sections.push({ title: "بيانات السائق", fields: fields(driver, [["full_name", "اسم السائق"], ["mobile", "الجوال"], ["email", "البريد"], ["username", "اسم المستخدم"], ["status", "الحالة", "status"], ["violations", "المخالفات"], ["last_active_at", "آخر نشاط", "date"], ["internal_notes", "ملاحظات الإدارة"]]) });
  }
  return sections;
}
