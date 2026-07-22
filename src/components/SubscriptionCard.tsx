import type { SubscriptionPlan } from "@/lib/bunya-types";

type SubscriptionCardProps = {
  plan: SubscriptionPlan;
  compact?: boolean;
};

export function SubscriptionCard({ plan, compact = false }: SubscriptionCardProps) {
  return (
    <article className="glass-card motion-card rounded-lg border border-[#5a3a1f]/15 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#b76734]">
            {plan.role === "provider" ? "ظ„ظ„ظ…ط²ظˆط¯ظٹظ†" : "ظ„ظ„ظ…ظ‚ط§ظˆظ„ظٹظ†"}
          </p>
          <h3 className="mt-2 text-2xl font-black">{plan.name}</h3>
        </div>
        <p className="rounded-lg bg-[#214536] px-4 py-3 text-sm font-black text-white">
          {plan.priceMonthly.toLocaleString("ar-SA")} ط±ظٹط§ظ„ ط´ظ‡ط±ظٹط§
        </p>
      </div>
      <p className="mt-4 leading-7 text-[#766b5d]">{plan.description}</p>
      {!compact ? (
        <ul className="mt-5 grid gap-2 text-sm font-bold leading-7 text-[#5a3a1f]">
          {plan.benefits.map((benefit) => (
            <li key={benefit} className="rounded-lg bg-[#f7f2e8] px-3 py-2">
              {benefit}
            </li>
          ))}
        </ul>
      ) : null}
      <button className="premium-button mt-5 w-full rounded-lg bg-[#b76734] px-4 py-3 text-sm font-black text-white transition hover:bg-[#965227]">
        {plan.cta}
      </button>
    </article>
  );
}

