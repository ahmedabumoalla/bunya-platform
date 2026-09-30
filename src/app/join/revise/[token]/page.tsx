"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ContractorApplicationForm, type ContractorRevisionApplication } from "@/components/join/ContractorApplicationForm";
import { useParams } from "next/navigation";
import { MultiValueInput, PortalShell } from "@/components/PortalUI";
import type { ParsedMapLocation } from "@/lib/bunya-types";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import { ProviderUploadError, uploadProviderDocuments } from "@/lib/uploads/provider-resumable-client";
import { isValidProviderUsername, resolveProviderUsername } from "@/lib/join/provider-fields";
import { normalizeProviderText, normalizeServiceCities } from "@/lib/join/provider-fields";
import { appendProviderConsent, appendProviderFiles, ProviderDocuments, ProviderPolicyConsent, ServiceCitiesInput, useProviderPolicy, validateProviderFiles, type ProviderFiles, type ExistingProviderDocument } from "@/components/join/ProviderJoinFields";

type Application = {
  id: string;
  email: string;
  mobile: string;
  company_name?: string;
  company_name_en?: string;
  service_cities?: string[];
  contact_name?: string;
  contractor_name?: string;
  requested_username?: string;
  username_is_custom?: boolean;
  google_maps_url?: string;
  latitude?: number | null;
  longitude?: number | null;
  delivery_available?: boolean;
  review_notes?: string;
  categories: string[];
  regions: string[];
  specialties: string[];
  documents: ExistingProviderDocument[];
};

type FormState = {
  companyName: string;
  companyNameEn: string;
  contactName: string;
  contractorName: string;
  email: string;
  mobile: string;
  username: string;
  mapsUrl: string;
  latitude: string;
  longitude: string;
};

