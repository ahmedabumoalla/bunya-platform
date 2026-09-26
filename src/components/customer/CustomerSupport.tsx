"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { optimizeUploadFile } from "@/lib/uploads/client";
import styles from "./CustomerSupport.module.css";

type Message = { id: string; author_profile_id: string; body: string; is_internal: boolean; created_at: string };
type Attachment = { id: string; ticket_id: string; message_id: string | null; storage_path: string; file_name: string; mime_type: string; size_bytes: number };
type Ticket = { id: string; ticket_code: string; subject: string; description: string; category: string; priority: string; status: string; created_at: string; updated_at: string; support_messages: Message[]; attachments: Attachment[] };
type PendingUploads = { ticketId: string; messageId: string | null; files: File[] };
const db = createClient();
const categories: Record<string, string> = { general: "استفسار عام", orders: "طلبات الشراء", quotes: "عروض الأسعار", delivery: "التوصيل والاستلام", billing: "الدفع والفواتير", projects: "مشاريع المقاولات", account: "الحساب والبيانات" };
const statusLabels: Record<string, string> = { open: "مفتوحة", in_progress: "قيد المتابعة", resolved: "تم الحل", closed: "مغلقة" };
const priorityLabels: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية" };
const emptyForm = { category: "general", subject: "", description: "", priority: "normal" };
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const formatDate = (value: string) => new Date(value).toLocaleString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });

function validateFiles(files: File[]) {
  for (const file of files) {
    if (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) throw new Error(`الملف «${file.name}» غير مدعوم. اختر صورة JPG أو PNG أو WebP أو ملف PDF بحجم لا يتجاوز 5 ميجابايت.`);
  }
}

function FilePicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean }) {
  return <label className={styles.filePicker}><span>إرفاق مستند أو صورة <small>اختياري</small></span><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled} onChange={(event) => onChange(Array.from(event.target.files ?? []))} /><small>JPG، PNG، WebP أو PDF · حتى 5 ميجابايت لكل ملف</small>{files.length ? <span className={styles.fileNames}>{files.map((file) => file.name).join("، ")}</span> : null}</label>;
}

function PrivateAttachment({ attachment, onError }: { attachment: Attachment; onError: (message: string) => void }) {
  const [access, setAccess] = useState<{ url: string; expiresAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const prepare = async () => {
    setLoading(true);
    try {
      const result = await db.storage.from("support-private").createSignedUrl(attachment.storage_path, 300);
      if (result.error || !result.data?.signedUrl) throw new Error("attachment_unavailable");
      setAccess({ url: result.data.signedUrl, expiresAt: Date.now() + 290_000 });
    } catch { onError("تعذر فتح المرفق. أعد المحاولة بعد التحقق من الاتصال."); }
    finally { setLoading(false); }
  };
  return <div className={styles.attachment}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3h7l4 4v14H5V3h3Zm7 0v5h4M8 12h8M8 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg><div>{access ? <a href={access.url} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (Date.now() >= access.expiresAt) { event.preventDefault(); void prepare(); } }}>فتح {attachment.file_name}</a> : <button type="button" disabled={loading} onClick={() => void prepare()}>{loading ? "جارٍ تجهيز الملف…" : `عرض ${attachment.file_name}`}</button>}<small>{attachment.mime_type === "application/pdf" ? "PDF" : "صورة"} · {(attachment.size_bytes / 1024).toLocaleString("ar-SA", { maximumFractionDigits: 0 })} كيلوبايت{access ? " · جاهز للفتح في نافذة جديدة" : ""}</small></div></div>;
}

