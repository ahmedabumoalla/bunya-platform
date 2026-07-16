type SectionTitleProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function SectionTitle({ eyebrow, title, description }: SectionTitleProps) {
  return (
    <div className="mb-8 max-w-3xl">
      {eyebrow ? (
        <p className="mb-3 text-sm font-black text-[#b76734]">{eyebrow}</p>
      ) : null}
      <h2 className="text-3xl font-black leading-tight text-[#211b14] md:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-lg leading-8 text-[#766b5d]">{description}</p>
      ) : null}
    </div>
  );
}
