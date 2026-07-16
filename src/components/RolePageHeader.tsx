type RolePageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
};

export function RolePageHeader({
  eyebrow,
  title,
  description,
  actions,
}: RolePageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-4xl">
        <p className="mb-3 text-sm font-black text-[#b76734]">{eyebrow}</p>
        <h1 className="text-3xl font-black leading-tight text-[#211b14] md:text-5xl">
          {title}
        </h1>
        <p className="mt-4 text-lg leading-8 text-[#766b5d]">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
