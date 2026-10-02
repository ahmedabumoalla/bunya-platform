import type { Metadata } from "next";
import { HomeStorefront } from "@/components/HomeStorefront";
import { PublicLegalFooter } from "@/components/legal/LegalPage";
import { loadPublicCatalog } from "@/lib/catalog/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { publicAccountFor } from "@/lib/auth/public-account";

export const metadata: Metadata = {
  title: "بُنية | متجر مواد البناء",
  description: "متجر بُنية لعرض منتجات مواد البناء المتاحة ومقارنة تفاصيلها وطلب عروض الأسعار.",
};

export default async function Home() {
  const account = publicAccountFor(await getAuthIdentity());
  let catalog: Awaited<ReturnType<typeof loadPublicCatalog>> | null = null;
  try {
    catalog = await loadPublicCatalog();
  } catch {}
  return (
    <>
      {catalog
        ? <HomeStorefront categories={catalog.categories} products={catalog.products} account={account} />
        : <HomeStorefront categories={[]} products={[]} account={account} dataError="لا يمكن تحميل الكتالوج حاليا. حاول مرة أخرى بعد التحقق من الاتصال." />}
      <PublicLegalFooter />
    </>
  );
}
