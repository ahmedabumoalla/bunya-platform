"use client";
import Link from "next/link";
import{FormEvent,useEffect,useState}from"react";import{useRouter}from"next/navigation";import{createClient}from"@/lib/supabase/client";
export function OpportunityProposal({id}:{id:string}) {
 const r=useRouter(),[op,setOp]=useState<Record<string,unknown>|null>(null),[msg,setMsg]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;void Promise.resolve(createClient().rpc("get_contractor_opportunities")).then(({data,error})=>{if(!active)return;if(error)setMsg(error.message);setOp((data??[]).find((x:Record<string,unknown>)=>x.opportunity_id===id)||null);setLoading(false)}).catch(()=>{if(active){setMsg("تعذر تحميل تفاصيل الفرصة. حاول مرة أخرى.");setLoading(false)}});return()=>{active=false}},[id,attempt]);
 async function submit(e:FormEvent<HTMLFormElement>,final:boolean){
  e.preventDefault();if(busy)return;const d=new FormData(e.currentTarget),amount=Number(d.get("amount")),expected=String(d.get("stage_date"));setBusy(true);setMsg("");
  try { const{data,error}=await createClient().rpc("save_contractor_proposal",{p_opportunity_id:id,p_proposal:{amount,vat_inclusive:d.get("vat")==="on",execution_duration:d.get("duration"),proposed_start_at:d.get("start"),scope_details:d.get("scope"),includes:[],excludes:[],valid_until:new Date(String(d.get("valid"))).toISOString(),warranty:d.get("warranty"),team:d.get("team"),notes:d.get("notes"),policy_accepted:d.get("policy")==="on"},p_stages:[{name:"التنفيذ",description:String(d.get("scope")),duration:String(d.get("duration")),value_percentage:100,expected_at:expected,sort_order:0}],p_submit:final,p_idempotency_key:crypto.randomUUID()});if(error)setMsg(error.message);else r.push(`/contractor/proposals/${data}`) } catch {setMsg("تعذر إرسال العرض. تحقق من الاتصال وحاول مرة أخرى.")} finally {setBusy(false)}
 }
 if(loading||!op)return <section className="database-page contractor-catalog-page contractor-proposal-page"><section className="database-state" role={msg?"alert":"status"} aria-live="polite">{loading?<><span className="database-spinner" aria-hidden="true"/><h1>جارٍ تحميل الفرصة</h1><p>نجهّز تفاصيل المشروع لتقديم عرضك.</p></>:<><h1>{msg?"تعذر تحميل الفرصة":"الفرصة غير متاحة حاليًا"}</h1><p>{msg||"قد تكون مهلة تقديم العروض انتهت. يمكنك العودة لاستعراض الفرص المتاحة."}</p><div className="contractor-proposal-state-actions"><Link href="/contractor/opportunities">العودة إلى الفرص</Link>{msg?<button type="button" onClick={()=>{setMsg("");setLoading(true);setAttempt(value=>value+1)}}>إعادة المحاولة</button>:null}</div></>}</section></section>;
 return <section className="database-page contractor-catalog-page contractor-proposal-page">
  <header className="database-page-header"><div><p>فرص المشاريع · تقديم عرض</p><h1>عرضك لتنفيذ المشروع</h1><span>حدد نطاق التنفيذ والتكلفة والمدة ليتمكن العميل من مراجعة عرضك.</span></div><Link className="contractor-proposal-back" href="/contractor/opportunities">العودة إلى الفرص</Link></header>
  <div className="contractor-proposal-layout">
   <aside className="database-panel contractor-proposal-brief" aria-labelledby="contractor-project-brief"><span className="contractor-catalog-eyebrow">ملخص المشروع</span><h2 id="contractor-project-brief">{String(op.title)}</h2><p>{String(op.description)}</p>
    <dl className="contractor-catalog-facts"><div><dt>نوع المشروع</dt><dd>{String(op.project_type??"غير محدد")}</dd></div><div><dt>الموقع</dt><dd>{[op.city,op.region].filter(Boolean).map(String).join("، ")||"غير محدد"}</dd></div>{op.expected_start_at?<div><dt>البدء المتوقع</dt><dd>{String(op.expected_start_at)}</dd></div>:null}{op.estimated_duration?<div><dt>المدة المتوقعة</dt><dd>{String(op.estimated_duration)}</dd></div>:null}{op.quantity_label?<div className="wide"><dt>حجم العمل</dt><dd>{String(op.quantity_label)}</dd></div>:null}</dl>
    {op.scope?<section className="contractor-proposal-scope"><h3>نطاق المشروع</h3><p>{String(op.scope)}</p></section>:null}{Array.isArray(op.terms)&&op.terms.length?<section className="contractor-proposal-scope"><h3>متطلبات المشروع</h3><ul>{op.terms.map((term,index)=><li key={index}>{String(term)}</li>)}</ul></section>:null}
   </aside>
   <form className="database-panel application-form contractor-proposal-form" aria-busy={busy} onSubmit={e=>void submit(e,true)}>
    <fieldset className="contractor-catalog-section"><legend>التكلفة والجدول الزمني</legend><p>أدخل المبلغ الإجمالي ومواعيد التنفيذ وصلاحية العرض.</p><div className="contractor-catalog-fields">
     {[["amount","المبلغ"],["duration","مدة التنفيذ"],["start","تاريخ البدء"],["valid","صلاحية العرض"],["stage_date","موعد نهاية المرحلة"]].map(([n,l])=><label className="portal-field" key={n}><span>{l}</span><input name={n} required type={n==="amount"?"number":['start','stage_date'].includes(n)?"date":n==="valid"?"datetime-local":"text"}/></label>)}
     <label className="contractor-catalog-check"><input name="vat" type="checkbox"/><span>المبلغ شامل الضريبة</span></label>
    </div></fieldset>
    <fieldset className="contractor-catalog-section"><legend>خطة التنفيذ</legend><p>اشرح ما يشمله العرض، والفريق والضمان الذي تقدمه.</p><div className="contractor-catalog-fields">
     <label className="portal-field wide"><span>نطاق العرض</span><textarea name="scope" rows={5} required/></label>
     {[["warranty","الضمان"],["team","الفريق"]].map(([n,l])=><label className="portal-field" key={n}><span>{l}</span><input name={n} required type="text"/></label>)}
     <label className="portal-field wide"><span>ملاحظات <small>اختياري</small></span><textarea name="notes" rows={3}/></label>
    </div></fieldset>
    <div className="contractor-proposal-confirmation"><label className="contractor-catalog-check"><input name="policy" type="checkbox" required/><span>أوافق على السياسة</span></label><p>راجع تفاصيل العرض والمواعيد قبل إرساله.</p></div>
    {msg?<p className="contractor-catalog-form-error" role="alert">{msg}</p>:null}<footer className="contractor-catalog-actions"><p aria-live="polite">{busy?"جارٍ إرسال عرضك…":"سيُرسل عرضك إلى العميل للمراجعة."}</p><button disabled={busy} className="portal-primary-button contractor-catalog-primary">{busy?"جارٍ الإرسال…":"تقديم العرض"}</button></footer>
   </form>
  </div>
 </section>
}

export function ProposalDecision({id}:{id:string}){const r=useRouter(),[msg,setMsg]=useState("");async function decide(decision:string){const reason=prompt("سبب القرار (خمسة أحرف على الأقل)");if(!reason)return;const{data,error}=await createClient().rpc("decide_contractor_proposal",{p_proposal_id:id,p_decision:decision,p_reason:reason,p_idempotency_key:crypto.randomUUID()});if(error)setMsg(error.message);else{setMsg("تم تسجيل القرار.");if(data)r.push(`/customer/project-requests`)}}return <main className="database-page"><h1>قرار عرض المقاول</h1><section className="database-panel">{msg?<p>{msg}</p>:null}<button onClick={()=>void decide("accepted")}>قبول</button><button onClick={()=>void decide("needs_changes")}>طلب تعديلات</button><button onClick={()=>void decide("rejected")}>رفض</button></section></main>}

export { ProjectRequestForm, ProjectProposalDecisions } from "@/components/customer/CustomerProjectWorkflows";
