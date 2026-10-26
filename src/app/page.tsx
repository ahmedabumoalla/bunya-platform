import type { Metadata } from "next";
import { HomeStorefront } from "@/components/HomeStorefront";
import { PublicLegalFooter } from "@/components/legal/LegalPage";
import { loadPublicCatalog } from "@/lib/catalog/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { publicAccountFor } from "@/lib/auth/public-account";
import { loadPlatformCatalog } from "@/lib/catalog/platform";

export const metadata: Metadata = {
  title: "بُنية | متجر مواد البناء",
  description: "متجر بُنية لعرض منتجات مواد البناء المتاحة ومقارنة تفاصيلها وطلب عروض الأسعار.",
};

export default async function Home() {
  const account = publicAccountFor(await getAuthIdentity());
  const platformCatalog = loadPlatformCatalog();
  let catalog: Awaited<ReturnType<typeof loadPublicCatalog>> | null = null;
  try {
    catalog = await loadPublicCatalog();
  } catch {
    console.warn("Supplier catalog unavailable; showing the independent platform catalog.");
  }
  const products = [...platformCatalog.products, ...(catalog?.products ?? [])];
  const categories = [...new Set([...platformCatalog.categories, ...(catalog?.categories ?? [])])];
  return (
    <>
      <HomeStorefront categories={categories} products={products} account={account} />
      <PublicLegalFooter />
    </>
  );
}
