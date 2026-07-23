import type { Metadata } from "next";
import { HomeStorefront } from "@/components/HomeStorefront";
import { loadPublicCatalog } from "@/lib/catalog/server";

export const metadata: Metadata = {
  title: "بُنية | متجر مواد البناء",
  description: "متجر بُنية لعرض منتجات مواد البناء المتاحة ومقارنة تفاصيلها وطلب عروض الأسعار.",
};

export default async function Home() {
  let catalog: Awaited<ReturnType<typeof loadPublicCatalog>> | null = null;
  try {
    catalog = await loadPublicCatalog();
  } catch {}
  return catalog
    ? <HomeStorefront categories={catalog.categories} products={catalog.products} />
    : <HomeStorefront categories={[]} products={[]} dataError="لا يمكن تحميل الكتالوج حاليا. حاول مرة أخرى بعد التحقق من الاتصال." />;
}
