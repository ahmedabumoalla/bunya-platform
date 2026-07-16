type DashboardStatCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: "earth" | "green" | "clay";
};

const toneClasses = {
  earth: "border-[#5a3a1f]/15 bg-[#fffaf1] text-[#5a3a1f]",
  green: "border-[#214536]/20 bg-[#dce8d7] text-[#214536]",
  clay: "border-[#b76734]/20 bg-[#fff2e8] text-[#8f5f2e]",
};

export function DashboardStatCard({
  label,
  value,
  detail,
  tone = "earth",
}: DashboardStatCardProps) {
  return (
    <article className={`glass-card motion-card rounded-lg border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-black opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-black md:text-4xl">{value}</p>
      {detail ? <p className="mt-3 text-sm leading-7 opacity-75">{detail}</p> : null}
    </article>
  );
}
