import type { Product } from "@/lib/bunya-types";
import { StatusBadge } from "./StatusBadge";

type ProductCardProps = {
  product: Product;
  onRequest?: (productId: string) => void;
};

export function ProductCard({ product, onRequest }: ProductCardProps) {
  const button = (
    <button
      type="button"
      onClick={() => onRequest?.(product.id)}
      className="premium-button mt-5 w-full rounded-lg bg-[#214536] px-4 py-3 text-sm font-black text-white transition hover:bg-[#19372a]"
    >
      طلب عرض سعر
    </button>
  );

  return (
    <article className="glass-card motion-card rounded-lg p-5">
      <div className="product-visual mb-5 p-4">
        <StatusBadge tone="green">{product.category}</StatusBadge>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">{product.name}</h2>
          <p className="mt-2 text-sm font-bold text-[var(--muted)]">الوحدة: {product.unit}</p>
        </div>
        <StatusBadge tone="sand">متاح</StatusBadge>
      </div>
      <p className="mt-3 min-h-16 leading-7 text-[var(--muted)]">{product.description}</p>
      <div className="mt-5 grid gap-3">
        <p className="rounded-lg bg-[#f7f2e8]/80 p-3 text-sm font-bold text-[#5a3a1f]">
          {product.availability}
        </p>
        <p className="rounded-lg bg-[#dce8d7]/80 p-3 text-sm font-bold text-[#214536]">
          {product.leadTime}
        </p>
      </div>
      <p className="mt-4 rounded-lg border border-[#b76734]/20 bg-[#fff2e8]/80 p-3 text-xs font-black text-[#8f5f2e]">
        السعر يظهر بعد تجميع عروض التجار واعتماد الأرخص المؤهل.
      </p>
      {onRequest ? button : null}
    </article>
  );
}
