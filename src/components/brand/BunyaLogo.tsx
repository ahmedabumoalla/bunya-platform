import Image from "next/image";

type BunyaLogoProps = {
  variant?: "color" | "white";
  markOnly?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
  alt?: string;
};

export function BunyaLogo({
  variant = "color",
  markOnly = false,
  priority = false,
  sizes = "(max-width: 640px) 40px, 52px",
  className = "",
  alt = "شعار بُنية",
}: BunyaLogoProps) {
  const mode = variant === "white" ? "white" : "color";
  const src = variant === "white"
    ? "/brand/bunya-mark-color2.png"
    : "/brand/bunya-mark-color1.png";

  return (
    <span className={`bunya-logo bunya-logo-${mode} ${markOnly ? "bunya-logo-mark-only" : ""} ${className}`.trim()}>
      <Image alt={alt} className="bunya-logo-image" height={3394} priority={priority} sizes={sizes} src={src} width={4525} />
    </span>
  );
}