export function CustomerSupport() {
  const { userId } = useAuthIdentity();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUploads | null>(null);
  const createKey = useRef<{ body: string; key: string } | null>(null);
  const replyKey = useRef<{ body: string; key: string } | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const threadHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const result = await db.from("support_tickets")
      .select("id,ticket_code,subject,description,category,priority,status,created_at,updated_at,support_messages(id,author_profile_id,body,is_internal,created_at)")
      .eq("opened_by", userId).eq("support_messages.is_internal", false).order("created_at", { ascending: false });
    if (result.error) throw new Error("تعذر تحميل تذاكرك. أعد المحاولة بعد التحقق من الاتصال.");
    const rows = (result.data ?? []) as Omit<Ticket, "attachments">[];
    let attachments: Attachment[] = [];
    if (rows.length) {
      const visibleMessageIds = rows.flatMap((ticket) => ticket.support_messages.filter((item) => !item.is_internal).map((item) => item.id));
      const attachmentQuery = db.from("support_attachments_v2").select("id,ticket_id,message_id,storage_path,file_name,mime_type,size_bytes").in("ticket_id", rows.map((ticket) => ticket.id));
      const attached = visibleMessageIds.length ? await attachmentQuery.or(`message_id.is.null,message_id.in.(${visibleMessageIds.join(",")})`) : await attachmentQuery.is("message_id", null);
      if (attached.error) throw new Error("تعذر تحميل مرفقات التذاكر. أعد المحاولة.");
      attachments = (attached.data ?? []) as Attachment[];
    }
    return rows.map((ticket) => ({ ...ticket, support_messages: ticket.support_messages.filter((item) => !item.is_internal), attachments: attachments.filter((item) => item.ticket_id === ticket.id) }));
  }, [userId]);

  const applyTickets = useCallback((rows: Ticket[]) => {
    setTickets(rows);
    setSelectedId((current) => rows.some((ticket) => ticket.id === current) ? current : rows[0]?.id ?? null);
    setLoadFailed(false);
  }, []);
  const refresh = useCallback(async () => applyTickets(await load()), [load, applyTickets]);

  useEffect(() => {
    void load().then(applyTickets).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "تعذر تحميل التذاكر."); setLoadFailed(true); }).finally(() => setLoading(false));
  }, [load, applyTickets]);

  const uploadFiles = async ({ ticketId, messageId, files }: PendingUploads) => {
    const failed: File[] = [];
    for (const selectedFile of files) {
      try {
        validateFiles([selectedFile]);
        const file = await optimizeUploadFile(selectedFile);
        const path = `${userId}/${ticketId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const uploaded = await db.storage.from("support-private").upload(path, file, { contentType: file.type });
        if (uploaded.error) throw uploaded.error;
        const saved = await db.from("support_attachments_v2").insert({ ticket_id: ticketId, message_id: messageId, uploaded_by: userId, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (saved.error) { await db.storage.from("support-private").remove([path]); throw saved.error; }
      } catch { failed.push(selectedFile); }
    }
    setPendingUploads(failed.length ? { ticketId, messageId, files: failed } : null);
    return failed.length;
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || pendingUploads) return;
    setBusy(true); setError(""); setMessage("");
    try {
      validateFiles(newFiles);
      const body = JSON.stringify({ ...form, subject: form.subject.trim(), description: form.description.trim() });
      if (createKey.current?.body !== body) createKey.current = { body, key: crypto.randomUUID() };
      const response = await fetch("/api/support/tickets", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": createKey.current.key }, body });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "تعذر إرسال التذكرة. أعد المحاولة.");
      createKey.current = null;
      const failed = await uploadFiles({ ticketId: payload.id, messageId: null, files: newFiles });
      setForm(emptyForm); setNewFiles([]); setShowForm(false); setSelectedId(payload.id); setReply(""); setReplyFiles([]);
      setMessage(failed ? "أُرسلت التذكرة، لكن بعض المرفقات لم تُرفع. يمكنك إعادة رفعها أدناه." : "أُرسلت تذكرتك. تابع رد فريق الدعم من المحادثة.");
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إرسال التذكرة."); }
    finally { setBusy(false); }
  };

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || busy || pendingUploads || reply.trim().length < 2 || selected.status === "closed") return;
    setBusy(true); setError(""); setMessage("");
    try {
      validateFiles(replyFiles);
      const body = `${selected.id}:${reply.trim()}`;
      if (replyKey.current?.body !== body) replyKey.current = { body, key: crypto.randomUUID() };
      const result = await db.rpc("reply_support_ticket", { p_ticket: selected.id, p_body: reply.trim(), p_internal: false, p_idempotency_key: replyKey.current.key });
      if (result.error || !result.data) throw new Error("تعذر إرسال الرد. تحقق من حالة التذكرة وأعد المحاولة.");
      replyKey.current = null;
      const failed = await uploadFiles({ ticketId: selected.id, messageId: String(result.data), files: replyFiles });
      setReply(""); setReplyFiles([]);
      setMessage(failed ? "أُرسل ردك، لكن بعض المرفقات لم تُرفع. أعد رفعها أدناه." : "أُرسل ردك إلى فريق الدعم.");
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إرسال الرد."); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await db.rpc("transition_support_ticket", { p_ticket: selected.id, p_action: "reopen", p_reason: reply.trim() || null, p_assignee: null });
      if (result.error) throw new Error("تعذر إعادة فتح التذكرة. أعد المحاولة.");
      setMessage("أُعيد فتح التذكرة لمتابعتها مع فريق الدعم."); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث التذكرة."); }
    finally { setBusy(false); }
  };

  const retryUploads = async () => {
    if (!pendingUploads || busy) return;
    setBusy(true); setError("");
    try { const failed = await uploadFiles(pendingUploads); setMessage(failed ? "بعض الملفات لم تُرفع بعد. تحقق من الاتصال ثم أعد المحاولة." : "اكتمل رفع المرفقات."); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث المرفقات."); }
    finally { setBusy(false); }
  };

  const filtered = tickets.filter((ticket) => (!status || ticket.status === status) && `${ticket.ticket_code} ${ticket.subject}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const messages = selected ? [...selected.support_messages].filter((item) => !item.is_internal).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const initialMessage = messages[0]?.author_profile_id === userId && messages[0]?.body.trim() === selected?.description.trim() ? messages[0] : null;
  const remainingMessages = messages.filter((item) => item.id !== initialMessage?.id);
  const initialAttachments = selected?.attachments.filter((item) => !item.message_id || item.message_id === initialMessage?.id) ?? [];
  const attachmentsFor = (items: Attachment[]) => items.length ? <div className={styles.attachments}>{items.map((item) => <PrivateAttachment key={item.id} attachment={item} onError={setError} />)}</div> : null;

  return <main className={styles.page}>
    <header className={styles.header}><div><p>بُنية / المساعدة والمتابعة</p><h1>كيف نقدر نساعدك؟</h1><span>أرسل استفسارك وتابع كل التفاصيل والردود في محادثة واحدة مع فريق بُنية.</span></div><button className={styles.primary} type="button" aria-expanded={showForm} aria-controls="customer-support-create" disabled={busy} onClick={() => { setShowForm((value) => !value); if (!showForm) setTimeout(() => formHeading.current?.focus(), 0); }}>{showForm ? "إخفاء النموذج" : "تذكرة دعم جديدة"}</button></header>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{loadFailed ? <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(""); void refresh().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "تعذر تحميل التذاكر.")).finally(() => setLoading(false)); }}>إعادة المحاولة</button> : null}</div> : null}
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {pendingUploads ? <section className={styles.pending} role="status"><div><h2>مرفقات بانتظار الرفع</h2><p>{pendingUploads.files.map((file) => file.name).join("، ")}</p><small>التذكرة أو الرسالة محفوظة؛ تعيد هذه الخطوة رفع الملفات فقط.</small></div><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => void retryUploads()}>{busy ? "جارٍ الرفع…" : "إعادة رفع المرفقات"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setPendingUploads(null)}>متابعة دون هذه المرفقات</button></div></section> : null}
    {showForm ? <section className={styles.panel} id="customer-support-create"><header className={styles.panelHeader}><div><p>طلب مساعدة جديد</p><h2 tabIndex={-1} ref={formHeading}>احكِ لنا التفاصيل</h2><span>اختر التصنيف المناسب، وأضف رقم طلبك داخل الوصف إن كان الاستفسار مرتبطًا بطلب.</span></div></header><form className={styles.form} onSubmit={create}><label><span>التصنيف</span><select value={form.category} disabled={busy} onChange={(event) => setForm({ ...form, category: event.target.value })}>{Object.entries(categories).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label><span>الأولوية</span><select value={form.priority} disabled={busy} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{Object.entries(priorityLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className={styles.wide}><span>موضوع التذكرة</span><input required minLength={3} maxLength={180} value={form.subject} disabled={busy} placeholder="وصف مختصر لما تحتاج مساعدة بشأنه" onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label><label className={styles.wide}><span>التفاصيل</span><textarea required minLength={10} maxLength={5000} rows={5} value={form.description} disabled={busy} placeholder="وضّح ما حدث وما تحتاجه من الفريق…" onChange={(event) => setForm({ ...form, description: event.target.value })} /><small>{form.description.length.toLocaleString("ar-SA")} / ٥٬٠٠٠ حرف</small></label><div className={styles.wide}><FilePicker key={showForm ? "new-open" : "new-closed"} files={newFiles} onChange={setNewFiles} disabled={busy} /></div><footer className={`${styles.actions} ${styles.wide}`}><button className={styles.primary} disabled={busy || Boolean(pendingUploads)}>{busy ? "جارٍ الإرسال…" : "إرسال التذكرة"}</button><button className={styles.secondary} type="button" disabled={busy} onClick={() => setShowForm(false)}>العودة إلى تذاكري</button></footer></form></section> : null}
    {loading ? <div className={styles.empty} role="status"><span className="database-spinner" aria-hidden="true" /><h2>جارٍ تحميل تذاكرك…</h2><p>نجهّز آخر المحادثات والتحديثات.</p></div> : !loadFailed ? <>
      <section className={styles.metrics} aria-label="ملخص الدعم"><article><span>جميع التذاكر</span><strong>{tickets.length.toLocaleString("ar-SA")}</strong></article><article><span>قيد المتابعة</span><strong>{tickets.filter((ticket) => ["open", "in_progress"].includes(ticket.status)).length.toLocaleString("ar-SA")}</strong></article><article><span>تم الحل أو الإغلاق</span><strong>{tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length.toLocaleString("ar-SA")}</strong></article></section>
      {!tickets.length ? <section className={styles.empty}><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 8h32v24H23L12 40v-8H8V8Zm9 9h14M17 24h9" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg><h2>نحن هنا لمساعدتك</h2><p>لا توجد تذاكر في حسابك بعد. أرسل استفسارًا عن طلبك، التوصيل أو حسابك، وتابع الرد هنا.</p><button type="button" className={styles.primary} onClick={() => { setShowForm(true); setTimeout(() => formHeading.current?.focus(), 0); }}>إنشاء أول تذكرة</button></section> : <div className={styles.workspace}>
        <aside className={`${styles.panel} ${styles.inbox}`} aria-label="تذاكري"><header className={styles.panelHeader}><h2>تذاكري</h2><span>{filtered.length.toLocaleString("ar-SA")} تذكرة</span></header><div className={styles.filters}><label><span>البحث في التذاكر</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم التذكرة أو الموضوع" /></label><label><span>الحالة</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option>{Object.entries(statusLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div><div className={styles.ticketList}>{filtered.map((ticket) => <button type="button" key={ticket.id} disabled={busy} aria-pressed={selectedId === ticket.id} onClick={() => { setSelectedId(ticket.id); setReply(""); setReplyFiles([]); setTimeout(() => threadHeading.current?.focus(), 0); }}><div><small>{ticket.ticket_code}</small><span className={styles.status} data-status={ticket.status}>{statusLabels[ticket.status] ?? "قيد المتابعة"}</span></div><b>{ticket.subject}</b><p>{categories[ticket.category] ?? ticket.category}</p><time dateTime={ticket.updated_at}>{formatDate(ticket.updated_at)}</time></button>)}{!filtered.length ? <div className={styles.noResults}><p>لا توجد تذاكر تطابق البحث.</p><button type="button" className={styles.secondary} onClick={() => { setSearch(""); setStatus(""); }}>مسح الفلاتر</button></div> : null}</div></aside>
        <section className={`${styles.panel} ${styles.conversation}`} aria-label="محادثة الدعم">{selected ? <><header className={styles.panelHeader}><div><p>{selected.ticket_code} · {categories[selected.category] ?? selected.category}</p><h2 tabIndex={-1} ref={threadHeading}>{selected.subject}</h2><span>أُنشئت {formatDate(selected.created_at)} · أولوية {priorityLabels[selected.priority] ?? "عادية"}</span></div><span className={styles.status} data-status={selected.status}>{statusLabels[selected.status] ?? "قيد المتابعة"}</span></header><div className={styles.thread}><article className={styles.original}><header><b>وصف طلبك</b><time dateTime={selected.created_at}>{formatDate(selected.created_at)}</time></header><p>{selected.description}</p>{attachmentsFor(initialAttachments)}</article>{remainingMessages.map((item) => <article key={item.id} className={item.author_profile_id === userId ? styles.ownMessage : styles.teamMessage}><header><b>{item.author_profile_id === userId ? "أنت" : "فريق بُنية"}</b><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></header><p>{item.body}</p>{attachmentsFor(selected.attachments.filter((file) => file.message_id === item.id))}</article>)}{!remainingMessages.length ? <p className={styles.waiting}>ستظهر ردود فريق الدعم هنا عند إضافتها.</p> : null}</div>{["resolved", "closed"].includes(selected.status) ? <div className={styles.closed}><div><b>{selected.status === "resolved" ? "تم تسجيل حل لهذه التذكرة" : "هذه التذكرة مغلقة"}</b><p>إذا احتجت متابعة إضافية، يمكنك إعادة فتح المحادثة.</p></div><button className={styles.secondary} type="button" disabled={busy} onClick={() => void reopen()}>{busy ? "جارٍ التنفيذ…" : "إعادة فتح التذكرة"}</button></div> : null}{selected.status !== "closed" ? <form className={styles.reply} onSubmit={sendReply}><label><span>أضف ردًا للفريق</span><textarea required minLength={2} rows={4} disabled={busy} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="أضف توضيحًا أو تابع استفسارك…" /></label><FilePicker key={`${selected.id}:${replyFiles.length === 0 ? "empty" : "files"}`} files={replyFiles} onChange={setReplyFiles} disabled={busy} /><div className={styles.actions}><button className={styles.primary} disabled={busy || Boolean(pendingUploads) || reply.trim().length < 2}>{busy ? "جارٍ الإرسال…" : "إرسال الرد"}</button><small>تظهر رسالتك ومرفقاتك ضمن هذه التذكرة.</small></div></form> : null}</> : <div className={styles.empty}><p>اختر تذكرة لعرض المحادثة.</p></div>}</section>
      </div>}
    </> : null}
  </main>;
}
