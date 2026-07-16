import type { ReactNode } from "react";

type MotionCardProps = {
  children: ReactNode;
  className?: string;
  from?: "right" | "left" | "bottom" | "scale";
  delay?: 1 | 2 | 3;
};

export function MotionCard({
  children,
  className = "",
  from = "scale",
  delay,
}: MotionCardProps) {
  const directionClass =
    from === "right"
      ? "from-right"
      : from === "left"
        ? "from-left"
        : from === "bottom"
          ? "from-bottom"
          : "";
  const delayClass = delay ? `delay-${delay}` : "";

  return (
    <div className={`motion-card animate-in ${directionClass} ${delayClass} ${className}`}>
      {children}
    </div>
  );
}
