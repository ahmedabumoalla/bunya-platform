import { NextResponse } from "next/server";
import { documentQuery, documentSources, fields, overviewSections, recordSources, requireUserDetailAccess, roleNames, rows, translated, UserDetailError, userDetailFailure, userDetailHeaders, userDetailLinks } from "@/lib/admin/user-details";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { readableText, type AdminRow } from "@/lib/admin/records";
import type { UserDetailItem, UserDetailOverview, UserDetailPage } from "@/lib/admin/user-details-types";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await requireUserDetailAccess(id);
    const links = await userDetailLinks(access, id);
    const query = new URL(request.url).searchParams;
    const section = query.get("section") ?? "overview";
    const page = Number(query.get("page") ?? "1"), pageSize = 15;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new UserDetailError(400, "رقم الصفحة غير صالح.");
    const start = (page - 1) * pageSize;
    let result: UserDetailOverview | UserDetailPage;
    if (section === "overview") {
      const [rolesResult, sections, authUser] = await Promise.all([
        access.admin.from("user_roles").select("role,is_primary,revoked_at,granted_at").eq("profile_id", id).order("granted_at", { ascending: false }),
        overviewSections(access, links),
        access.admin.auth.admin.getUserById(id),
      ]);
      const roles = rows(rolesResult);
      sections.push({ title: "تاريخ الأدوار", fields: roles.map(role => ({ label: `${roleNames[String(role.role)] ?? "دور آخر"}${role.is_primary ? " · أساسي" : ""}`, value: `${fields(role, [["granted_at", "تاريخ التفعيل", "date"]])[0].value}${role.revoked_at ? ` · أُلغي في ${fields(role, [["revoked_at", "تاريخ الإلغاء", "date"]])[0].value}` : " · نشط"}` })) });
      if (authUser.error) throw new Error("Account identity lookup failed");
      const targetUser = authUser.data.user;
      const targetIdentity = targetUser ? await resolveAuthIdentity(access.admin, targetUser) : null;
      sections.push({ title: "حالة الدخول", fields: fields({ last_sign_in_at: targetUser?.last_sign_in_at, email_confirmed: Boolean(targetUser?.email_confirmed_at), phone_confirmed: Boolean(targetUser?.phone_confirmed_at) }, [["last_sign_in_at", "آخر تسجيل دخول", "date"], ["email_confirmed", "البريد مؤكد", "boolean"], ["phone_confirmed", "الجوال مؤكد", "boolean"]]) });
      result = {
        id, name: String(access.profile.full_name || access.profile.username || "مستخدم المنصة"), email: access.profile.email as string | null, active: access.profile.is_active === true,
        roles: roles.map(role => ({ label: roleNames[String(role.role)] ?? "دور آخر", primary: role.is_primary === true, revoked: Boolean(role.revoked_at) })),
        sections, documentSources: documentSources(links, access.permissions), recordSources: recordSources(id, links, access.permissions).map(({ key, label }) => ({ key, label })),
        canViewActivity: access.permissions.has("audit.read"),
        canImpersonate: access.actor.details.admin?.roleKey === "super_admin" && id !== access.actor.userId && targetIdentity?.status === "ready" && !targetIdentity.activeRoles.includes("admin") && !targetIdentity.profile?.mustChangePassword && Boolean(targetUser?.email_confirmed_at),
      };
    } else if (section === "documents") {
      const source = query.get("source") ?? "files";
      const documents = await documentQuery(access, links, id, source).order("created_at", { ascending: false }).order("id").range(start, start + pageSize - 1);
      const items: UserDetailItem[] = rows(documents).map(row => {
        const file = (Array.isArray(row.files) ? row.files[0] : row.files) as AdminRow | undefined;
        const metadata = file ?? row;
        const blocked = ["quarantined", "rejected"].includes(String(metadata.scan_status));
        return { id: String(row.id), title: readableText(metadata.original_name || row.file_name, "مستند"), status: blocked ? "الملف محجوب أمنياً" : row.status ? translated(row.status) : undefined, date: String(row.created_at), subtitle: `${translated(row.document_type, "ملف مرفوع")} · ${(Number(metadata.size_bytes ?? row.size_bytes) / 1024).toFixed(0)} KB`, href: blocked ? undefined : `/api/admin/users/${id}/documents/${row.id}?source=${source}`, fields: row.expires_at ? fields(row, [["expires_at", "تاريخ انتهاء الصلاحية", "date"]]) : undefined };
      });
      result = { items, total: documents.count ?? 0, page, pageSize };
    } else if (section === "records") {
      const source = recordSources(id, links, access.permissions).find(item => item.key === query.get("source"));
      if (!source) throw new UserDetailError(403, "لا تملك صلاحية عرض هذه السجلات.");
      const records = await access.admin.from(source.table).select(source.select, { count: "exact" }).in(source.filter, source.ids).order("created_at", { ascending: false }).order("id").range(start, start + pageSize - 1);
      result = { items: rows(records).map(row => ({ id: String(row.id), title: source.title === "id" ? source.label : readableText(row[source.title], source.label), status: source.status ? translated(row[source.status]) : undefined, date: String(row.created_at), href: source.route ? `${source.route}/${row.id}` : undefined, fields: fields(row, source.extra ?? []) })), total: records.count ?? 0, page, pageSize };
    } else if (section === "activity") {
      if (!access.permissions.has("audit.read")) throw new UserDetailError(403, "لا تملك صلاحية الاطلاع على سجل التدقيق.");
      // Only safe audit metadata: snapshots may contain unrelated private data or authentication material.
      const audit = await access.admin.from("audit_logs").select("id,action,entity_table,occurred_at,actor_profile_id,delegated_by_profile_id", { count: "exact" }).or(`actor_profile_id.eq.${id},and(entity_table.eq.profiles,entity_id.eq.${id}),delegated_by_profile_id.eq.${id}`).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(start, start + pageSize - 1);
      const auditRows = rows(audit);
      const delegateIds = [...new Set(auditRows.map(row => row.delegated_by_profile_id).filter(Boolean).map(String))];
      const delegates = delegateIds.length ? rows(await access.admin.from("profiles").select("id,full_name,username").in("id", delegateIds)) : [];
      result = { items: auditRows.map(row => ({ id: String(row.id), title: `${translated(row.action, "إجراء مسجل")} · ${translated(row.entity_table, "سجل المنصة")}`, subtitle: row.delegated_by_profile_id ? `دخول بالنيابة · المنفّذ: ${delegates.find(person => person.id === row.delegated_by_profile_id)?.full_name || delegates.find(person => person.id === row.delegated_by_profile_id)?.username || "السوبر أدمن"}` : row.actor_profile_id === id ? "نفّذه هذا المستخدم" : "إجراء على ملف المستخدم", date: String(row.occurred_at) })), total: audit.count ?? 0, page, pageSize };
    } else throw new UserDetailError(400, "القسم غير صالح.");
    return NextResponse.json(result, { headers: userDetailHeaders });
  } catch (error) { return userDetailFailure(error); }
}
