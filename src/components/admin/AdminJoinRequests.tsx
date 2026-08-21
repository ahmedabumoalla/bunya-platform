/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AdminDecisionDialog,
  AdminEmpty,
  AdminHeader,
  AdminStatus,
  AdminToast,
} from "./AdminUI";

type Row = Record<string, unknown>;

type Application = Row & {
  id: string;
  status: string;
  created_at: string;
  email: string;
  mobile: string;
  documents: Array<{ id: string; name: string; url: string | null }>;
  reviews?: Row[];
  onboarding?: Row | null;
};

type DocumentPreviewState = {
  name: string;
  loading: boolean;
  url?: string;
  mimeType?: string;
  error?: string;
};

const statusLabels: Record<string, string> = {
  pending: "قيد المراجعة",
  needs_changes: "بحاجة إلى تعديلات",
  approved: "معتمد",
  rejected: "مرفوض",
  sent: "تم الإرسال",
  failed: "فشل الإرسال",
  not_sent: "لم يُرسل",
  provisioned: "تم إنشاء الحساب",
};

function displayStatus(value: unknown) {
  const key = String(value ?? "");
  return statusLabels[key] ?? key.replaceAll("_", " ") ?? "—";
}

function displayValue(value: unknown) {
  if (value === true) return "نعم";
  if (value === false) return "لا";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-SA");
}

function Detail({ label, children, dir }: { label: string; children: ReactNode; dir?: "ltr" | "rtl" }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd dir={dir}>{children}</dd>
    </div>
  );
}

function RequestActions({ item, onAction }: { item: Application; onAction: (action: string) => void }) {
  return (
    <div className="admin-request-modal-actions">
      {["pending", "needs_changes"].includes(item.status) ? (
        <>
          <button type="button" className="admin-action-button admin-action-approve" onClick={() => onAction("approve")}>✓ موافقة</button>
          <button type="button" className="admin-action-button admin-action-reject" onClick={() => onAction("reject")}>✕ رفض</button>
          <button type="button" className="admin-action-button admin-action-revision" onClick={() => onAction("needs-changes")}>✎ طلب تعديل</button>
        </>
      ) : null}
      {item.status === "approved" ? (
        <button type="button" className="admin-action-button admin-action-revision" onClick={() => onAction("resend-credentials")}>↻ إعادة إرسال بيانات الدخول</button>
      ) : null}
    </div>
  );
}

