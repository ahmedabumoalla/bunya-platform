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
    <div className="public-page-heading">
      <div>
        <p>{eyebrow}</p>
        <h1>
          {title}
        </h1>
        <span>{description}</span>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
