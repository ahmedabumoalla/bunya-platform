import { ProviderJoinFlow } from "@/components/JoinApplications";
import { loadPublicCatalog } from "@/lib/catalog/server";
import { JoinApplicationShell } from "@/components/join/JoinApplicationShell";

export const metadata = { title: "طلب انضمام مورد | بُنية" };

export default async function ProviderJoinPage() {
  let categories = null;
  try {
    categories = (await loadPublicCatalog()).categories;
  } catch {}
  return categories
    ? <ProviderJoinFlow categories={categories} />
    : <JoinApplicationShell title="طلب انضمام مورد" description="أكمل بيانات منشأتك وأرفق المستندات."><p role="alert">لا يمكن تحميل تصنيفات المنتجات حاليًا. حاول مرة أخرى بعد التحقق من الاتصال.</p></JoinApplicationShell>;
}
