/* eslint-disable @next/next/no-img-element -- Private Supabase images use short-lived signed URLs and already pass through the upload optimizer. */
import type { CSSProperties } from "react";
import Link from "next/link";
import type { Product, ProductImage } from "@/lib/bunya-types";
import { isProductVideo } from "@/lib/products/image-urls";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import { publicAccountFor, type PublicAccount } from "@/lib/auth/public-account";
import { PublicAccountLink } from "./PublicAccountLink";

type ProductVisualStyle = CSSProperties & {
  "--product-tone"?: string;
  "--product-ink"?: string;
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

export function Icon({ name }: { name: "search" | "grid" | "list" | "filter" | "spark" | "quote" | "close" | "plus" | "check" | "menu" | "box" | "truck" | "shield" | "tag" | "pin" | "calendar" | "clock" | "user" | "userPlus" | "helmet" }) {
  const paths = {
    userPlus: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 8v6M16 11h6" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    helmet: <><path d="M4 16v-3a8 8 0 0 1 16 0v3M3 16h18v4H3zM9 5v6M15 5v6" /></>,
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
  const video = isProductVideo({ mime_type: image?.mimeType, image_url: image?.url });

  if (video) return (
    <figure className={`store-product-art ${large ? "store-product-art-large" : ""}`} style={{ ...style, display: "grid", placeItems: "center", background: "#f7f7f5", color: "#414747" }}>
      {large && image?.url ? <video key={image.url} src={image.url} controls preload="metadata" playsInline aria-label={image.alt || image.label} style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 1 }}>
        <a href={image.url}>فتح فيديو المنتج</a>
      </video> : <span aria-label="فيديو المنتج" style={{ position: "relative", zIndex: 1 }}>▶ فيديو</span>}
      <figcaption className="sr-only">{image?.alt || image?.label || "فيديو المنتج"}</figcaption>
    </figure>
  );

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
  account?: PublicAccount;
  compact: boolean;
  quoteCount: number;
  quoteOpen: boolean;
  hasLatestProducts?: boolean;
  onQuoteOpen: () => void;
};

export function StoreHeader({ compact, quoteCount, quoteOpen, hasLatestProducts = true, onQuoteOpen, account = publicAccountFor(null) }: StoreHeaderProps) {
  const quoteLabel = `طلب عرض السعر يحتوي على ${quoteCount.toLocaleString("ar-SA")} منتج`;
  return (
    <header className={`sf-header ${compact ? "sf-header-compact" : ""}`}>
      <div className="sf-header-layout mx-auto max-w-[90rem]">
        <a className="sf-brand" href="#top" aria-label="بُنية - متجر مواد البناء">
          <BunyaLogo priority sizes="(max-width: 700px) 128px, 152px" />
        </a>

        <nav className="sf-desktop-nav" aria-label="روابط المتجر">
          <a className="sf-nav-link" href="#products"><Icon name="grid" />المنتجات</a>
          {hasLatestProducts ? <a className="sf-nav-link" href="#latest"><Icon name="spark" />الأحدث</a> : null}
          <Link className="sf-nav-link sf-nav-contractor" href="/contractors"><Icon name="search" />ابحث عن مقاول</Link>
        </nav>

        <JoinLinks account={account} />

        <nav className="sf-desktop-portals" aria-label="حساب بُنية">
          {account.signedIn ? <PublicAccountLink account={account} /> : <Link className="sf-portal-link sf-portal-link-primary" href={account.href}>تسجيل الدخول</Link>}
        </nav>

        <div className="sf-mobile-account">{account.signedIn ? <PublicAccountLink account={account} /> : null}</div>
        <button aria-controls="store-quote-drawer" aria-expanded={quoteOpen} className="sf-icon-button sf-header-quote" aria-label={quoteLabel} onClick={onQuoteOpen} type="button">
          <Icon name="quote" /><span className="sf-quote-label">طلب السعر</span><span className="sf-count">{quoteCount.toLocaleString("ar-SA")}</span>
        </button>
      </div>

    </header>
  );
}

