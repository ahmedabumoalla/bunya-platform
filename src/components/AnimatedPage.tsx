import type { ReactNode } from "react";

export function AnimatedPage({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
