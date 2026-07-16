import type { Metadata } from "next";
import { HomeStorefront } from "@/components/HomeStorefront";
import { productCategories, products } from "@/lib/bunya-data";

export const metadata: Metadata = {
  title: "بُنية | متجر مواد البناء",
  description:
    "متجر بُنية لعرض منتجات مواد البناء، مقارنة التفاصيل، وإضافة المنتجات إلى طلب عرض سعر محلي بدون دفع أو ربط قاعدة بيانات.",
};

export default function Home() {
  return <HomeStorefront categories={productCategories} products={products} />;
}
