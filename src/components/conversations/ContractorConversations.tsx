"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import styles from "./ContractorConversations.module.css";
import { CollectionAccountSettings } from "./CollectionAccountSettings";

type Conversation = { id: string; number: number; customer_id: string; contractor_user_id: string; customer_name: string; contractor_name: string; status: string; project_id: string | null; accepted_quote_id: string | null; updated_at: string };
type Quote = { id: string; amount: number; duration_days: number; start_at: string; valid_until: string; status: string; commission_rate: number; commission_amount: number; accepted_at: string | null; terms_version: string; scope?: string };
type Message = { id: string; sender_id: string; kind: string; body: string; moderation: string; created_at: string; contractor_chat_quotes: Quote | Quote[] | null };
type Event = { id: string; action: string; details: { amount?: number }; created_at: string };
type Bank = { bank_name: string; beneficiary: string; iban: string };
type Transfer = { id: string; amount: number; reference: string; status: string; created_at: string };
const labels: Record<string, string> = { open: "محادثة مفتوحة", contracted: "عرض معتمد", completion_requested: "بانتظار تأكيد الإنجاز", completed: "مكتملة", disputed: "نزاع قيد المتابعة", closed: "مؤرشفة", pending: "بانتظار المراجعة", blocked: "محجوبة", released: "تم التسليم", rejected: "مرفوض", offered: "عرض سعر", accepted: "معتمد", changes_requested: "طُلب تعديله", superseded: "استُبدل بعرض معتمد", accept_quote: "اعتمد العميل العرض", reject_quote: "رفض العميل العرض", request_changes: "طلب العميل تعديل العرض", record_payment: "أكدت الإدارة استلام دفعة", request_completion: "طلب المقاول تأكيد الإنجاز", confirm_completion: "أكد العميل الإنجاز", dispute: "فُتح نزاع للمتابعة", resolve_dispute: "أعادت الإدارة المشروع للتنفيذ", close: "أرشفت الإدارة المحادثة" };
const money = (value: number) => `${Number(value).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;
const paymentLabels: Record<string,string> = { online_payment: "أكدت بوابة الدفع استلام المبلغ", payment_review: "دفعة تحتاج مراجعة المالية؛ التسوية موقوفة", confirmed: "تم التحقق", pending: "بانتظار التحقق", rejected: "لم يُعتمد التحويل" };
const date = (value: string) => new Date(value).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
const quoteOf = (message: Message) => Array.isArray(message.contractor_chat_quotes) ? message.contractor_chat_quotes[0] : message.contractor_chat_quotes;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorText(message: string) {
  if (/Rate limit/i.test(message)) return "أرسلت عدة رسائل خلال دقيقة. انتظر قليلًا ثم أعد المحاولة.";
  if (/expired|decided|already reviewed|Invalid state/i.test(message)) return "تغيّرت الحالة أو انتهت صلاحية العرض. حدّث المحادثة.";
  if (/Contact|Blocked contact/i.test(message)) return "لا يمكن تسليم نص يحتوي على بيانات تواصل.";
  if (/Verified customer/i.test(message)) return "أكمل التحقق من حساب العميل قبل فتح المحادثة.";
  if (/exceeds|reference already/i.test(message)) return "تحقق من المبلغ المتبقي ومرجع الدفعة؛ قد تكون مسجلة مسبقًا.";
  if (/Full payment/i.test(message)) return "يلزم توثيق سداد قيمة العرض قبل إغلاق الاتفاق.";
  if (/Online payment requires/i.test(message)) return "تحقق من نتيجة جلسة الدفع الإلكتروني قبل تسجيل التحويل.";
  if (/Transfer already/i.test(message)) return "إشعار التحويل مسجل بالفعل. راجع حالته قبل إعادة الإرسال.";
  if (/Not authorized|permission|Participants only/i.test(message)) return "لا تملك صلاحية هذا الإجراء. تحقق من حسابك.";
  if (/unavailable/i.test(message)) return "المقاول أو العرض غير متاح حاليًا.";
  return "تعذر تنفيذ الإجراء. تحقق من الاتصال ثم أعد المحاولة؛ لن يتكرر الإجراء عند إعادة المحاولة.";
}

export function ContractorConversations({ admin = false }: { admin?: boolean }) {
  const identity = useAuthIdentity();
  const params = useSearchParams();
  const target = params.get("contractor");
  const initialId = params.get("id");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState(initialId && uuid.test(initialId) ? initialId : "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [showQuote, setShowQuote] = useState(false);
  const [search, setSearch] = useState("");
  const [listPage, setListPage] = useState(0);
  const [messagePage, setMessagePage] = useState(0);
  const [eventPage, setEventPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [acceptId, setAcceptId] = useState("");
  const [paid, setPaid] = useState(0);
  const [now, setNow] = useState(0);
  const [bank, setBank] = useState<Bank | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [paymentReview, setPaymentReview] = useState(false);
  const [acceptedQuote, setAcceptedQuote] = useState<Quote | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const isCustomer = conversation?.customer_id === identity.userId;
  const isContractor = conversation?.contractor_user_id === identity.userId;

  const loadList = useCallback(async () => {
    const db = createClient();
    let query = db.from("contractor_conversations").select("*").order("updated_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const clean = search.trim().replace(/[%_,().\\]/g, "");
    if (clean) query = /^\d+$/.test(clean) ? query.eq("number", clean) : query.or(`customer_name.ilike.%${clean}%,contractor_name.ilike.%${clean}%`);
    const result = await query.range(listPage * 40, listPage * 40 + 39);
    if (result.error) throw result.error;
    setConversations((result.data ?? []) as Conversation[]);
  }, [filter, listPage, search, setConversations]);

  const loadThread = useCallback(async () => {
    if (!selectedId) return;
    const version = ++generation.current;
    const db = createClient();
    const [c, m, e, summary, transferResult] = await Promise.all([
      db.from("contractor_conversations").select("*").eq("id", selectedId).single(),
      db.from("contractor_chat_messages").select("*,contractor_chat_quotes(*)").eq("conversation_id", selectedId).order("created_at", { ascending: false }).order("id").range(messagePage * 50, messagePage * 50 + 49),
      db.from("contractor_chat_events").select("*").eq("conversation_id", selectedId).order("created_at", { ascending: false }).order("id").range(eventPage * 50, eventPage * 50 + 49),
      db.rpc("contractor_chat_summary", { p_id: selectedId }),
      db.from("contractor_chat_transfers").select("id,amount,reference,status,created_at").eq("conversation_id", selectedId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (version !== generation.current) return;
    setNow(Date.now());
    if (c.error || m.error || e.error || summary.error || transferResult.error) throw c.error || m.error || e.error || summary.error || transferResult.error;
    setConversation(c.data as Conversation);setMessages(((m.data ?? []) as Message[]).reverse());setEvents(((e.data ?? []) as Event[]).reverse());
    setPaid(Number(summary.data?.paid ?? 0));setAcceptedQuote(summary.data?.quote ?? null);
    setBank(summary.data?.bank ?? null);setPaymentReview(Boolean(summary.data?.payment_review));setTransfers(transferResult.data ?? []);
    if (admin && m.data?.length) {
      const original = await db.from("contractor_chat_originals").select("message_id,original_body").in("message_id", m.data.map(row => row.id));
      if (original.error) throw original.error;
      if (version === generation.current) setOriginals(Object.fromEntries((original.data ?? []).map(row => [row.message_id, row.original_body])));
    }
  }, [selectedId, messagePage, eventPage, admin]);

  const command = async (action: string, payload: Record<string, unknown> = {}, conversationId = selectedId) => {
    if (inFlight.current) return null;
    inFlight.current = true;setBusy(true);setError("");setNotice("");
    const signature = JSON.stringify({ action, payload, conversationId });
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await createClient().rpc("contractor_chat_command", { p_action: action, p_conversation: conversationId || null, p_payload: payload, p_key: retry.current.key });
      if (result.error) throw result.error;
      retry.current = null;
      if (admin) window.dispatchEvent(new Event("bunya:admin-data-changed"));
      setNotice(result.data?.moderation === "blocked" ? "حُجبت الرسالة ولم تصل للطرف الآخر." : result.data?.moderation === "pending" ? "حُفظت للمراجعة قبل تسليمها." : "تم توثيق الإجراء.");
      try { await Promise.all([loadList(), ...(selectedId ? [loadThread()] : [])]); }
      catch { setError("تم حفظ الإجراء، لكن تعذر تحديث العرض. اضغط تحديث لعرض النتيجة."); }
      return result.data as { id: string };
    } catch (error) { setError(errorText(error instanceof Error ? error.message : String((error as { message?: string }).message)));return null; }
    finally { inFlight.current = false;setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void loadList().catch(() => { if (active) setError("تعذر تحميل المحادثات. أعد المحاولة."); }).finally(() => { if (active) setLoading(false); }); }, 200);
    return () => { active = false;clearTimeout(timer); };
  }, [loadList]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) setThreadLoading(true); return loadThread(); }).catch(() => { if (active) setError("تعذر تحميل المحادثة أو لا تملك صلاحية عرضها."); }).finally(() => { if (active) setThreadLoading(false); });
    const timer = setInterval(() => { if (document.visibilityState === "visible" && messagePage === 0) void loadThread().catch(() => { if (active) setError("انقطع تحديث المحادثة. أعد المحاولة."); }); }, 10000);
    return () => { active = false;clearInterval(timer); };
  }, [selectedId, messagePage, loadThread]);

  const select = (id: string) => { generation.current++;setConversation(null);setMessages([]);setEvents([]);setOriginals({});setAcceptedQuote(null);setAcceptId("");setBody("");setShowQuote(false);setSelectedId(id);setMessagePage(0);setEventPage(0);setError("");setNotice(""); };
  const send = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault();if (await command("send", { body })) setBody(""); };
  const submitQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();const form = event.currentTarget;const data = new FormData(form);
    const result = await command("quote", { body: data.get("scope"), amount: Number(data.get("amount")), duration_days: Number(data.get("duration")), start_at: data.get("start"), valid_days: Number(data.get("valid")), terms_accepted: data.get("terms") === "on" });
    if (result) { form.reset();setShowQuote(false); }
  };
  const refresh = async () => { setError("");try { await Promise.all([loadList(), loadThread()]); } catch { setError("تعذر التحديث. أعد المحاولة."); } };
  const pay = async (reconcile = false) => {
    if (inFlight.current) return;inFlight.current = true;setBusy(true);setError("");
    try {
      const response = await fetch("/api/contractor-payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selectedId, reconcile }) });
      const result = await response.json();if (!response.ok) throw new Error(result.message || "تعذر بدء الدفع.");
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);else { await loadThread();setNotice("تم تحديث حالة الدفع من البوابة."); }
    } catch (error) { setError(error instanceof Error ? error.message : "تعذر الاتصال بخدمة الدفع."); } finally { inFlight.current = false;setBusy(false); }
  };

  return <section className={styles.page} dir="rtl">
    <header className={styles.pageHeader}><div><span>تواصل موثّق داخل بُنية</span><h1>{admin ? "أرشيف المحادثات والصفقات" : "المحادثات والعروض"}</h1></div><button disabled={busy} onClick={() => void refresh()}>تحديث</button></header>
    {admin ? <CollectionAccountSettings/> : null}
    {params.get("payment") === "returned" ? <p className={styles.notice}>عدت من بوابة الدفع. اضغط «التحقق من الدفع» لتحديث النتيجة؛ الرجوع من البوابة وحده لا يثبت السداد.</p> : null}
    {target && uuid.test(target) && !admin ? <div className={styles.start}><p>ابدأ محادثة مع المقاول الذي اخترته من الدليل.</p><button disabled={busy} onClick={() => void command("open", { contractor_id: target }, "").then(result => { if (result) select(result.id); })}>فتح المحادثة</button></div> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    <div className={styles.layout} data-selected={Boolean(selectedId)}>
      <aside className={styles.inbox} aria-label="قائمة المحادثات"><label className={styles.search}>بحث بالاسم أو رقم المحادثة<input type="search" value={search} onChange={e => { setSearch(e.target.value);setListPage(0); }} /></label><label className={styles.search}>الحالة<select value={filter} onChange={e => { setFilter(e.target.value);setListPage(0); }}><option value="all">كل المحادثات</option>{["open", "contracted", "completion_requested", "completed", "disputed", "closed"].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
        {loading ? <p role="status">جارٍ التحميل…</p> : conversations.length ? conversations.map(c => <button className={styles.conversation} key={c.id} aria-current={selectedId === c.id ? "true" : undefined} onClick={() => select(c.id)} disabled={busy}><small>محادثة #{c.number}</small><strong>{admin ? `${c.contractor_name} · ${c.customer_name}` : c.customer_id === identity.userId ? c.contractor_name : c.customer_name}</strong><span>{labels[c.status]}</span></button>) : <p className={styles.empty}>لا توجد محادثات مطابقة.<br/><Link href="/contractors">استعراض المقاولين</Link></p>}
        <div className={styles.pager}><button disabled={listPage === 0} onClick={() => setListPage(p => p - 1)}>السابق</button><span>{listPage + 1}</span><button disabled={conversations.length < 40} onClick={() => setListPage(p => p + 1)}>التالي</button></div>
      </aside>
      <div className={styles.thread}>
        {!selectedId ? <div className={styles.empty}><h2>كل اتفاق في مكان واحد</h2><p>اختر محادثة لمتابعة الرسائل والعروض والقرارات.</p></div> : <>
          <button className={styles.back} onClick={() => select("")} disabled={busy}>العودة للمحادثات</button>
          {threadLoading && !conversation ? <p role="status">جارٍ تحميل المحادثة…</p> : conversation ? <>
            <header className={styles.threadHeader}><div><small>محادثة #{conversation.number}</small><h2>{conversation.contractor_name}</h2><p>{conversation.customer_name} · {labels[conversation.status]}</p></div>{isContractor && conversation.status === "open" ? <button onClick={() => setShowQuote(v => !v)} aria-expanded={showQuote}>إرسال عرض سعر</button> : null}</header>
            <p className={styles.policy}>تُراجع الرسائل والعروض قبل وصولها للطرف الآخر. يُمنع تبادل وسائل التواصل أو الدفع خارج المنصة. تحفظ بُنية المحادثة لمتابعة الاتفاق وحل النزاعات.</p>
            {acceptedQuote ? <section className={styles.contract}><h3>العرض المعتمد</h3><dl><div><dt>الإجمالي شامل الضريبة إن وجبت</dt><dd>{money(acceptedQuote.amount)}</dd></div><div><dt>عمولة بُنية {acceptedQuote.commission_rate}% من مستحقات المقاول</dt><dd>{money(acceptedQuote.commission_amount)}</dd></div><div><dt>المدفوع المؤكد</dt><dd>{money(paid)}</dd></div><div><dt>المتبقي</dt><dd>{money(Math.max(0, acceptedQuote.amount - paid))}</dd></div></dl><p dir="auto" style={{ whiteSpace: "pre-wrap" }}>{acceptedQuote.scope}</p><p>اعتمد في {acceptedQuote.accepted_at ? date(acceptedQuote.accepted_at) : "—"}. تسجيل الاعتماد لا يعني تحصيل المبلغ.</p></section> : null}
            {paymentReview ? <p className={styles.error} role="alert">هذه الدفعة تتطلب مراجعة المالية بسبب استرداد أو اختلاف في المبلغ. أُوقف صرف مستحقات المقاول حتى التسوية.</p> : null}
            {acceptedQuote && (isCustomer || admin) ? <div className={styles.actions}><button disabled={busy} onClick={() => void pay(true)}>التحقق من الدفع</button>{isCustomer && !admin && !paymentReview && paid < acceptedQuote.amount && ["contracted", "completion_requested"].includes(conversation.status) ? <button disabled={busy || transfers.some(t => t.status === "pending")} onClick={() => void pay()}>دفع المتبقي إلكترونيًا</button> : null}</div> : null}
            {isCustomer && !admin && acceptedQuote && !paymentReview && paid < acceptedQuote.amount && ["contracted", "completion_requested"].includes(conversation.status) ? bank ? <details className={styles.history}><summary>التحويل إلى حساب المنصة</summary><dl><dt>البنك</dt><dd>{bank.bank_name}</dd><dt>المستفيد</dt><dd>{bank.beneficiary}</dd><dt>الآيبان</dt><dd dir="ltr" style={{ overflowWrap: "anywhere" }}>{bank.iban}</dd></dl><p>حوّل إلى حساب بُنية الموضح فقط. سيبقى السداد قيد التحقق حتى تؤكد الإدارة وصول المبلغ.</p><form className={styles.quoteForm} onSubmit={e => { e.preventDefault();const form = e.currentTarget;const data = new FormData(form);void command("transfer_notice", { amount: Number(data.get("amount")), reference: data.get("reference") }).then(result => { if (result) form.reset(); }); }}><label>المبلغ المحول<input type="number" name="amount" required min="0.01" max={acceptedQuote.amount - paid} step="0.01"/></label><label>مرجع التحويل البنكي<input name="reference" required minLength={4} maxLength={120}/></label><button disabled={busy || transfers.some(t => t.status === "pending")}>إرسال إشعار التحويل للإدارة</button></form></details> : <p className={styles.policy}>التحويل البنكي متاح بعد إضافة حساب تحصيل المنصة.</p> : null}
            {transfers.length ? <details className={styles.history}><summary>إشعارات التحويل البنكي</summary>{transfers.map(transfer => <article className={styles.message} key={transfer.id}><strong>{money(transfer.amount)} · {paymentLabels[transfer.status]}</strong><p>المرجع: <bdi>{transfer.reference}</bdi></p><small>{date(transfer.created_at)}</small>{admin && transfer.status === "pending" ? <form onSubmit={e => { e.preventDefault();void command("record_payment", { transfer_id: transfer.id, payment_confirmed: true }); }}><label className={styles.check}><input type="checkbox" required/>تحققت من استلام المبلغ فعليًا في حساب المنصة ومن مطابقة المرجع.</label><button disabled={busy}>تأكيد التحويل واحتساب العمولة</button><button type="button" disabled={busy} onClick={() => void command("reject_transfer", { transfer_id: transfer.id })}>رفض الإشعار</button></form> : null}</article>)}</details> : null}
            {showQuote && isContractor ? <form className={styles.quoteForm} onSubmit={submitQuote}><h3>عرض سعر موثّق</h3><label className={styles.full}>نطاق الأعمال والمشمولات والاستثناءات والضمان<textarea name="scope" required minLength={10} maxLength={4000} rows={4} /></label><label>الإجمالي شامل الضريبة إن وجبت<input name="amount" type="number" min="0.01" max="99999999.99" step="0.01" required /></label><label>مدة التنفيذ بالأيام<input name="duration" type="number" min="1" max="3650" required /></label><label>بدء التنفيذ<input name="start" type="date" min={new Date().toISOString().slice(0,10)} required /></label><label>صلاحية العرض بالأيام<input name="valid" type="number" min="1" max="30" defaultValue="7" required /></label><label className={styles.check}><input type="checkbox" name="terms" required />أقر بصحة العرض وبعمولة بُنية 5% من قيمته تخصم من مستحقاتي، وأن الاتفاق والمدفوعات موثقة عبر المنصة.</label><button disabled={busy} type="submit">إرسال العرض للمراجعة</button><button type="button" onClick={() => setShowQuote(false)}>إلغاء</button></form> : null}
            <div className={styles.pager}><button disabled={messages.length < 50} onClick={() => setMessagePage(p => p + 1)}>رسائل أقدم</button><span>{messagePage + 1}</span><button disabled={!messagePage} onClick={() => setMessagePage(p => p - 1)}>رسائل أحدث</button></div>
            <div className={styles.messages} aria-label="سجل الرسائل" aria-busy={threadLoading}>
              {!messages.length ? <p className={styles.empty}>لا توجد رسائل متاحة بعد.</p> : messages.map(message => {
                const q = quoteOf(message);const own = message.sender_id === identity.userId;
                return <article className={styles.message} data-own={own} key={message.id}><header><strong>{message.sender_id === conversation.contractor_user_id ? conversation.contractor_name : conversation.customer_name}</strong><small>{date(message.created_at)} · {labels[message.moderation]}</small></header><p dir="auto">{message.body}</p>
                  {q ? <div className={styles.offer}><strong>{money(q.amount)} · {labels[q.status]}</strong><span>{q.duration_days} يوم · البدء {q.start_at}</span><span>صالح حتى {date(q.valid_until)}</span><span>عمولة بُنية {q.commission_rate}%: {money(q.commission_amount)} من مستحقات المقاول</span>
                    {isCustomer && !admin && message.moderation === "released" && q.status === "offered" && conversation.status === "open" && new Date(q.valid_until).getTime() > now ? <div className={styles.actions}>{acceptId === q.id ? <form onSubmit={e => { e.preventDefault();void command("accept_quote", { quote_id: q.id, terms_accepted: true }).then(r => { if (r) setAcceptId(""); }); }}><p>ستعتمد هذا العرض بقيمة {money(q.amount)} ونطاق الأعمال أعلاه.</p><label className={styles.check}><input type="checkbox" required />قرأت العرض وأوافق على توثيق الاتفاق والدفع عبر بُنية.</label><button disabled={busy}>تأكيد الاعتماد</button><button type="button" disabled={busy} onClick={() => setAcceptId("")}>رجوع</button></form> : <><button disabled={busy} onClick={() => setAcceptId(q.id)}>اعتماد العرض</button><button disabled={busy} onClick={() => void command("request_changes", { quote_id: q.id })}>طلب تعديل</button><button disabled={busy} onClick={() => void command("reject_quote", { quote_id: q.id })}>رفض العرض</button></>}</div> : null}
                  </div> : null}
                  {admin ? <details className={styles.review}><summary>سجل المراجعة والنص الأصلي</summary><p dir="auto">{originals[message.id] ?? "—"}</p>{["pending", "blocked"].includes(message.moderation) ? <form onSubmit={e => { e.preventDefault();const form = new FormData(e.currentTarget);void command("release", { message_id: message.id, body: form.get("body"), review_confirmed: true }); }}>
                    {message.moderation === "pending" ? <><label>النص الذي سيصل للطرف الآخر<textarea name="body" defaultValue={message.body} readOnly={message.kind === "quote"} required maxLength={4000} rows={3} /></label><label className={styles.check}><input type="checkbox" required />راجعت النص والعرض وسياق الرسائل السابقة، ولا تحتوي على تواصل خارجي أو ترميز له.</label><button disabled={busy}>اعتماد وتسليم</button></> : <p>الرسالة المحجوبة لا يمكن تسليمها.</p>}<button type="button" disabled={busy} onClick={() => void command("reject_message", { message_id: message.id })}>رفض وحفظ بالأرشيف</button></form> : null}</details> : null}
                </article>;
              })}
            </div>
            {events.length || eventPage ? <details className={styles.history}><summary>سجل الإجراءات الموثقة</summary><div className={styles.pager}><button disabled={events.length < 50} onClick={() => setEventPage(p => p + 1)}>إجراءات أقدم</button><span>{eventPage + 1}</span><button disabled={!eventPage} onClick={() => setEventPage(p => p - 1)}>إجراءات أحدث</button></div><ol>{events.map(event => <li key={event.id}><strong>{labels[event.action] ?? paymentLabels[event.action] ?? event.action}</strong>{event.details.amount != null ? ` · ${money(event.details.amount)}` : ""}<small>{date(event.created_at)}</small></li>)}</ol></details> : null}
            <div className={styles.actions}>
              {isContractor && conversation.status === "contracted" ? <button disabled={busy} onClick={() => void command("request_completion")}>طلب تأكيد الإنجاز</button> : null}
              {isCustomer && conversation.status === "completion_requested" ? <button disabled={busy} onClick={() => void command("confirm_completion")}>تأكيد اكتمال الأعمال</button> : null}
              {!admin && ["contracted", "completion_requested"].includes(conversation.status) ? <button disabled={busy} onClick={() => void command("dispute")}>رفع نزاع للإدارة</button> : null}
              {admin && conversation.status === "disputed" ? <button disabled={busy} onClick={() => void command("resolve_dispute")}>إعادة المشروع للتنفيذ بعد المراجعة</button> : null}
              {admin && conversation.status === "open" ? <button disabled={busy} onClick={() => void command("close")}>أرشفة المحادثة</button> : null}
            </div>
            {admin && conversation.project_id && ["contracted", "completion_requested"].includes(conversation.status) ? <details className={styles.history}><summary>توثيق دفعة مستلمة — صلاحية المالية مطلوبة</summary><form className={styles.quoteForm} onSubmit={e => { e.preventDefault();const form = e.currentTarget;const data = new FormData(form);void command("record_payment", { amount: Number(data.get("amount")), reference: data.get("reference"), payment_confirmed: true }).then(result => { if (result) form.reset(); }); }}><label>المبلغ المستلم<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>مرجع العملية البنكية<input name="reference" minLength={4} maxLength={120} required /></label><label className={styles.check}><input type="checkbox" required />تحققت من استلام هذه الدفعة فعليًا في حساب المنصة، ولم تُسجل سابقًا.</label><button disabled={busy}>توثيق الدفعة واحتساب العمولة</button></form></details> : null}
            {!admin && !["closed", "completed"].includes(conversation.status) ? <form className={styles.composer} onSubmit={send}><label htmlFor="chat-body" className={styles.srOnly}>رسالتك</label><textarea id="chat-body" placeholder="اكتب عن تفاصيل المشروع…" value={body} onChange={e => setBody(e.target.value)} maxLength={4000} required rows={2} disabled={busy}/><button disabled={busy || !body.trim()}>{busy ? "جارٍ الحفظ…" : "إرسال"}</button></form> : null}
          </> : null}
        </>}
      </div>
    </div>
  </section>;
}
