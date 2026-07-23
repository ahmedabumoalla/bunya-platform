import { ProviderJoinFlow } from "@/components/JoinApplications";
import { loadPublicCatalog } from "@/lib/catalog/server";

export default async function ProviderJoinPage() {
  let categories = null;
  try {
    categories = (await loadPublicCatalog()).categories;
  } catch {}
  return categories
    ? <ProviderJoinFlow categories={categories} />
    : <main className="portal-page"><section className="portal-card" role="alert"><h1>تعذر الاتصال بقاعدة البيانات</h1><p>لا يمكن تحميل تصنيفات المنتجات حاليا. حاول مرة أخرى بعد التحقق من الاتصال.</p></section></main>;
}
