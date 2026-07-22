/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import type { ContractorProposal } from "@/lib/contractor-types";
import { readContractor } from "@/lib/contractor-storage";
import { projectPolicy } from "@/lib/project-policies";
import type {
  CustomerProjectChangeRequest,
  CustomerProjectRequest,
  ProjectAttachment,
  ProjectAttachmentCategory,
  ProjectRequestStatus,
} from "@/lib/project-request-types";
import {
  acceptPolicy,
  addProjectAudit,
  addProjectNotification,
  createProjectCycleId,
  projectDuration,
  readProjectStore,
  syncPublishedOpportunity,
  writeProjectStore,
} from "@/lib/project-request-storage";
import { ProjectPolicyModal } from "@/components/ProjectPolicyModal";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import {
  CustomerConfirm,
  CustomerEmpty,
  CustomerHeader,
  CustomerStatus,
  CustomerToast,
  customerDate,
  money,
} from "./CustomerUI";

const projectTypes = [
  "بناء جديد",
  "ترميم",
  "تشطيب",
  "توسعة",
  "صيانة",
  "كهرباء",
  "سباكة",
  "عزل",
  "أعمال موقع أو طرق",
  "أخرى",
];
const specialtyOptions = ["بناء عظم", "تشطيبات", "إشراف هندسي", "ترميم", "كهرباء", "سباكة", "عزل", "طرق وأعمال موقع"];
const attachmentLabels: Record<ProjectAttachmentCategory, string> = {
  architectural: "معماري",
  structural: "إنشائي",
  electrical: "كهرباء",
  plumbing: "سباكة",
  site_photos: "صور الموقع",
  bill_of_quantities: "جدول كميات",
  license: "رخصة",
  other: "آخر",
};
const statusLabels: Record<ProjectRequestStatus, string> = {
  draft: "مسودة",
  pending_admin_review: "بانتظار مراجعة الإدارة",
  needs_customer_changes: "يحتاج تعديلًا",
  published: "منشور",
  receiving_proposals: "يستقبل عروضًا",
  under_customer_review: "قيد مراجعة العميل",
  awarded: "تم الإسناد",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  cancelled: "ملغي",
  expired: "منتهي",
};
const blankTechnical: CustomerProjectRequest["technical"] = {
  requiresInspection: false,
  hasLicense: false,
  hasOfficialApprovals: false,
  materialsResponsibility: "by_proposal",
};
const newRequest = (): CustomerProjectRequest => {
  const now = new Date().toISOString();
  return {
    id: createProjectCycleId("project-request"),
    requestCode: `BPR-${Date.now().toString().slice(-6)}`,
    customerId: "",
    title: "",
    projectType: "بناء جديد",
    description: "",
    scope: "",
    requiredSpecialties: [],
    region: "",
    city: "",
    mapsUrl: "",
    locationName: "",
    budgetMax: 0,
    budgetNegotiable: false,
    durationValue: 1,
    durationUnit: "month",
    expectedStartAt: "",
    proposalDeadlineAt: "",
    technical: blankTechnical,
    attachments: [],
    status: "draft",
    proposalCount: 0,
    approvedCommentCount: 0,
    createdAt: now,
    updatedAt: now,
  };
};

