/* eslint-disable @next/next/no-img-element -- Private Supabase images use short-lived signed URLs and already pass through the upload optimizer. */
import type { CSSProperties } from "react";
import Link from "next/link";
import type { Product, ProductImage } from "@/lib/bunya-types";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import { MobileHeaderLanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

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

export function Icon({ name }: { name: "search" | "grid" | "list" | "filter" | "spark" | "quote" | "close" | "plus" | "check" | "menu" | "box" | "truck" | "shield" | "tag" | "pin" | "calendar" | "clock" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    grid: <><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h6v6h-6z" /></>,
    list: <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><circle cx="5" cy="6" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="18" r="1" /></>,
    filter: <><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>,
    spark: <><path d="M12 3v5" /><path d="M12 16v5" /><path d="M3 12h5" /><path d="M16 12h5" /><path d="m6 6 3 3" /><path d="m15 15 3 3" /><path d="m18 6-3 3" /><path d="m9 15-3 3" /></>,
    quote: <><path d="M7 7h10" /><path d="M7 12h7" /><path d="M7 17h5" /><path d="M5 3h14v18H5z" /></>,
    close: <><path d="M6 6 18 18" /><path d="M18 6 6 18" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    box: <><path d="m4 7 8-4 8 4-8 4z" /><path d="M4 7v10l8 4 8-4V7" /><path d="M12 11v10" /></>,
    truck: <><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 2.7 7.8 7 10 4.3-2.2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-5" /></>,
    tag: <><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    calendar: <><path d="M5 5h14v15H5z" /><path d="M8 3v4M16 3v4M5 10h14" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
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
      {image?.url ? <img alt={image.alt || image.label} className="store-product-photo" decoding="async" key={image.url} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} src={image.url} /> : null}
      <figcaption className="sr-only">{image?.alt ?? "صورة منتج مواد بناء"}</figcaption>
    </figure>
  );
}

type StoreHeaderProps = {
  compact: boolean;
  menuOpen: boolean;
  quoteCount: number;
  quoteOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: () => void;
  onQuoteOpen: () => void;
};

export function StoreHeader({ compact, menuOpen, quoteCount, quoteOpen, onMenuToggle, onNavigate, onQuoteOpen }: StoreHeaderProps) {
  const quoteLabel = `طلب عرض السعر يحتوي على ${quoteCount.toLocaleString("ar-SA")} منتج`;
  return (
    <header className={`store-header ${compact ? "store-header-compact" : ""}`}>
      <div className="store-header-layout mx-auto max-w-[90rem]">
        <a className="store-brand" href="#products" aria-label="بُنية - متجر مواد البناء" onClick={onNavigate}>
          <BunyaLogo priority sizes="(max-width: 700px) 112px, 125px" />
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

        <MobileHeaderLanguageSwitcher />
        <button aria-controls="store-quote-drawer" aria-expanded={quoteOpen} className="store-icon-button store-header-quote" aria-label={quoteLabel} onClick={onQuoteOpen} type="button">
          <Icon name="quote" /><span className="store-count">{quoteCount.toLocaleString("ar-SA")}</span>
        </button>
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
      <span className="store-card-visual-wrap">
        <ProductArtwork image={product.images[0]} />
        <span className="store-card-availability">{product.availabilityStatus}</span>
      </span>
      <span className="store-card-body">
        <span className="store-card-category">{product.category}</span>
        <span className="store-card-name">{product.name}</span>
        <span className="store-card-description">{product.shortDescription || product.description}</span>
        <span className="store-card-meta"><b>{product.unit}</b><i aria-hidden="true" /><b>{product.delivery.window}</b></span>
        <span className="store-card-open">عرض التفاصيل والمواصفات <span aria-hidden="true">←</span></span>
      </span>
    </button>
  );
}
