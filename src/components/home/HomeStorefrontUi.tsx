import type { CSSProperties } from "react";
import Link from "next/link";
import type { Product, ProductImage } from "@/lib/bunya-types";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

type ProductVisualStyle = CSSProperties & {
  "--product-tone"?: string;
  "--product-ink"?: string;
  "--store-stagger"?: string;
};

const visualTone: Record<ProductImage["tone"], { tone: string; ink: string }> = {
  cement: { tone: "#dbe8f7", ink: "#7b8794" },
  steel: { tone: "#b9c9df", ink: "#334155" },
  blocks: { tone: "#d7e0ea", ink: "#64748b" },
  insulation: { tone: "#58a6ff", ink: "#0f3d73" },
  plumbing: { tone: "#eef7ff", ink: "#2f80c8" },
  electric: { tone: "#f5c84c", ink: "#1d4ed8" },
  wood: { tone: "#d8aa68", ink: "#6b3f1d" },
  paint: { tone: "#dceafe", ink: "#2563eb" },
  tools: { tone: "#c6d3e4", ink: "#172554" },
};

export function Icon({ name }: { name: "search" | "grid" | "spark" | "quote" | "close" | "plus" | "check" | "menu" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    grid: <><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h6v6h-6z" /></>,
    spark: <><path d="M12 3v5" /><path d="M12 16v5" /><path d="M3 12h5" /><path d="M16 12h5" /><path d="m6 6 3 3" /><path d="m15 15 3 3" /><path d="m18 6-3 3" /><path d="m9 15-3 3" /></>,
    quote: <><path d="M7 7h10" /><path d="M7 12h7" /><path d="M7 17h5" /><path d="M5 3h14v18H5z" /></>,
    close: <><path d="M6 6 18 18" /><path d="M18 6 6 18" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  };

  return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function ProductArtwork({ image, large = false }: { image?: ProductImage; large?: boolean }) {
  const tone = image ? visualTone[image.tone] : visualTone.cement;
  const style: ProductVisualStyle = { "--product-tone": tone.tone, "--product-ink": tone.ink };

  return (
    <figure aria-label={image?.alt ?? "صورة منتج مواد بناء"} className={`store-product-art ${large ? "store-product-art-large" : ""} ${image ? `store-product-art-${image.tone}` : ""}`} role="img" style={style}>
      <span className="store-art-sheen" />
      <span className="store-art-object store-art-object-main" />
      <span className="store-art-object store-art-object-alt" />
      <figcaption className="sr-only">{image?.alt ?? "صورة منتج مواد بناء"}</figcaption>
    </figure>
  );
}

type StoreHeaderProps = {
  compact: boolean;
  menuOpen: boolean;
  quoteCount: number;
  onMenuToggle: () => void;
  onNavigate: () => void;
};

export function StoreHeader({ compact, menuOpen, quoteCount, onMenuToggle, onNavigate }: StoreHeaderProps) {
  const quoteLabel = `طلب عرض السعر يحتوي على ${quoteCount.toLocaleString("ar-SA")} منتج`;
  return (
    <header className={`store-header ${compact ? "store-header-compact" : ""}`}>
      <div className="store-header-layout mx-auto max-w-[90rem]">
        <a className="store-brand" href="#products" aria-label="بُنية - متجر مواد البناء" onClick={onNavigate}>
          <BunyaLogo priority />
        </a>

        <nav className="store-desktop-nav" aria-label="روابط المتجر">
          <a className="store-nav-link" href="#products"><Icon name="grid" />المنتجات</a>
          <a className="store-nav-link" href="#latest"><Icon name="spark" />الأحدث</a>
          <Link className="store-nav-link store-nav-contractor" href="/contractors"><Icon name="search" />ابحث عن مقاول</Link>
        </nav>

        <nav className="store-desktop-portals" aria-label="بوابات بُنية">
          <Link className="store-portal-link store-portal-link-primary" href="/login">لوحة التحكم</Link>
          <Link className="store-portal-link" href="/providers/join">المزودون</Link>
          <Link className="store-portal-link" href="/contractors/join">المقاولون</Link>
        </nav>

        <a href="#quote" className="store-icon-button store-header-quote" aria-label={quoteLabel}>
          <Icon name="quote" /><span className="store-count">{quoteCount.toLocaleString("ar-SA")}</span>
        </a>
        <button aria-expanded={menuOpen} aria-controls="store-mobile-menu" aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"} className="store-menu-button" onClick={onMenuToggle} type="button"><Icon name={menuOpen ? "close" : "menu"} /></button>
      </div>

      <nav className="store-mobile-menu" data-open={menuOpen} id="store-mobile-menu" aria-label="قائمة الجوال">
        <a href="#products" onClick={onNavigate}>المنتجات</a>
        <a href="#latest" onClick={onNavigate}>أحدث المنتجات</a>
        <Link href="/contractors">ابحث عن مقاول</Link>
        <Link href="/login">لوحة التحكم</Link>
        <Link href="/providers/join">بوابة المزودين</Link>
        <Link href="/contractors/join">بوابة المقاولين</Link>
      </nav>
    </header>
  );
}

export function LatestProductCard({ product, index, onOpen }: { product: Product; index: number; onOpen: (product: Product, element: HTMLElement) => void }) {
  const style: ProductVisualStyle = { "--store-stagger": `${Math.min(index, 5) * 55}ms` };
  return (
    <button className="store-latest-card store-stagger-card text-start" onClick={(event) => onOpen(product, event.currentTarget)} style={style} type="button">
      <ProductArtwork image={product.images[0]} />
      <span className="store-card-name">{product.name}</span>
      <span className="store-card-meta"><b>{product.unit}</b><i aria-hidden="true" /><b>{product.delivery.window}</b></span>
    </button>
  );
}

export function ProductCard({ product, index, onOpen }: { product: Product; index: number; onOpen: (product: Product, element: HTMLElement) => void }) {
  const style: ProductVisualStyle = { "--store-stagger": `${Math.min(index, 8) * 45}ms` };
  return (
    <button aria-label={`عرض تفاصيل ${product.name}`} className="store-product-card store-stagger-card text-start" onClick={(event) => onOpen(product, event.currentTarget)} style={style} type="button">
      <ProductArtwork image={product.images[0]} />
      <span className="store-card-name">{product.name}</span>
      <span className="store-card-meta"><b>{product.unit}</b><i aria-hidden="true" /><b>{product.delivery.window}</b></span>
    </button>
  );
}