export function CustomerProjectRequests() {
  const [items, setItems] = useState<CustomerProjectRequest[]>([]);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => setItems(readProjectStore("requests")), []);
  const filtered = items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (!query || `${item.requestCode} ${item.title} ${item.city}`.includes(query)),
  );
  return (
    <div className="customer-page-stack">
      <CustomerHeader
        eyebrow="مشاريع المقاولات"
        title="طلبات المشاريع"
        description="أنشئ الطلب وتابع مراجعته ونشره والعروض والتعديلات في مسار واحد."
        action={
          <Link className="customer-primary" href="/customer/project-requests/new">
            ＋ إنشاء طلب مشروع
          </Link>
        }
      />
      <section className="customer-filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالرقم أو العنوان أو المدينة"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">كل الحالات</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </section>
      {filtered.length ? (
        <section className="customer-project-request-grid">
          {filtered.map((item) => (
            <Link
              className="customer-project-request-card"
              href={`/customer/project-requests/${item.id}`}
              key={item.id}
            >
              <header>
                <div>
                  <small>
                    {item.requestCode} · {item.projectType}
                  </small>
                  <h3>{item.title}</h3>
                </div>
                <CustomerStatus value={item.status} />
              </header>
              <dl>
                <div>
                  <dt>المنطقة</dt>
                  <dd>
                    {item.city} · {item.region}
                  </dd>
                </div>
                <div>
                  <dt>الميزانية</dt>
                  <dd>{money(item.budgetMax)}</dd>
                </div>
                <div>
                  <dt>المدة</dt>
                  <dd>{projectDuration(item)}</dd>
                </div>
                <div>
                  <dt>تاريخ الإنشاء</dt>
                  <dd>{customerDate(item.createdAt)}</dd>
                </div>
                <div>
                  <dt>العروض</dt>
                  <dd>{item.proposalCount}</dd>
                </div>
                <div>
                  <dt>التعليقات المعتمدة</dt>
                  <dd>{item.approvedCommentCount}</dd>
                </div>
              </dl>
              <footer>فتح تفاصيل الطلب ←</footer>
            </Link>
          ))}
        </section>
      ) : (
        <CustomerEmpty
          title="لا توجد طلبات مطابقة"
          description="أنشئ طلب مشروع جديدًا أو غيّر الفلاتر."
          href="/customer/project-requests/new"
          action="إنشاء طلب"
        />
      )}
    </div>
  );
}

