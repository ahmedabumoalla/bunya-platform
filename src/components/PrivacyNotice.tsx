type PrivacyNoticeProps = {
  title?: string;
  children?: React.ReactNode;
};

export function PrivacyNotice({
  title = "تنبيه خصوصية",
  children,
}: PrivacyNoticeProps) {
  return (
    <aside className="glass-card motion-card rounded-lg border border-[#214536]/20 bg-[#dce8d7]/80 p-5 text-[#214536]">
      <p className="text-sm font-black">{title}</p>
      <p className="mt-2 leading-7">
        {children ??
          "تخفي بُنية أسماء التجار والعملاء والمقاولين عن الأطراف التشغيلية، ولا تظهر عروض المنافسين إلا داخل لوحة الأدمن للمراجعة."}
      </p>
    </aside>
  );
}
