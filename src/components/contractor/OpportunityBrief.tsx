import { ProjectMediaGallery } from "@/components/customer/ProjectMedia";

const number = new Intl.NumberFormat("ar-SA");
const calendar = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long", timeZone: "Asia/Riyadh" });
function formatDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? calendar.format(date) : null;
}
function budget(min: unknown, max: unknown) {
  if (max == null && min == null) return "لم يحدد العميل ميزانية";
  if (min == null) return `حتى ${number.format(Number(max))} ريال`;
  if (max == null) return `من ${number.format(Number(min))} ريال`;
  if (Number(min) === Number(max)) return `${number.format(Number(max))} ريال`;
  return `من ${number.format(Number(min))} إلى ${number.format(Number(max))} ريال`;
}

export function OpportunityBrief({ opportunity: op }: { opportunity: Record<string,unknown> }) {
  const description = String(op.description ?? "").trim();
  const scope = String(op.scope ?? "").trim();
  const requirements = Array.isArray(op.terms) ? op.terms.filter(Boolean) : [];
  const facts = [
    ["الميزانية التقديرية", budget(op.estimated_budget_min,op.estimated_budget_max) + (op.budget_negotiable ? " · قابلة للتفاوض" : "")],
    ["موقع التنفيذ", [op.city,op.region].filter(Boolean).join("، ")],
    ["نوع المشروع", op.project_type],
    ["تاريخ البدء المتوقع", formatDate(op.expected_start_at)],
    ["مدة التنفيذ المتوقعة", op.estimated_duration],
    ["آخر موعد لتقديم العرض", formatDate(op.proposal_deadline_at) || "التقديم مفتوح دون موعد نهائي"],
  ];
  return <section className="database-panel contractor-proposal-brief" aria-label="تفاصيل الفرصة">
    <h2>المطلوب تنفيذه</h2>
    {description && <p>{description}</p>}
    {scope && scope !== description && <section className="contractor-proposal-scope"><h3>نطاق الأعمال</h3><p>{scope}</p></section>}
    <dl className="contractor-catalog-facts">{facts.filter(([,v])=>v).map(([k,v])=><div key={String(k)}><dt>{String(k)}</dt><dd>{String(v)}</dd></div>)}
      <div><dt>الكميات أو المقاسات</dt><dd>{String(op.quantity_label || "لم يحددها العميل")}</dd></div>
    </dl>
    {requirements.length>0 && <section className="contractor-proposal-scope"><h3>اشتراطات العميل</h3><ul>{requirements.map((term,i)=><li key={i}>{String(term)}</li>)}</ul></section>}
    <ProjectMediaGallery key={String(op.project_request_id)} projectId={String(op.project_request_id)}/>
  </section>;
}
