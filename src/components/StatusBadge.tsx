type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: "green" | "sand" | "clay" | "slate";
};

const toneClasses = {
  green: "border-[#214536]/20 bg-[#dce8d7] text-[#214536]",
  sand: "border-[#5a3a1f]/15 bg-[#f7f2e8] text-[#5a3a1f]",
  clay: "border-[#b76734]/20 bg-[#fff2e8] text-[#8f5f2e]",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

export function StatusBadge({ children, tone = "sand" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-lg border px-3 py-2 text-xs font-black ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
