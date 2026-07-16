type EmptyStateProps = {
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-[#5a3a1f]/25 bg-[#fffaf1]/70 p-8 text-center">
      <p className="text-xl font-black text-[#214536]">{title}</p>
      <p className="mx-auto mt-3 max-w-xl leading-7 text-[#766b5d]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
