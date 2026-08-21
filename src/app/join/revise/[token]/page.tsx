"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MultiValueInput, PortalShell } from "@/components/PortalUI";
import type { ParsedMapLocation } from "@/lib/bunya-types";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import { optimizeUploadFiles } from "@/lib/uploads/client";
import { isValidJoinUsername } from "@/lib/join/username";

type Application = {
  id: string;
  email: string;
  mobile: string;
  company_name?: string;
  contact_name?: string;
  contractor_name?: string;
  requested_username?: string;
  google_maps_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  discount_code?: string | null;
  delivery_available?: boolean;
  review_notes?: string;
  categories: string[];
  regions: string[];
  specialties: string[];
  documents: Array<{ id: string; name: string; url: string }>;
};

type FormState = {
  companyName: string;
  contactName: string;
  contractorName: string;
  email: string;
  mobile: string;
  username: string;
  mapsUrl: string;
  discountCode: string;
  latitude: string;
  longitude: string;
};

const emptyForm: FormState = {
  companyName: "",
  contactName: "",
  contractorName: "",
  email: "",
  mobile: "",
  username: "",
  mapsUrl: "",
  discountCode: "",
  latitude: "",
  longitude: "",
};

export default function ReviseJoinApplicationPage() {
  const { token } = useParams<{ token: string }>();
  const [kind, setKind] = useState<"provider" | "contractor">("provider");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [categories, setCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [delivery, setDelivery] = useState(false);
  const [documents, setDocuments] = useState<Application["documents"]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [mapMessage, setMapMessage] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const [requestedChanges, setRequestedChanges] = useState("");
  const [applicationId, setApplicationId] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as {
          kind?: "provider" | "contractor";
          application?: Application;
          availableCategories?: string[];
          message?: string;
        };
        if (!response.ok || !body.application || !body.kind) throw new Error(body.message || "تعذر فتح الطلب.");
        if (!active) return;
        const application = body.application;
        setKind(body.kind);
        setApplicationId(application.id);
        setRequestedChanges(application.review_notes || "");
        setAvailableCategories(body.availableCategories || []);
        setCategories(application.categories || []);
        setRegions(application.regions || []);
        setSpecialties(application.specialties || []);
        setDelivery(Boolean(application.delivery_available));
        setDocuments(application.documents || []);
        setForm({
          companyName: application.company_name || "",
          contactName: application.contact_name || "",
          contractorName: application.contractor_name || "",
          email: application.email,
          mobile: application.mobile,
          username: application.requested_username || "",
          mapsUrl: application.google_maps_url || "",
          discountCode: application.discount_code || "",
          latitude: application.latitude === null || application.latitude === undefined ? "" : String(application.latitude),
          longitude: application.longitude === null || application.longitude === undefined ? "" : String(application.longitude),
        });
        setState("ready");
      })
      .catch((error: Error) => {
        if (active) {
          setMessage(error.message);
          setState("error");
        }
      });
    return () => { active = false; };
  }, [token]);

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const analyzeMap = async () => {
    setMapBusy(true);
    setMapMessage("");
    let parsed: ParsedMapLocation = parseGoogleMapsLink(form.mapsUrl);
    if (parsed.kind === "short-link") {
      try {
        const response = await fetch("/api/public/maps/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: parsed.url }),
        });
        parsed = await response.json() as ParsedMapLocation;
      } catch {
        parsed = { kind: "invalid", url: form.mapsUrl, message: "تعذر تحليل رابط الموقع." };
      }
    }
    if (parsed.kind === "coordinates") {
      setForm((current) => ({
        ...current,
        mapsUrl: parsed.url,
        latitude: String(parsed.latitude),
        longitude: String(parsed.longitude),
      }));
    }
    setMapMessage(parsed.message);
    setMapBusy(false);
    return parsed;
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    if (documents.length + selected.length > 5) {
      setMessage(`يمكنك إضافة ${Math.max(0, 5 - documents.length)} مستند فقط؛ الحد الإجمالي خمسة.`);
      event.target.value = "";
      return;
    }
    setMessage("");
    setFiles(selected);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage("");
    try {
      let parsedMap: ParsedMapLocation | null = null;
      if (kind === "provider") {
        if (!isValidJoinUsername(form.username.trim())) {
          throw new Error("اسم المستخدم يجب أن يكون من 4 إلى 40 حرفًا وبدون مسافات. استخدم _ أو - للفصل.");
        }
        parsedMap = await analyzeMap();
        if (parsedMap.kind === "invalid") throw new Error(parsedMap.message);
      }

      const data = new FormData();
      data.set("email", form.email);
      data.set("mobile", form.mobile);
      data.set("regions", JSON.stringify(kind === "provider" && !delivery ? [] : regions));
      if (kind === "provider") {
        data.set("companyName", form.companyName);
        data.set("contactName", form.contactName);
        data.set("username", form.username);
        data.set("mapsUrl", parsedMap?.url || form.mapsUrl);
        data.set("latitude", parsedMap?.kind === "coordinates" ? String(parsedMap.latitude) : form.latitude);
        data.set("longitude", parsedMap?.kind === "coordinates" ? String(parsedMap.longitude) : form.longitude);
        data.set("discountCode", form.discountCode);
        data.set("deliveryAvailable", String(delivery));
        data.set("categories", JSON.stringify(categories));
      } else {
        data.set("contractorName", form.contractorName);
        data.set("specialties", JSON.stringify(specialties));
      }

      const optimized = await optimizeUploadFiles(files);
      optimized.forEach((file) => data.append("documents", file));
      const response = await fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, {
        method: "POST",
        body: data,
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || "تعذر حفظ التعديلات.");
      setState("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ التعديلات.");
      setState("ready");
    }
  }

  if (state === "loading") return <PortalShell><section className="portal-card application-card"><p>جارٍ تحميل الطلب كاملًا...</p></section></PortalShell>;
  if (state === "error") return <PortalShell><section className="portal-card application-card"><h1>تعذر فتح الرابط</h1><p className="portal-form-error">{message}</p></section></PortalShell>;
  if (state === "done") return <PortalShell><section className="portal-card application-card"><h1>تم استلام التعديلات</h1><p>عاد الطلب إلى قائمة المراجعة، وتم إلغاء رابط التعديل ولا يمكن استخدامه مرة أخرى.</p></section></PortalShell>;

  const customCategories = categories.filter((category) => !availableCategories.includes(category));
  const standardCategories = categories.filter((category) => availableCategories.includes(category));

  return (
    <PortalShell>
      <section className="portal-card application-card">
        <header className="portal-heading application-heading">
          <p>استكمال طلب الانضمام</p>
          <h1>تعديل طلب {kind === "provider" ? "المزوّد" : "المقاول"}</h1>
          <span>راجع الطلب كاملًا، نفّذ التعديل المطلوب ثم أعد إرساله للمراجعة.</span>
        </header>
        <aside className="portal-form-message" role="note">
          <b>رقم الطلب: <span dir="ltr">{applicationId}</span></b><br />
          التعديل المطلوب: {requestedChanges || "راجع البيانات المطلوبة ثم أعد الإرسال."}<br />
          <small>هذا الرابط يُلغى تلقائيًا فور إعادة إرسال الطلب.</small>
        </aside>

        <form className="application-form" onSubmit={submit} noValidate>
          <fieldset className="form-section">
            <legend><span>01</span> بيانات مقدم الطلب</legend>
            <div className="form-grid">
              <label className="portal-field"><span>{kind === "provider" ? "اسم الشركة" : "اسم المقاول"}</span><input required value={kind === "provider" ? form.companyName : form.contractorName} onChange={(event) => update(kind === "provider" ? "companyName" : "contractorName", event.target.value)} /></label>
              {kind === "provider" ? <label className="portal-field"><span>اسم المسؤول</span><input required value={form.contactName} onChange={(event) => update("contactName", event.target.value)} /></label> : null}
              <label className="portal-field"><span>البريد الإلكتروني</span><input type="email" required value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
              <label className="portal-field"><span>رقم الجوال</span><input inputMode="tel" required value={form.mobile} onChange={(event) => update("mobile", event.target.value)} /></label>
              {kind === "provider" ? <label className="portal-field"><span>اسم المستخدم المطلوب</span><input required value={form.username} onChange={(event) => update("username", event.target.value)} /></label> : null}
              {kind === "provider" ? <label className="portal-field"><span>كود الخصم (اختياري)</span><input value={form.discountCode} onChange={(event) => update("discountCode", event.target.value)} /></label> : null}
            </div>
          </fieldset>

          {kind === "provider" ? (
            <>
              <fieldset className="form-section">
                <legend><span>02</span> موقع مقدم الطلب</legend>
                <div className="map-input-row">
                  <label className="portal-field"><span>رابط Google Maps</span><input required value={form.mapsUrl} onChange={(event) => { update("mapsUrl", event.target.value); setMapMessage(""); }} /></label>
                  <button type="button" disabled={mapBusy} onClick={() => void analyzeMap()}>{mapBusy ? "جارٍ التحليل..." : "تحليل الرابط"}</button>
                </div>
                {mapMessage ? <p className="portal-hint">{mapMessage}</p> : null}
              </fieldset>

              <fieldset className="form-section">
                <legend><span>03</span> التصنيفات الرئيسية المتوفرة</legend>
                <div className="choice-grid">
                  {availableCategories.map((category) => (
                    <label className={categories.includes(category) ? "choice-card choice-card-active" : "choice-card"} key={category}>
                      <input
                        type="checkbox"
                        checked={categories.includes(category)}
                        onChange={() => setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])}
                      />
                      {category}
                    </label>
                  ))}
                </div>
                <MultiValueInput label="تصنيفات أخرى" placeholder="اكتب التصنيف" values={customCategories} onChange={(custom) => setCategories([...standardCategories, ...custom])} />
              </fieldset>

              <fieldset className="form-section">
                <legend><span>04</span> التوصيل والمناطق</legend>
                <div className="binary-choice">
                  <label className={delivery ? "active" : ""}><input type="radio" checked={delivery} onChange={() => setDelivery(true)} />نعم، يوجد توصيل</label>
                  <label className={!delivery ? "active" : ""}><input type="radio" checked={!delivery} onChange={() => { setDelivery(false); setRegions([]); }} />لا يوجد توصيل</label>
                </div>
                {delivery ? <MultiValueInput label="مناطق التوصيل" placeholder="مثال: شمال الرياض" values={regions} onChange={setRegions} /> : null}
              </fieldset>
            </>
          ) : (
            <>
              <fieldset className="form-section"><legend><span>02</span> مناطق العمل</legend><MultiValueInput label="المناطق" placeholder="اكتب المنطقة" values={regions} onChange={setRegions} /></fieldset>
              <fieldset className="form-section"><legend><span>03</span> التخصصات</legend><MultiValueInput label="التخصصات" placeholder="مثال: بناء عظم" values={specialties} onChange={setSpecialties} /></fieldset>
            </>
          )}

          <fieldset className="form-section">
            <legend><span>{kind === "provider" ? "05" : "04"}</span> المستندات الرسمية</legend>
            <div className="revision-current-documents">
              {documents.length ? documents.map((document) => <a href={document.url} target="_blank" rel="noreferrer" key={document.id}>{document.name} — عرض المستند الحالي</a>) : <p className="portal-hint">لا توجد مستندات حالية.</p>}
            </div>
            <label className="portal-field"><span>إضافة مستندات مصححة — الحد الإجمالي خمسة ملفات</span><input type="file" accept=".pdf,image/jpeg,image/png,image/webp" multiple onChange={selectFiles} /></label>
            <p className="portal-hint">تُضغط الصور تلقائيًا قبل التخزين. المستندات الجديدة تُضاف إلى الطلب الحالي.</p>
            {files.map((file) => <p className="portal-hint" key={`${file.name}-${file.size}`}>{file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB</p>)}
          </fieldset>

          {message ? <p className="portal-form-error" role="alert">{message}</p> : null}
          <button className="portal-primary-button application-submit" disabled={state === "saving"}>{state === "saving" ? "جارٍ حفظ وإرسال الطلب..." : "حفظ التعديلات وإعادة الإرسال"}</button>
        </form>
      </section>
    </PortalShell>
  );
}
