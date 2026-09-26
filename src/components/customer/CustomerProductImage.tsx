"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { customerProductImage } from "@/lib/products/customer-images";
import styles from "./CustomerProductImage.module.css";

export function CustomerProductImage({ productId, src, name, variant = "line", className = "" }: { productId?: string | null; src?: string | null; name: string; variant?: "tile" | "line" | "hero"; className?: string }) {
  const { userId } = useAuthIdentity();
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState("");
  const key = `${userId}:${productId ?? ""}`;
  useEffect(() => {
    if (src || !productId) return;
    let active = true;
    void customerProductImage(productId, userId).then(url => { if (active) setResolved({ key, url }); });
    return () => { active = false; };
  }, [productId, src, userId, key]);
  const url = src || (resolved?.key === key ? resolved.url : "");
  const loading = !src && !!productId && resolved?.key !== key;
  return <div className={`${styles.image} ${styles[variant]} ${className}`}>
    {url && failed !== url ? <Image src={url} alt={name} fill unoptimized sizes={variant === "line" ? "(max-width: 640px) 112px, 164px" : "(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 320px"} onError={() => setFailed(url)} /> : <div className={styles.fallback} role={loading ? "status" : undefined} aria-label={loading ? `جارٍ تحميل صورة ${name}` : `صورة ${name} غير متاحة`}><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m20 4 14 8v16l-14 8-14-8V12l14-8Zm0 16 14-8M20 20 6 12m14 8v16M13 8l14 8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg><span>{loading ? "تحميل الصورة…" : "الصورة غير متاحة"}</span></div>}
  </div>;
}
