import Link from "next/link";
import type { SubscriptionPlan } from "@/lib/bunya-types";

export function SubscriptionCard({ plan, compact = false }: { plan: SubscriptionPlan; compact?: boolean }) {
  return <article className="subscription-card">
    <header><div><p>{plan.role === "provider" ? "للموردين" : "للمقاولين"}</p><h2>{plan.name}</h2></div><strong>{plan.priceMonthly.toLocaleString("ar-SA")} <small>ريال / شهر</small></strong></header>
    <p>{plan.description}</p>
    {!compact && <ul>{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>}
    <Link href={plan.role === "provider" ? "/providers/join" : "/contractors/join"}>{plan.cta || "طلب انضمام"}</Link>
  </article>;
}