export function JoinLinks({ account = publicAccountFor(null) }: { account?: PublicAccount }) {
  if (!account.canApplyProvider && !account.canApplyContractor) return null;
  return <nav className="sf-join-links" aria-label="الانضمام إلى بُنية">
    <Link href="/join"><Icon name="userPlus" /><span>طلب انضمام</span></Link>
  </nav>;
}

export function PublicMobileNav({ active = "home", quoteCount = 0, onQuoteOpen }: { active?: "home" | "contractors"; quoteCount?: number; onQuoteOpen?: () => void }) {
  return <nav aria-label="التنقل الرئيسي" className="sf-mobile-tabs">
    <Link aria-current={active === "home" ? "page" : undefined} href={active === "home" ? "#top" : "/"}><Icon name="spark" /><span>الرئيسية</span></Link>
    <Link href={active === "home" ? "#products" : "/#products"}><Icon name="grid" /><span>المنتجات</span></Link>
    {onQuoteOpen ? <button aria-label="فتح طلب عرض السعر" onClick={onQuoteOpen} type="button"><span className="sf-mobile-tabs-quote"><Icon name="quote" />{quoteCount ? <b>{quoteCount.toLocaleString("ar-SA")}</b> : null}</span><span>طلب السعر</span></button>
      : <Link href="/?quote=review"><Icon name="quote" /><span>طلب السعر</span></Link>}
    <Link aria-current={active === "contractors" ? "page" : undefined} href="/contractors"><Icon name="search" /><span>المقاولون</span></Link>
  </nav>;
}

export function StoreQuickLinks({ account = publicAccountFor(null) }: { account?: PublicAccount }) {
  return (
    <nav className="sf-quick-links" aria-label="اختصارات بُنية">
      <a href="#products"><span className="sf-quick-icon"><Icon name="box" /></span><span>المنتجات</span></a>
      <Link href="/contractors"><span className="sf-quick-icon"><Icon name="helmet" /></span><span>ابحث عن مقاول</span></Link>
      <Link href={account.href}><span className="sf-quick-icon"><Icon name="user" /></span><span>{account.signedIn ? "ملفي الشخصي" : "تسجيل الدخول"}</span></Link>
    </nav>
  );
}

export function LatestProductCard({ product, onOpen }: { product: Product; index: number; onOpen: (product: Product, element: HTMLElement) => void }) {
  return (
    <button className="sf-latest-card text-start" onClick={(event) => onOpen(product, event.currentTarget)} type="button">
      <ProductArtwork image={product.images[0]} />
      <span className="sf-card-name">{product.name}</span>
      <span className="sf-card-meta"><b>{product.unit}</b><i aria-hidden="true" /><b>{product.delivery.window}</b></span>
    </button>
  );
}

export function ProductCard({ product, onOpen }: { product: Product; index: number; onOpen: (product: Product, element: HTMLElement) => void }) {
  return (
    <button aria-label={`عرض تفاصيل ${product.name}`} className="sf-product-card text-start" onClick={(event) => onOpen(product, event.currentTarget)} type="button">
      <span className="sf-card-visual-wrap">
        <ProductArtwork image={product.images[0]} />
        <span className="sf-card-availability">{product.catalogEntry ? "كتالوج بُنية" : product.availabilityStatus}</span>
      </span>
      <span className="sf-card-body">
        <span className="sf-card-category">{product.category}</span>
        <span className="sf-card-name">{product.name}</span>
        <span className="sf-card-description">{product.shortDescription || product.description}</span>
        <span className="sf-card-meta"><b>{product.unit}</b><i aria-hidden="true" /><b>{product.catalogEntry ? `${product.catalogEntry.variantCount.toLocaleString("ar-SA")} خيار` : product.delivery.window}</b></span>
        <span className="sf-card-open">عرض التفاصيل والمواصفات <span aria-hidden="true">←</span></span>
      </span>
    </button>
  );
}