function DocumentPreview({ preview, onClose }: { preview: DocumentPreviewState; onClose: () => void }) {
  const isImage = preview.mimeType?.startsWith("image/");
  const isPdf = preview.mimeType === "application/pdf" || preview.name.toLowerCase().endsWith(".pdf");

  return createPortal(
    <div className="admin-modal-backdrop admin-document-preview-backdrop" onMouseDown={onClose}>
      <section
        className="admin-document-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-document-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>معاينة المستند</small>
            <h3 id="admin-document-preview-title">{preview.name}</h3>
          </div>
          <button onClick={onClose} aria-label="إغلاق معاينة المستند">×</button>
        </header>
        <div className="admin-document-preview-content">
          {preview.loading ? <p>جاري تحميل المستند...</p> : null}
          {preview.error ? <p className="admin-document-preview-error">{preview.error}</p> : null}
          {preview.url && isImage ? (
            <object data={preview.url} type={preview.mimeType} aria-label={preview.name}>
              <a href={preview.url} download={preview.name}>تنزيل الصورة</a>
            </object>
          ) : null}
          {preview.url && isPdf ? <iframe src={preview.url} title={preview.name} /> : null}
          {preview.url && !isImage && !isPdf ? (
            <div className="admin-document-preview-unsupported">
              <p>لا يدعم المتصفح معاينة هذا النوع من الملفات.</p>
              <a href={preview.url} download={preview.name}>تنزيل المستند</a>
            </div>
          ) : null}
        </div>
        {preview.url ? (
          <footer>
            <a href={preview.url} download={preview.name}>تنزيل المستند</a>
            <button onClick={onClose}>إغلاق</button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function RequestDetails({
  item,
  kind,
  onClose,
  onAction,
}: {
  item: Application;
  kind: "provider" | "contractor";
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const categories = (item.provider_application_categories as Row[] | undefined) ?? [];
  const deliveryRegions = (item.provider_delivery_regions as Row[] | undefined) ?? [];
  const workRegions = (item.contractor_work_regions as Row[] | undefined) ?? [];
  const specialties = (item.contractor_specialties as Row[] | undefined) ?? [];
  const reviews = item.reviews ?? [];
  const name = displayValue(kind === "provider" ? item.company_name : item.contractor_name);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewState | null>(null);

  useEffect(() => {
    return () => {
      if (documentPreview?.url) URL.revokeObjectURL(documentPreview.url);
    };
  }, [documentPreview]);

  const openDocument = async (document: Application["documents"][number]) => {
    if (!document.url) return;
    setDocumentPreview({ name: document.name, loading: true });

    try {
      const response = await fetch(document.url, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || "تعذر تحميل المستند.");
      }

      const file = await response.blob();
      setDocumentPreview({
        name: document.name,
        loading: false,
        url: URL.createObjectURL(file),
        mimeType: file.type,
      });
    } catch (error) {
      setDocumentPreview({
        name: document.name,
        loading: false,
        error: error instanceof Error ? error.message : "تعذر تحميل المستند.",
      });
    }
  };

  return createPortal(
    <div className="admin-modal-backdrop admin-request-modal-backdrop" onMouseDown={onClose}>
      <section
        className="admin-modal admin-request-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`request-title-${item.id}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-request-modal-header">
          <div>
            <p>{kind === "provider" ? "طلب انضمام مزود" : "طلب انضمام مقاول"}</p>
            <h3 id={`request-title-${item.id}`}>{name}</h3>
            <small dir="ltr">رقم الطلب: {item.id}</small>
          </div>
          <div>
            <AdminStatus value={displayStatus(item.status)} />
            <button className="admin-request-close" onClick={onClose} aria-label="إغلاق نافذة التفاصيل">
              ×
            </button>
          </div>
        </header>

        <section className="admin-request-section">
          <h4>بيانات مقدم الطلب</h4>
          <dl className="admin-request-detail-grid">
            {kind === "provider" ? (
              <>
                <Detail label="اسم الشركة">{displayValue(item.company_name)}</Detail>
                <Detail label="اسم المسؤول">{displayValue(item.contact_name)}</Detail>
              </>
            ) : (
              <Detail label="اسم المقاول">{displayValue(item.contractor_name)}</Detail>
            )}
            <Detail label="البريد الإلكتروني" dir="ltr">{displayValue(item.email)}</Detail>
            <Detail label="رقم الجوال" dir="ltr">{displayValue(item.mobile)}</Detail>
            <Detail label="اسم المستخدم المطلوب">{displayValue(item.requested_username)}</Detail>
            {kind === "provider" ? (
              <Detail label="كود الخصم">{displayValue(item.discount_code)}</Detail>
            ) : null}
            <Detail label="وقت تقديم الطلب">{dateTime(item.created_at)}</Detail>
            <Detail label="آخر تحديث">{dateTime(item.updated_at)}</Detail>
          </dl>
        </section>

        {kind === "provider" ? (
          <section className="admin-request-section">
            <h4>الموقع والتوصيل</h4>
            <dl className="admin-request-detail-grid">
              <Detail label="خدمة التوصيل">{displayValue(item.delivery_available)}</Detail>
              <Detail label="الإحداثيات" dir="ltr">
                {item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : "—"}
              </Detail>
              <Detail label="رابط Google Maps">
                {item.google_maps_url ? (
                  <a href={String(item.google_maps_url)} target="_blank" rel="noreferrer" className="admin-request-map-link">
                    فتح الموقع في الخريطة ↗
                  </a>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="مناطق التوصيل">
                {deliveryRegions.length
                  ? deliveryRegions.map((region) => displayValue(region.region_name)).join("، ")
                  : "—"}
              </Detail>
            </dl>
          </section>
        ) : null}

        <section className="admin-request-section">
          <h4>{kind === "provider" ? "التصنيفات المتوفرة" : "مناطق العمل والتخصصات"}</h4>
          <div className="admin-request-chips">
            {kind === "provider"
              ? categories.map((category, index) => {
                  const relation = category.product_categories as Row | null;
                  return (
                    <span key={`${displayValue(category.custom_category)}-${index}`}>
                      {displayValue(relation?.name ?? category.custom_category)}
                    </span>
                  );
                })
              : [...workRegions, ...specialties].map((entry, index) => (
                  <span key={`${displayValue(entry.region_name ?? entry.specialty_name)}-${index}`}>
                    {displayValue(entry.region_name ?? entry.specialty_name)}
                  </span>
                ))}
            {kind === "provider" && !categories.length ? <span>لا توجد تصنيفات مسجلة</span> : null}
            {kind === "contractor" && !workRegions.length && !specialties.length ? <span>لا توجد بيانات مسجلة</span> : null}
          </div>
        </section>

        <section className="admin-request-section">
          <h4>المستندات المرفوعة ({item.documents.length})</h4>
          <div className="admin-request-documents">
            {item.documents.length ? (
              item.documents.map((document) =>
                document.url ? (
                  <button type="button" onClick={() => void openDocument(document)} key={document.id}>
                    <span>{document.name}</span>
                    <b>عرض المستند</b>
                  </button>
                ) : (
                  <div key={document.id}>
                    <span>{document.name}</span>
                    <b>تعذر إنشاء رابط العرض</b>
                  </div>
                ),
              )
            ) : (
              <p>لا توجد مستندات مرفوعة.</p>
            )}
          </div>
        </section>

        <section className="admin-request-section">
          <h4>المراجعة وحالة إنشاء الحساب</h4>
          <dl className="admin-request-detail-grid">
            <Detail label="وقت آخر مراجعة">{dateTime(item.reviewed_at)}</Detail>
            <Detail label="ملاحظات المراجع">{displayValue(item.review_notes)}</Detail>
            {item.onboarding ? (
              <>
                <Detail label="إنشاء الحساب">{displayStatus(item.onboarding.provisioning_status)}</Detail>
                <Detail label="إرسال البريد">{displayStatus(item.onboarding.email_delivery_status)}</Detail>
                <Detail label="إرسال واتساب">{displayStatus(item.onboarding.whatsapp_delivery_status)}</Detail>
                <Detail label="آخر خطأ في الإرسال">{displayValue(item.onboarding.last_delivery_error)}</Detail>
              </>
            ) : null}
          </dl>
          {reviews.length ? (
            <div className="admin-request-review-list">
              <h5>سجل القرارات</h5>
              {reviews.map((review, index) => (
                <div key={`${displayValue(review.created_at)}-${index}`}>
                  <b>{displayStatus(review.outcome)}</b>
                  <span>{displayValue(review.reason)}</span>
                  <time>{dateTime(review.created_at)}</time>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <footer className="admin-request-modal-footer">
          <button onClick={onClose}>إغلاق</button>
          <RequestActions item={item} onAction={onAction} />
        </footer>
        {documentPreview ? (
          <DocumentPreview preview={documentPreview} onClose={() => setDocumentPreview(null)} />
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

export function AdminJoinRequests({ kind }: { kind: "provider" | "contractor" }) {
  const [items, setItems] = useState<Application[]>([]);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);
  const [pending, setPending] = useState<{ item: Application; action: string } | null>(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [decisionSuccess, setDecisionSuccess] = useState("");

  const load = async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/join-requests/${kind}`, { cache: "no-store" });
    const body = await response.json();
    setItems(response.ok ? body.applications : []);
    if (!response.ok) setToast(body.message || "تعذر تحميل الطلبات.");
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [kind]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected, pending]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (status === "all" || item.status === status) &&
          (!query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())),
      ),
    [items, status, query],
  );

  const openDecision = (item: Application, action: string) => {
    setReason("");
    setDecisionError("");
    setDecisionSuccess("");
    setPending({ item, action });
  };

  const act = async () => {
    if (!pending || submitting || decisionSuccess) return;
    const requiresReason = pending.action === "reject" || pending.action === "needs-changes";
    if (requiresReason && reason.trim().length < 5) return;
    setSubmitting(true);
    setDecisionError("");

    try {
      const response = await fetch(`/api/admin/join-requests/${kind}/${pending.item.id}/${pending.action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; delivery?: string };
      if (!response.ok) {
        const message = body.message || "تعذر تنفيذ القرار.";
        setDecisionError(message);
        setToast(message);
        return;
      }

      const message = actionSuccessMessage(pending.action, body.delivery);
      setDecisionSuccess(message);
      setToast(message);
      await Promise.all([
        load(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 900)),
      ]);
      setSelected(null);
      setPending(null);
      setReason("");
    } catch {
      const message = "تعذر الاتصال بالخادم. حاول مرة أخرى.";
      setDecisionError(message);
      setToast(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-page-stack">
      <AdminToast message={toast} />
      <AdminHeader
        eyebrow="الانضمام"
        title={kind === "provider" ? "طلبات انضمام المزودين" : "طلبات انضمام المقاولين"}
        description="بيانات Supabase الفعلية ومراجعة المستندات وإنشاء الحساب الآمن."
      />
      <section className="admin-filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="بحث بالاسم أو البريد أو الجوال"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="pending">قيد المراجعة</option>
          <option value="needs_changes">بحاجة إلى تعديلات</option>
          <option value="approved">معتمد</option>
          <option value="rejected">مرفوض</option>
        </select>
      </section>

      {loading ? (
        <p>جاري التحميل...</p>
      ) : filtered.length ? (
        <section className="admin-record-grid">
          {filtered.map((item) => (
            <article
              className="admin-panel admin-record-card admin-request-card"
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`عرض تفاصيل الطلب ${item.id}`}
              onClick={() => setSelected(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(item);
                }
              }}
            >
              <header>
                <div>
                  <small dir="ltr">{item.id}</small>
                  <h3>{displayValue(kind === "provider" ? item.company_name : item.contractor_name)}</h3>
                  <span dir="ltr">{item.email} · {item.mobile}</span>
                </div>
                <AdminStatus value={displayStatus(item.status)} />
              </header>
              <dl className="admin-record-meta">
                <Detail label="وقت التقديم">{dateTime(item.created_at)}</Detail>
                <Detail label="المرفقات">{item.documents.length}</Detail>
              </dl>
              <span className="admin-request-open">عرض التفاصيل والإجراءات ←</span>
            </article>
          ))}
        </section>
      ) : (
        <AdminEmpty text="لا توجد طلبات مطابقة." />
      )}

      {selected ? (
        <RequestDetails
          item={selected}
          kind={kind}
          onClose={() => setSelected(null)}
          onAction={(action) => openDecision(selected, action)}
        />
      ) : null}

      {pending ? (
        <AdminDecisionDialog
          title={pending.action === "approve" ? "تأكيد الموافقة" : pending.action === "reject" ? "رفض الطلب" : pending.action === "needs-changes" ? "طلب تعديل" : "إعادة إرسال بيانات الدخول"}
          description={pending.action === "approve" ? "سيتم إنشاء حساب مقدم الطلب وإرسال كلمة المرور المؤقتة عبر البريد وواتساب." : pending.action === "reject" ? "وضّح سبب الرفض؛ سيصل إلى مقدم الطلب عبر البريد وواتساب." : pending.action === "needs-changes" ? "اكتب التعديل المطلوب بوضوح؛ سيصل رابط تعديل آمن عبر البريد وواتساب." : "سيتم تغيير كلمة المرور المؤقتة وإرسال بيانات الدخول الجديدة."}
          reason={reason}
          onReason={setReason}
          onCancel={() => {
            if (!submitting && !decisionSuccess) setPending(null);
          }}
          onConfirm={act}
          requiresReason={pending.action === "reject" || pending.action === "needs-changes"}
          confirmLabel={pending.action === "approve" ? "اعتماد وإنشاء الحساب" : pending.action === "reject" ? "تأكيد الرفض" : pending.action === "needs-changes" ? "إرسال طلب التعديل" : "إعادة الإرسال"}
          busy={submitting}
          successMessage={decisionSuccess}
          errorMessage={decisionError}
        />
      ) : null}
    </div>
  );
}

function actionSuccessMessage(action: string, delivery?: string) {
  if (action !== "approve" && action !== "resend-credentials") return "تم تنفيذ القرار بنجاح.";
  if (delivery === "credentials_submitted") return "تم إنشاء الحساب وإرسال بيانات الدخول عبر البريد وواتساب.";
  if (delivery === "credentials_partially_submitted") return "تم إنشاء الحساب، ووصلت بيانات الدخول عبر قناة واحدة فقط. راجع حالة الإرسال.";
  if (delivery === "credentials_failed") return "تم إنشاء الحساب، لكن تعذر إرسال بيانات الدخول. استخدم إعادة إرسال بيانات الدخول.";
  return action === "approve" ? "تمت الموافقة وإنشاء الحساب بنجاح." : "تمت إعادة إرسال بيانات الدخول.";
}