const emptyForm: FormState = {
  companyName: "",
  companyNameEn: "",
  contactName: "",
  contractorName: "",
  email: "",
  mobile: "",
  username: "",
  mapsUrl: "",
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
  const [contractorApplication, setContractorApplication] = useState<ContractorRevisionApplication | null>(null);
  const [providerFiles, setProviderFiles] = useState<ProviderFiles>({});
  const [serviceCities, setServiceCities] = useState<string[]>([]);
  const [mapMessage, setMapMessage] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const [requestedChanges, setRequestedChanges] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const policyState = useProviderPolicy(kind === "provider" && Boolean(applicationId));
  const submitting = useRef(false);
  const [uploadStatus, setUploadStatus] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as {
          kind?: "provider" | "contractor";
          application?: Application & ContractorRevisionApplication;
          availableCategories?: string[];
          message?: string;
        };
        if (!response.ok || !body.application || !body.kind) throw new Error(body.message || "تعذر فتح الطلب.");
        if (!active) return;
        const application = body.application;
        setKind(body.kind);
        if (body.kind === "contractor") setContractorApplication(application);
        setApplicationId(application.id);
        setRequestedChanges(application.review_notes || "");
        setAvailableCategories(body.availableCategories || []);
        setCategories(application.categories || []);
        setRegions(application.regions || []);
        setSpecialties(application.specialties || []);
        setDelivery(Boolean(application.delivery_available));
        setDocuments(application.documents || []);
        setServiceCities(application.service_cities || []);
        setForm({
          companyName: application.company_name || "",
          companyNameEn: application.company_name_en || "",
          contactName: application.contact_name || "",
          contractorName: application.contractor_name || "",
          email: application.email,
          mobile: application.mobile,
          username: application.username_is_custom === false ? "" : application.requested_username || "",
          mapsUrl: application.google_maps_url || "",
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setState("saving");
    setMessage("");
    try {
      let parsedMap: ParsedMapLocation | null = null;
      if (kind === "provider") {
        for (const name of [form.companyName, form.companyNameEn]) {
          const normalized = normalizeProviderText(name);
          if (normalized.length < 2 || normalized.length > 160) throw new Error("أدخل اسم الشركة بالعربية والإنجليزية من حرفين إلى 160 حرفًا لكل اسم.");
        }
        if (normalizeProviderText(form.contactName).length > 120) throw new Error("اسم المسؤول لا يتجاوز 120 حرفًا.");
        if (!serviceCities.length) throw new Error("أضف مدينة واحدة على الأقل ثم اضغط Enter أو إضافة مدينة.");
        if (!policyState.policy || !policyState.accepted) throw new Error("يلزم الاطلاع على سياسة الانضمام الحالية والموافقة عليها.");
        const documentError = validateProviderFiles(providerFiles, documents);
        if (documentError) throw new Error(documentError);
        if (!isValidProviderUsername(resolveProviderUsername(form.username, form.companyNameEn))) {
          throw new Error("اسم المستخدم يجب أن يكون من حرفين إلى 160 حرفًا، والمسافات مسموحة.");
        }
        parsedMap = await analyzeMap();
        if (parsedMap.kind === "invalid") throw new Error(parsedMap.message);
      }

      const data = new FormData();
      data.set("email", form.email);
      data.set("mobile", form.mobile);
      data.set("regions", JSON.stringify(kind === "provider" && !delivery ? [] : regions));
      if (kind === "provider") {
        data.set("companyName", normalizeProviderText(form.companyName));
        data.set("companyNameEn", normalizeProviderText(form.companyNameEn));
        data.set("contactName", normalizeProviderText(form.contactName));
        data.set("serviceCities", JSON.stringify(normalizeServiceCities(serviceCities)));
        appendProviderConsent(data, policyState.policy!);
        data.set("username", form.username);
        data.set("mapsUrl", parsedMap?.url || form.mapsUrl);
        data.set("latitude", parsedMap?.kind === "coordinates" ? String(parsedMap.latitude) : form.latitude);
        data.set("longitude", parsedMap?.kind === "coordinates" ? String(parsedMap.longitude) : form.longitude);
        data.set("deliveryAvailable", String(delivery));
        data.set("categories", JSON.stringify(categories));
      } else {
        data.set("contractorName", form.contractorName);
        data.set("specialties", JSON.stringify(specialties));
      }

      if (kind === "provider") {
        appendProviderFiles(data, providerFiles);
        setUploadStatus("جارٍ تجهيز وضغط المستندات...");
        await uploadProviderDocuments(data, { revisionToken: token, onProgress: (percent) => setUploadStatus(`جارٍ رفع المستندات: ${percent}٪`) });
        setUploadStatus("جارٍ حفظ وإرسال الطلب...");
      }
      const response = await fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, {
        method: "POST",
        body: data,
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) { if (kind === "provider" && response.status === 409) policyState.reload(); throw new Error(body.message || "تعذر حفظ التعديلات."); }
      setState("done");
    } catch (error) {
      if (error instanceof ProviderUploadError && error.status === 409) policyState.reload();
      setMessage(error instanceof Error ? error.message : "تعذر حفظ التعديلات.");
      setState("ready");
    } finally {
      submitting.current = false;
      setUploadStatus("");
    }
  }

  if (state === "loading") return <PortalShell><section className="portal-card application-card"><p>جارٍ تحميل الطلب كاملًا...</p></section></PortalShell>;
  if (state === "error") return <PortalShell><section className="portal-card application-card"><h1>تعذر فتح الرابط</h1><p className="portal-form-error">{message}</p></section></PortalShell>;
  if (state === "done") return <PortalShell><section className="portal-card application-card"><h1>تم استلام التعديلات</h1><p>عاد الطلب إلى قائمة المراجعة، وتم إلغاء رابط التعديل ولا يمكن استخدامه مرة أخرى.</p></section></PortalShell>;

  if (kind === "contractor" && contractorApplication) return <ContractorApplicationForm initial={contractorApplication} revisionToken={token} />;

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
              <label className="portal-field"><span>{kind === "provider" ? "اسم الشركة بالعربية" : "اسم المقاول"}</span><input required value={kind === "provider" ? form.companyName : form.contractorName} onChange={(event) => update(kind === "provider" ? "companyName" : "contractorName", event.target.value)} /></label>
              {kind === "provider" ? <><label className="portal-field"><span>اسم الشركة بالإنجليزية</span><input required dir="ltr" value={form.companyNameEn} onChange={(event) => update("companyNameEn", event.target.value)} /></label><label className="portal-field"><span>اسم المسؤول (اختياري)</span><input value={form.contactName} onChange={(event) => update("contactName", event.target.value)} /></label></> : null}
              <label className="portal-field"><span>البريد الإلكتروني</span><input type="email" required value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
              <label className="portal-field"><span>رقم الجوال</span><input inputMode="tel" required value={form.mobile} onChange={(event) => update("mobile", event.target.value)} /></label>
              {kind === "provider" ? <label className="portal-field"><span>اسم المستخدم (اختياري)</span><input placeholder="اتركه فارغًا لاستخدام اسم الشركة بالإنجليزية" value={form.username} onChange={(event) => update("username", event.target.value)} /></label> : null}
              {kind === "provider" ? <ServiceCitiesInput values={serviceCities} onChange={setServiceCities} /> : null}
            </div>
            {kind === "provider" ? <p className="portal-hint">يمكن أن يتكوّن اسم الشركة من عدة كلمات تفصل بينها مسافات.</p> : null}
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

          {kind === "provider" ? <><ProviderDocuments files={providerFiles} onChange={setProviderFiles} existing={documents}/><ProviderPolicyConsent value={policyState}/></> : null}

          {message ? <p className="portal-form-error" role="alert">{message}</p> : null}
          {kind === "provider" ? <p className="portal-hint" role="status" aria-live="polite" aria-atomic="true">{uploadStatus}</p> : null}
          <button className="portal-primary-button application-submit" disabled={state === "saving" || (kind === "provider" && (!policyState.policy || !policyState.accepted))}>{state === "saving" ? "جارٍ حفظ وإرسال الطلب..." : "حفظ التعديلات وإعادة الإرسال"}</button>
        </form>
      </section>
    </PortalShell>
  );
}
