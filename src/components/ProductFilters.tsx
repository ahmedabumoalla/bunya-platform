import type { ProductCategory } from "@/lib/bunya-types";

type ProductFiltersProps = {
  query: string;
  category: ProductCategory | "الكل";
  categories: ProductCategory[];
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: ProductCategory | "الكل") => void;
};

export function ProductFilters({
  query,
  category,
  categories,
  onQueryChange,
  onCategoryChange,
}: ProductFiltersProps) {
  return (
    <div className="glass-card mb-5 grid gap-3 rounded-lg p-4 lg:grid-cols-[1fr_auto_auto_auto]">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]"
        placeholder="ابحث عن أسمنت، حديد، عزل..."
      />
      <select
        value={category}
        onChange={(event) => onCategoryChange(event.target.value as ProductCategory | "الكل")}
        className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]"
      >
        <option value="الكل">كل الفئات</option>
        {categories.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <select className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]">
        <option>كل المدن</option>
        <option>الرياض</option>
        <option>جدة</option>
        <option>الدمام</option>
      </select>
      <select className="rounded-lg border border-[#5a3a1f]/20 bg-white/80 px-4 py-3 font-bold outline-none backdrop-blur focus:border-[#214536]">
        <option>التوصيل متاح</option>
        <option>اليوم</option>
        <option>خلال 24 ساعة</option>
      </select>
    </div>
  );
}