export function CustomerProjectRequestNew() {
  const identity = useAuthIdentity();
  const router = useRouter();
  const [form, setForm] = useState<CustomerProjectRequest>(newRequest);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mapNote, setMapNote] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [preview, setPreview] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    const editing = localStorage.getItem("bunya-edit-project-request");
    if (editing) {
      const request = readProjectStore("requests").find((item) => item.id === editing);
      if (request) setForm(request);
      localStorage.removeItem("bunya-edit-project-request");
    }
    setForm((current) => ({ ...current, customerId: identity.userId }));
  }, [identity.userId]);
  const policy = projectPolicy("project-publication");
  const update = <Key extends keyof CustomerProjectRequest>(key: Key, value: CustomerProjectRequest[Key]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = "أدخل عنوان المشروع.";
    if (form.projectType === "أخرى" && !form.otherProjectType?.trim()) next.otherType = "حدد نوع المشروع.";
    if (form.description.trim().length < 20) next.description = "أدخل وصفًا تفصيليًا لا يقل عن 20 حرفًا.";
    if (!form.scope.trim()) next.scope = "أدخل نطاق الأعمال.";
    if (!form.requiredSpecialties.length) next.specialties = "اختر تخصصًا واحدًا على الأقل.";
    if (!form.region.trim() || !form.city.trim()) next.location = "أدخل المنطقة والمدينة.";
    if (parseGoogleMapsLink(form.mapsUrl).kind === "invalid") next.maps = "أدخل رابط Google Maps صالحًا.";
    if (form.budgetMax <= 0) next.budget = "أدخل الحد الأعلى أو قيمة الميزانية.";
    if (form.durationValue <= 0) next.duration = "أدخل مدة صحيحة.";
    if (!form.expectedStartAt || !form.proposalDeadlineAt) next.dates = "حدد تاريخ البدء والموعد النهائي للعروض.";
    if (!policyAccepted) next.policy = "يجب الموافقة على سياسة نشر طلبات المشاريع.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const persist = (status: ProjectRequestStatus) => {
    const now = new Date().toISOString();
    const next = {
      ...form,
      status,
      updatedAt: now,
      submittedAt: status === "pending_admin_review" ? now : form.submittedAt,
    };
    const items = readProjectStore("requests");
    writeProjectStore(
      "requests",
      items.some((item) => item.id === next.id)
        ? items.map((item) => (item.id === next.id ? next : item))
        : [next, ...items],
    );
    setForm(next);
    return next;
  };
  const saveDraft = () => {
    persist("draft");
    setToast("تم حفظ المسودة محليًا.");
  };
  const submit = () => {
    if (!validate()) return setStep(0);
    const acceptance = acceptPolicy("project-publication", "customer", "project_request", form.id);
    const next = persist("pending_admin_review");
    writeProjectStore(
      "requests",
      readProjectStore("requests").map((item) =>
        item.id === next.id ? { ...item, policyAcceptanceId: acceptance.id } : item,
      ),
    );
    addProjectNotification({
      recipientRole: "admin",
      projectRequestId: next.id,
      type: "new_request",
      title: "طلب مشروع جديد",
      message: `الطلب ${next.requestCode} بانتظار مراجعة النشر.`,
      link: "/admin/project-comments",
    });
    addProjectNotification({
      recipientRole: "customer",
      recipientId: next.customerId,
      projectRequestId: next.id,
      type: "received",
      title: "تم استلام طلب المشروع",
      message: "أرسل الطلب إلى مراجعة بُنية ولن يظهر للمقاولين قبل الاعتماد.",
      link: `/customer/project-requests/${next.id}`,
    });
    addProjectAudit(next.id, "customer", "العميل", "إرسال الطلب لمراجعة الإدارة");
    router.push(`/customer/project-requests/${next.id}`);
  };
  const analyzeMap = () => {
    const parsed = parseGoogleMapsLink(form.mapsUrl);
    setMapNote(parsed.message);
    if (parsed.kind !== "invalid")
      setForm((current) => ({ ...current, latitude: parsed.latitude, longitude: parsed.longitude }));
  };
  const files = (event: ChangeEvent<HTMLInputElement>) => {
    const allowed = /\.(pdf|dwg|dxf|jpe?g|png|webp|zip)$/i;
    const selected = Array.from(event.target.files ?? [])
      .filter((file) => allowed.test(file.name))
      .map(
        (file): ProjectAttachment => ({
          id: createProjectCycleId("project-file"),
          name: file.name,
          type: file.type || file.name.split(".").pop() || "غير معروف",
          size: file.size,
          category: "other",
        }),
      );
    setForm((current) => ({ ...current, attachments: [...current.attachments, ...selected] }));
    event.target.value = "";
  };
  const steps = ["المعلومات الأساسية", "الموقع والميزانية", "التفاصيل الفنية", "المخططات", "المراجعة والسياسة"];
  return (
    <div className="customer-page-stack">
      <CustomerToast message={toast} />
      <CustomerHeader
        eyebrow={form.requestCode}
        title="إنشاء طلب مشروع"
        description="أكمل الخطوات، ثم راجع الطلب قبل إرساله إلى إدارة بُنية."
      />
      <ol className="project-stepper">
        {steps.map((label, index) => (
          <li className={index === step ? "active" : index < step ? "done" : ""} key={label}>
            <span>{index + 1}</span>
            <b>{label}</b>
          </li>
        ))}
      </ol>
      <form className="customer-panel project-wizard" onSubmit={(event: FormEvent) => event.preventDefault()}>
        {step === 0 ? (
          <>
            <h3>المعلومات الأساسية</h3>
            <div className="project-form-grid">
              <Field label="عنوان المشروع" error={errors.title}>
                <input value={form.title} onChange={(event) => update("title", event.target.value)} />
              </Field>
              <Field label="نوع المشروع">
                <select value={form.projectType} onChange={(event) => update("projectType", event.target.value)}>
                  {projectTypes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              {form.projectType === "أخرى" ? (
                <Field label="النوع المخصص" error={errors.otherType}>
                  <input
                    value={form.otherProjectType ?? ""}
                    onChange={(event) => update("otherProjectType", event.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="وصف تفصيلي" wide error={errors.description}>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                />
              </Field>
              <Field label="نطاق الأعمال" wide error={errors.scope}>
                <textarea rows={4} value={form.scope} onChange={(event) => update("scope", event.target.value)} />
              </Field>
            </div>
            <h4>التخصصات المطلوبة</h4>
            <div className="project-choice-grid">
              {specialtyOptions.map((value) => (
                <label className={form.requiredSpecialties.includes(value) ? "selected" : ""} key={value}>
                  <input
                    type="checkbox"
                    checked={form.requiredSpecialties.includes(value)}
                    onChange={() =>
                      update(
                        "requiredSpecialties",
                        form.requiredSpecialties.includes(value)
                          ? form.requiredSpecialties.filter((item) => item !== value)
                          : [...form.requiredSpecialties, value],
                      )
                    }
                  />
                  {value}
                </label>
              ))}
            </div>
            {errors.specialties ? <p className="customer-error">{errors.specialties}</p> : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h3>الموقع والميزانية والموعد</h3>
            <div className="project-form-grid">
              <Field label="المنطقة">
                <input value={form.region} onChange={(event) => update("region", event.target.value)} />
              </Field>
              <Field label="المدينة" error={errors.location}>
                <input value={form.city} onChange={(event) => update("city", event.target.value)} />
              </Field>
              <Field label="اسم الموقع أو المشروع">
                <input value={form.locationName} onChange={(event) => update("locationName", event.target.value)} />
              </Field>
              <Field label="رابط Google Maps" wide error={errors.maps}>
                <div className="project-map-row">
                  <input
                    dir="ltr"
                    value={form.mapsUrl}
                    onChange={(event) => {
                      update("mapsUrl", event.target.value);
                      setMapNote("");
                    }}
                  />
                  <button type="button" onClick={analyzeMap}>
                    تحليل الرابط
                  </button>
                </div>
              </Field>
              {mapNote ? (
                <p className="customer-policy-note wide">
                  {mapNote}
                  {form.latitude !== undefined ? ` — ${form.latitude}, ${form.longitude}` : ""}
                </p>
              ) : null}
              <Field label="وصف الوصول" wide>
                <textarea
                  rows={2}
                  value={form.accessDescription ?? ""}
                  onChange={(event) => update("accessDescription", event.target.value)}
                />
              </Field>
              <Field label="الحد الأدنى للميزانية">
                <input
                  type="number"
                  min="0"
                  value={form.budgetMin ?? ""}
                  onChange={(event) => update("budgetMin", Number(event.target.value) || undefined)}
                />
              </Field>
              <Field label="الحد الأعلى أو القيمة" error={errors.budget}>
                <input
                  type="number"
                  min="1"
                  value={form.budgetMax || ""}
                  onChange={(event) => update("budgetMax", Number(event.target.value))}
                />
              </Field>
              <label className="project-check">
                <input
                  type="checkbox"
                  checked={form.budgetNegotiable}
                  onChange={(event) => update("budgetNegotiable", event.target.checked)}
                />{" "}
                الميزانية قابلة للنقاش
              </label>
              <Field label="مدة التنفيذ">
                <input
                  type="number"
                  min="1"
                  value={form.durationValue}
                  onChange={(event) => update("durationValue", Number(event.target.value))}
                />
              </Field>
              <Field label="وحدة المدة">
                <select
                  value={form.durationUnit}
                  onChange={(event) =>
                    update("durationUnit", event.target.value as CustomerProjectRequest["durationUnit"])
                  }
                >
                  <option value="day">يوم</option>
                  <option value="week">أسبوع</option>
                  <option value="month">شهر</option>
                  <option value="year">سنة</option>
                  <option value="other">أخرى</option>
                </select>
              </Field>
              {form.durationUnit === "other" ? (
                <Field label="الوحدة المخصصة">
                  <input
                    value={form.customDurationUnit ?? ""}
                    onChange={(event) => update("customDurationUnit", event.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="تاريخ البدء المتوقع">
                <input
                  type="date"
                  value={form.expectedStartAt}
                  onChange={(event) => update("expectedStartAt", event.target.value)}
                />
              </Field>
              <Field label="الموعد النهائي للعروض" error={errors.dates}>
                <input
                  type="datetime-local"
                  value={form.proposalDeadlineAt.slice(0, 16)}
                  onChange={(event) => update("proposalDeadlineAt", event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <TechnicalForm value={form.technical} onChange={(technical) => update("technical", technical)} />
        ) : null}
        {step === 3 ? (
          <>
            <h3>المخططات والمرفقات</h3>
            <p className="customer-policy-note">
              المخططات اختيارية، لكنها تحسن دقة عروض المقاولين. تحفظ أسماء الملفات وأنواعها وأحجامها فقط محليًا.
            </p>
            <label className="project-file-drop">
              <input type="file" multiple accept=".pdf,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.zip" onChange={files} />
              <span>＋ اختر المخططات والصور</span>
              <small>PDF، DWG، DXF، JPG، PNG، WEBP أو ZIP</small>
            </label>
            {form.attachments.map((file) => (
              <div className="project-file-row" key={file.id}>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {(file.size / 1024).toLocaleString("ar-SA", { maximumFractionDigits: 0 })} ك.ب · metadata
                  </small>
                </div>
                <select
                  value={file.category}
                  onChange={(event) =>
                    update(
                      "attachments",
                      form.attachments.map((item) =>
                        item.id === file.id
                          ? { ...item, category: event.target.value as ProjectAttachmentCategory }
                          : item,
                      ),
                    )
                  }
                >
                  {Object.entries(attachmentLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "attachments",
                      form.attachments.filter((item) => item.id !== file.id),
                    )
                  }
                >
                  حذف
                </button>
              </div>
            ))}
          </>
        ) : null}
        {step === 4 ? (
          <>
            <h3>المراجعة والخصوصية</h3>
            <RequestPreview request={form} />
            <div className="project-privacy">
              <strong>خصوصيتك محفوظة</strong>
              <p>
                لا يظهر اسمك أو جوالك أو بريدك للمقاولين. تعرض فقط المنطقة العامة والتفاصيل اللازمة للتسعير، ولا يفتح
                التواصل المباشر إلا وفق سياسة المنصة مستقبلًا.
              </p>
            </div>
            <label className="project-check policy">
              <input
                type="checkbox"
                checked={policyAccepted}
                onChange={(event) => setPolicyAccepted(event.target.checked)}
              />{" "}
              أوافق على{" "}
              <button type="button" onClick={() => setPolicyOpen(true)}>
                سياسة نشر طلبات المشاريع
              </button>
            </label>
            {errors.policy ? <p className="customer-error">{errors.policy}</p> : null}
          </>
        ) : null}
        <footer className="project-wizard-actions">
          <Link className="customer-ghost" href="/customer/project-requests">
            إلغاء
          </Link>
          <button className="customer-secondary" type="button" onClick={saveDraft}>
            حفظ كمسودة
          </button>
          {step > 0 ? (
            <button className="customer-secondary" type="button" onClick={() => setStep((value) => value - 1)}>
              السابق
            </button>
          ) : null}
          {step < steps.length - 1 ? (
            <button className="customer-primary" type="button" onClick={() => setStep((value) => value + 1)}>
              التالي
            </button>
          ) : (
            <>
              <button className="customer-secondary" type="button" onClick={() => setPreview(true)}>
                معاينة
              </button>
              <button className="customer-primary" type="button" onClick={submit}>
                إرسال للمراجعة
              </button>
            </>
          )}
        </footer>
      </form>
      {policyOpen && policy ? <ProjectPolicyModal policy={policy} onClose={() => setPolicyOpen(false)} /> : null}
      {preview ? (
        <div className="customer-modal-backdrop" onMouseDown={() => setPreview(false)}>
          <section
            className="project-preview-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => setPreview(false)}>
              ×
            </button>
            <RequestPreview request={form} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TechnicalForm({
  value,
  onChange,
}: {
  value: CustomerProjectRequest["technical"];
  onChange: (value: CustomerProjectRequest["technical"]) => void;
}) {
  return (
    <>
      <h3>التفاصيل الفنية</h3>
      <div className="project-form-grid">
        <Field label="المساحة">
          <input
            type="number"
            min="0"
            value={value.area ?? ""}
            onChange={(event) => onChange({ ...value, area: Number(event.target.value) || undefined })}
          />
        </Field>
        <Field label="وحدة المساحة">
          <input
            value={value.areaUnit ?? "م²"}
            onChange={(event) => onChange({ ...value, areaUnit: event.target.value })}
          />
        </Field>
        <Field label="عدد الأدوار">
          <input
            type="number"
            min="0"
            value={value.floors ?? ""}
            onChange={(event) => onChange({ ...value, floors: Number(event.target.value) || undefined })}
          />
        </Field>
        <Field label="حالة الموقع الحالية">
          <input
            value={value.siteCondition ?? ""}
            onChange={(event) => onChange({ ...value, siteCondition: event.target.value })}
          />
        </Field>
        <Field label="المواد المفضلة">
          <textarea
            rows={2}
            value={value.preferredMaterials ?? ""}
            onChange={(event) => onChange({ ...value, preferredMaterials: event.target.value })}
          />
        </Field>
        <Field label="متطلبات الجودة والسلامة">
          <textarea
            rows={2}
            value={value.qualitySafety ?? ""}
            onChange={(event) => onChange({ ...value, qualitySafety: event.target.value })}
          />
        </Field>
        <Field label="مسؤولية المواد">
          <select
            value={value.materialsResponsibility}
            onChange={(event) =>
              onChange({
                ...value,
                materialsResponsibility: event.target
                  .value as CustomerProjectRequest["technical"]["materialsResponsibility"],
              })
            }
          >
            <option value="customer">على العميل</option>
            <option value="contractor">على المقاول</option>
            <option value="by_proposal">حسب العرض</option>
          </select>
        </Field>
        <Field label="سكن أو نقل العمال">
          <input
            value={value.workerAccommodationTransport ?? ""}
            onChange={(event) => onChange({ ...value, workerAccommodationTransport: event.target.value })}
          />
        </Field>
        <Field label="ملاحظات إضافية" wide>
          <textarea
            rows={3}
            value={value.additionalNotes ?? ""}
            onChange={(event) => onChange({ ...value, additionalNotes: event.target.value })}
          />
        </Field>
      </div>
      <div className="project-choice-grid binary">
        {[
          ["requiresInspection", "يحتاج معاينة"],
          ["hasLicense", "توجد رخصة"],
          ["hasOfficialApprovals", "توجد موافقات رسمية"],
        ].map(([key, label]) => (
          <label className={value[key as keyof typeof value] ? "selected" : ""} key={key}>
            <input
              type="checkbox"
              checked={Boolean(value[key as keyof typeof value])}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </>
  );
}
function Field({
  label,
  error,
  wide,
  children,
}: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  );
}
function RequestPreview({ request }: { request: CustomerProjectRequest }) {
  return (
    <article className="project-request-preview">
      <header>
        <div>
          <small>{request.requestCode}</small>
          <h3>{request.title || "عنوان المشروع"}</h3>
        </div>
        <CustomerStatus value={request.status} />
      </header>
      <p>{request.description || "لم يضف وصف بعد."}</p>
      <dl>
        <div>
          <dt>النوع</dt>
          <dd>{request.otherProjectType || request.projectType}</dd>
        </div>
        <div>
          <dt>الموقع العام</dt>
          <dd>
            {request.city || "—"} · {request.region || "—"}
          </dd>
        </div>
        <div>
          <dt>الميزانية</dt>
          <dd>
            {request.budgetMax ? money(request.budgetMax) : "—"}
            {request.budgetNegotiable ? " · قابلة للنقاش" : ""}
          </dd>
        </div>
        <div>
          <dt>المدة</dt>
          <dd>{projectDuration(request)}</dd>
        </div>
        <div>
          <dt>التخصصات</dt>
          <dd>{request.requiredSpecialties.join("، ") || "—"}</dd>
        </div>
        <div>
          <dt>المرفقات</dt>
          <dd>{request.attachments.length}</dd>
        </div>
      </dl>
    </article>
  );
}

export function CustomerProjectRequestDetails({ id }: { id: string }) {
  const [request, setRequest] = useState<CustomerProjectRequest | null>(null);
  const [changes, setChanges] = useState<CustomerProjectChangeRequest[]>([]);
  const [confirm, setConfirm] = useState<{
    kind: "cancel" | "accept" | "reject" | "clarify";
    changeId?: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => {
    setRequest(readProjectStore("requests").find((item) => item.id === id) ?? null);
    setChanges(readProjectStore("changes").filter((item) => item.projectRequestId === id));
  }, [id]);
  const proposals = useMemo(() => readContractor("proposals").filter((item) => item.opportunityId === id), [id]);
  if (!request)
    return (
      <CustomerEmpty
        title="طلب المشروع غير موجود"
        description="قد يكون حُذف أو لا يخص الجلسة المحلية الحالية."
        href="/customer/project-requests"
        action="العودة للطلبات"
      />
    );
  const canEdit = request.status === "draft" || request.status === "needs_customer_changes";
  const edit = () => {
    localStorage.setItem("bunya-edit-project-request", request.id);
    location.href = "/customer/project-requests/new";
  };
  const decide = (
    changeId: string,
    decision: "accepted_by_customer" | "rejected_by_customer" | "customer_requested_clarification",
  ) => {
    const change = changes.find((item) => item.id === changeId);
    if (!change) return;
    const now = new Date().toISOString();
    let updatedRequest = request;
    if (decision === "accepted_by_customer") {
      const comment = readProjectStore("comments").find((item) => item.id === change.commentId);
      const oldValue = {
        budgetMax: request.budgetMax,
        durationValue: request.durationValue,
        durationUnit: request.durationUnit,
      };
      updatedRequest = {
        ...request,
        budgetMax: comment?.proposedBudget ?? request.budgetMax,
        durationValue: comment?.proposedDuration
          ? Number.parseInt(comment.proposedDuration, 10) || request.durationValue
          : request.durationValue,
        updatedAt: now,
      };
      writeProjectStore(
        "requests",
        readProjectStore("requests").map((item) => (item.id === id ? updatedRequest : item)),
      );
      syncPublishedOpportunity(updatedRequest);
      addProjectAudit(id, "customer", "العميل", "قبول تعديل مقترح", undefined, oldValue, {
        budgetMax: updatedRequest.budgetMax,
        durationValue: updatedRequest.durationValue,
        durationUnit: updatedRequest.durationUnit,
      });
    }
    const nextChanges = changes.map((item) =>
      item.id === changeId ? { ...item, status: decision, decidedAt: now } : item,
    );
    writeProjectStore(
      "changes",
      readProjectStore("changes").map((item) =>
        item.id === changeId ? { ...item, status: decision, decidedAt: now } : item,
      ),
    );
    writeProjectStore(
      "comments",
      readProjectStore("comments").map((item) =>
        item.id === change?.commentId ? { ...item, status: decision, updatedAt: now } : item,
      ),
    );
    addProjectNotification({
      recipientRole: "contractor",
      projectRequestId: id,
      type: "customer_decision",
      title: "صدر قرار العميل على تعليقك",
      message:
        decision === "accepted_by_customer"
          ? "قبل العميل الاقتراح."
          : decision === "rejected_by_customer"
            ? "رفض العميل الاقتراح."
            : "طلب العميل توضيحًا عبر القناة الداخلية.",
      link: "/contractor/project-comments",
    });
    setRequest(updatedRequest);
    setChanges(nextChanges);
    setToast("تم تسجيل القرار وإشعار المقاول دون كشف هويتك.");
    setConfirm(null);
  };
  const cancel = () => {
    const next = {
      ...request,
      status: "cancelled" as const,
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeProjectStore(
      "requests",
      readProjectStore("requests").map((item) => (item.id === id ? next : item)),
    );
    syncPublishedOpportunity(next);
    addProjectAudit(id, "customer", "العميل", "إلغاء طلب المشروع");
    setRequest(next);
    setConfirm(null);
    setToast("تم إلغاء الطلب محليًا.");
  };
  return (
    <div className="customer-page-stack">
      <CustomerToast message={toast} />
      <CustomerHeader
        eyebrow={request.requestCode}
        title={request.title}
        description={`${request.projectType} · ${request.city} · ${statusLabels[request.status]}`}
        action={<CustomerStatus value={request.status} />}
      />
      <div className="customer-detail-grid">
        <section>
          <article className="customer-panel">
            <h3>بيانات المشروع</h3>
            <p className="project-readable">{request.description}</p>
            <p className="project-readable">
              <b>النطاق:</b> {request.scope}
            </p>
            <dl className="customer-info-grid">
              <div>
                <dt>الموقع العام</dt>
                <dd>
                  {request.city} · {request.region}
                </dd>
              </div>
              <div>
                <dt>الميزانية</dt>
                <dd>
                  {money(request.budgetMax)} {request.budgetNegotiable ? "· قابلة للنقاش" : ""}
                </dd>
              </div>
              <div>
                <dt>المدة</dt>
                <dd>{projectDuration(request)}</dd>
              </div>
              <div>
                <dt>البدء</dt>
                <dd>{customerDate(request.expectedStartAt)}</dd>
              </div>
              <div>
                <dt>مهلة العروض</dt>
                <dd>{new Date(request.proposalDeadlineAt).toLocaleString("ar-SA")}</dd>
              </div>
              <div>
                <dt>الموقع</dt>
                <dd>
                  <a href={request.mapsUrl} target="_blank">
                    فتح Google Maps
                  </a>
                </dd>
              </div>
            </dl>
            <div className="project-tags">
              {request.requiredSpecialties.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </article>
          <article className="customer-panel">
            <h3>المخططات والمرفقات</h3>
            {request.attachments.length ? (
              request.attachments.map((file) => (
                <div className="project-file-row" key={file.id}>
                  <div>
                    <strong>{file.name}</strong>
                    <small>{attachmentLabels[file.category]} · metadata</small>
                  </div>
                </div>
              ))
            ) : (
              <p>لا توجد مخططات مرفقة.</p>
            )}
          </article>
          <article className="customer-panel">
            <h3>Timeline</h3>
            <ol className="customer-timeline">
              <li>
                <b>إنشاء الطلب</b>
                <span>{customerDate(request.createdAt)}</span>
              </li>
              <li>
                <b>مراجعة الإدارة</b>
                <span>{request.status === "draft" ? "لم يرسل" : request.adminNote || "تم الاستلام"}</span>
              </li>
              <li>
                <b>النشر واستقبال العروض</b>
                <span>{request.publishedAt ? customerDate(request.publishedAt) : "بانتظار الاعتماد"}</span>
              </li>
              <li>
                <b>الإسناد والتنفيذ</b>
                <span>
                  {["awarded", "in_progress", "completed"].includes(request.status)
                    ? statusLabels[request.status]
                    : "لاحقًا"}
                </span>
              </li>
            </ol>
          </article>
          <article className="customer-panel">
            <h3>التعليقات المعتمدة وطلبات القرار</h3>
            {changes.length ? (
              changes.map((change) => (
                <section className="project-change-card" key={change.id}>
                  <CustomerStatus value={change.status} />
                  <h4>
                    {change.type === "budget_change"
                      ? "تعديل الميزانية"
                      : change.type === "duration_change"
                        ? "تعديل المدة"
                        : "اقتراح على الطلب"}
                  </h4>
                  <dl>
                    <div>
                      <dt>الحالي</dt>
                      <dd>{change.currentValue}</dd>
                    </div>
                    <div>
                      <dt>المقترح</dt>
                      <dd>{change.proposedValue}</dd>
                    </div>
                  </dl>
                  <p>{change.reason}</p>
                  {change.adminNote ? <small>ملاحظة الإدارة: {change.adminNote}</small> : null}
                  {change.status === "pending_customer_decision" ? (
                    <footer>
                      <button
                        className="customer-primary"
                        onClick={() => setConfirm({ kind: "accept", changeId: change.id })}
                      >
                        قبول
                      </button>
                      <button
                        className="customer-danger"
                        onClick={() => setConfirm({ kind: "reject", changeId: change.id })}
                      >
                        رفض
                      </button>
                      <button
                        className="customer-secondary"
                        onClick={() => setConfirm({ kind: "clarify", changeId: change.id })}
                      >
                        طلب توضيح
                      </button>
                    </footer>
                  ) : null}
                </section>
              ))
            ) : (
              <p>لا توجد تعليقات اعتمدتها الإدارة بعد.</p>
            )}
          </article>
          <article className="customer-panel">
            <h3>عروض المقاولين</h3>
            {proposals.length ? (
              proposals.map((proposal: ContractorProposal) => (
                <div className="project-proposal-row" key={proposal.id}>
                  <div>
                    <strong>{proposal.proposalCode}</strong>
                    <small>{proposal.executionDuration}</small>
                  </div>
                  <b>{money(proposal.amount)}</b>
                  <CustomerStatus value={proposal.status} />
                </div>
              ))
            ) : (
              <p>لم تصل عروض بعد.</p>
            )}
          </article>
        </section>
        <aside>
          <article className="customer-panel customer-summary">
            <h3>إجراءات الطلب</h3>
            <CustomerStatus value={request.status} />
            {request.adminNote ? <p className="customer-policy-note">{request.adminNote}</p> : null}
            {canEdit ? (
              <button className="customer-primary" onClick={edit}>
                تعديل الطلب
              </button>
            ) : null}
            {["draft", "pending_admin_review", "needs_customer_changes", "published", "receiving_proposals"].includes(
              request.status,
            ) ? (
              <button className="customer-danger" onClick={() => setConfirm({ kind: "cancel" })}>
                إلغاء الطلب
              </button>
            ) : null}
            <Link className="customer-secondary" href="/customer/project-requests">
              كل الطلبات
            </Link>
          </article>
          <article className="customer-panel">
            <h3>الخصوصية</h3>
            <p>بياناتك الشخصية ووسائل التواصل غير معروضة للمقاولين.</p>
          </article>
        </aside>
      </div>
      {confirm ? (
        <CustomerConfirm
          title={confirm.kind === "cancel" ? "إلغاء طلب المشروع؟" : "تأكيد قرارك"}
          description={
            confirm.kind === "cancel"
              ? "سيختفي الطلب من فرص المقاولين ولا يمكن استقبال عروض جديدة."
              : "سيُسجل القرار ويصل إلى المقاول دون إظهار بياناتك الشخصية."
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            confirm.kind === "cancel"
              ? cancel()
              : decide(
                  confirm.changeId ?? "",
                  confirm.kind === "accept"
                    ? "accepted_by_customer"
                    : confirm.kind === "reject"
                      ? "rejected_by_customer"
                      : "customer_requested_clarification",
                )
          }
        />
      ) : null}
    </div>
  );
}
