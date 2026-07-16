import type { ReactNode } from "react";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
  strong?: boolean;
};

export function GlassCard({ children, className = "", strong = false }: GlassCardProps) {
  return (
    <div className={`${strong ? "glass-card-strong" : "glass-card"} rounded-lg ${className}`}>
      {children}
    </div>
  );
}
