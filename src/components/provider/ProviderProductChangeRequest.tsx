"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { signProductImageMap } from "@/lib/products/image-urls";
import { createClient } from "@/lib/supabase/client";
import { optimizeUploadFile } from "@/lib/uploads/client";
import styles from "./ProviderProducts.module.css";

type Category = { id: string; name: string };
type ExistingImage = { id: string; storage_path: string | null; image_url: string | null; alt_text: string; is_primary: boolean; sort_order: number; signed_url?: string | null };
type NewImage = { file: File; preview: string };
type RepeatOption = { type: string; value: string };
type Product = Record<string, unknown> & {
  id: string; provider_id: string; category_id: string | null; custom_category: string | null;
  name: string; sku: string | null; base_unit: string; description: string; full_description: string;
  availability_status: string; lead_time_label: string; delivery_window: string; delivery_notes: string;
  offer_type: string; unit_price: number | null; minimum_order: number | null; stock_quantity: number | null;
  vat_inclusive: boolean; rental_duration_value: number | null; rental_duration_unit: string | null;
  review_status: string; product_images: ExistingImage[];
  product_measurements: Array<{ label: string; sort_order: number }>;
  product_variants: Array<{ name: string; attributes: Record<string, unknown>; sort_order: number }>;
  product_specifications: Array<{ value: string; sort_order: number }>;
  product_warranties: { duration: string; details: string } | null;
  product_availability_regions: Array<{ city: string; scope: string }>;
  product_delivery_configs: { is_available: boolean; maximum_duration: number | null; duration_unit: string | null; price_per_km: number | null; maximum_distance_km: number | null; notes: string | null } | null;
  product_delivery_regions: Array<{ region_name: string }>;
};

const specificationFields: Array<[string, string]> = [
  ["GTIN / الباركود", "gtin"], ["المصنّع / العلامة", "manufacturer"], ["بلد المنشأ", "country_of_origin"],
  ["المادة / التركيبة", "material"], ["الدرجة / الفئة", "grade"], ["الوزن", "weight"],
  ["اللون / التشطيب", "color"], ["التعبئة", "packaging"], ["المواصفة أو شهادة المطابقة", "standard_reference"],
  ["الاستخدام المخصص", "intended_use"], ["السلامة والمناولة", "safety_notes"], ["شروط التخزين", "storage_conditions"],
];

function specificationValue(product: Product, label: string) {
  const prefix = `${label}:`;
  return product.product_specifications.find((item) => item.value.startsWith(prefix))?.value.slice(prefix.length).trim() || "";
}

function variantInput(product: Product): RepeatOption[] {
  return [...product.product_variants].sort((a, b) => a.sort_order - b.sort_order).map((item) => {
    const entry = Object.entries(item.attributes || {})[0];
    if (entry) return { type: entry[0], value: String(entry[1] ?? "") };
    const [type, ...value] = item.name.split(":");
    return { type: type.trim() || "أخرى", value: value.join(":").trim() };
  }).filter((item) => item.value);
}

export function ProviderProductChangeRequest({ productId }: { productId: string }) {
  const identity = useAuthIdentity();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [offerType, setOfferType] = useState("sale");
  const [availability, setAvailability] = useState("available");
  const [vatInclusive, setVatInclusive] = useState(true);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [measurements, setMeasurements] = useState<string[]>([]);
  const [measurementDraft, setMeasurementDraft] = useState("");
  const [variants, setVariants] = useState<RepeatOption[]>([]);
  const [variantType, setVariantType] = useState("المقاس");
  const [variantValue, setVariantValue] = useState("");
  const [availabilityRegions, setAvailabilityRegions] = useState<Array<{ city: string; scope: string }>>([]);
  const [availabilityCity, setAvailabilityCity] = useState("");
  const [deliveryRegions, setDeliveryRegions] = useState<string[]>([]);
  const [deliveryRegion, setDeliveryRegion] = useState("");
  const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
  const [newImages, setNewImages] = useState<NewImage[]>([]);
  const previews = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    const previewUrls = previews.current;
    const db = createClient();
    void Promise.all([
      db.from("product_categories").select("id,name").eq("is_active", true).order("sort_order"),
      db.from("products").select("id,provider_id,category_id,custom_category,name,sku,base_unit,description,full_description,availability_status,lead_time_label,delivery_window,delivery_notes,offer_type,unit_price,minimum_order,stock_quantity,vat_inclusive,rental_duration_value,rental_duration_unit,review_status,product_images(id,storage_path,image_url,alt_text,is_primary,sort_order),product_measurements(label,sort_order),product_variants(name,attributes,sort_order),product_specifications(value,sort_order),product_warranties(duration,details),product_availability_regions(city,scope),product_delivery_configs(is_available,maximum_duration,duration_unit,price_per_km,maximum_distance_km,notes),product_delivery_regions(region_name)").eq("id", productId).maybeSingle(),
      db.from("product_change_requests").select("id").eq("product_id", productId).eq("status", "pending").maybeSingle(),
    ]).then(async ([categoryResult, productResult, pendingResult]) => {
      if (!active) return;
      if (categoryResult.error || productResult.error || !productResult.data) {
        setError("تعذر تحميل بيانات المنتج للتعديل."); setLoading(false); return;
      }
      const value = productResult.data as unknown as Product;
      if (value.provider_id !== identity.details.provider?.providerId) {
        setError("المنتج غير مرتبط بمنشأتك."); setLoading(false); return;
      }
      const images = [...(value.product_images || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
      const urls = await signProductImageMap(db, images.map((item) => item.storage_path || ""), { width: 720, height: 520, quality: 74 });
      if (!active) return;
      setCategories((categoryResult.data || []) as Category[]);
      setProduct(value);
      setCategoryId(value.category_id || "other");
      setOfferType(value.offer_type || "sale");
      setAvailability(value.availability_status || "available");
      setVatInclusive(value.vat_inclusive);
      setDeliveryAvailable(Boolean(value.product_delivery_configs?.is_available));
      setMeasurements([...value.product_measurements].sort((a, b) => a.sort_order - b.sort_order).map((item) => item.label));
      setVariants(variantInput(value));
      setAvailabilityRegions(value.product_availability_regions || []);
      setDeliveryRegions((value.product_delivery_regions || []).map((item) => item.region_name));
      setExistingImages(images.map((item) => ({ ...item, signed_url: (item.storage_path ? urls.get(item.storage_path) : null) || item.image_url })));
      setPendingRequest(Boolean(pendingResult.data));
      setLoading(false);
    });
    return () => { active = false; previewUrls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [identity.details.provider?.providerId, productId]);

  const allImageCount = existingImages.length + newImages.length;
  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid || allImageCount + files.length > 6) {
      setError(invalid ? `الصورة ${invalid.name} غير مدعومة أو أكبر من 5MB.` : "يمكن أن يحتوي المنتج على 6 صور كحد أقصى.");
      event.target.value = ""; return;
    }
    const additions = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    previews.current.push(...additions.map((item) => item.preview));
    setNewImages((current) => [...current, ...additions]); setError(""); event.target.value = "";
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product || busy || pendingRequest) return;
    if (!allImageCount) { setError("أبقِ صورة واحدة على الأقل للمنتج."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("category_id", categoryId);
      form.set("offer_type", offerType);
      form.set("availability_status", availability);
      form.set("vat_inclusive", String(vatInclusive));
      form.set("delivery_available", String(deliveryAvailable));
      form.set("measurements", JSON.stringify([...new Set([...measurements, measurementDraft.trim()].filter(Boolean))]));
      form.set("variants", JSON.stringify(variantValue.trim() ? [...variants, { type: variantType, value: variantValue.trim() }] : variants));
      form.set("availability_regions", JSON.stringify(availabilityRegions));
      form.set("delivery_regions", JSON.stringify(deliveryRegions.map((region_name) => ({ region_name }))));
      form.set("retained_image_ids", JSON.stringify(existingImages.map((image) => image.id)));
      const optimized = await Promise.all(newImages.map((item) => optimizeUploadFile(item.file)));
      optimized.forEach((file) => form.append("images", file, file.name));
      const response = await fetch(`/api/provider/products/${productId}/change-requests`, { method: "POST", headers: { "Idempotency-Key": `web-product-change-${crypto.randomUUID()}` }, body: form });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "تعذر إرسال طلب التعديل.");
      router.push("/merchant/products?change_requested=1"); router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إرسال طلب التعديل.");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="provider-skeleton"><i/><i/><i/></div>;
  if (error && !product) return <section className="provider-empty"><h2>تعذر فتح طلب التعديل</h2><p>{error}</p><Link className="provider-secondary" href="/merchant/products">العودة للمنتجات</Link></section>;
  if (!product) return null;
  const delivery = product.product_delivery_configs;

  return <section className="provider-page-stack">
    <header className="provider-page-header"><div><p>مراجعة بيانات المنتج</p><h2>طلب تعديل «{product.name}»</h2><span>لن تتغير النسخة المنشورة حتى تعتمد الإدارة الطلب. ستظهر لها كل قيمة قبل التعديل وبعده.</span></div><Link className="provider-secondary" href="/merchant/products">العودة للمنتجات</Link></header>
    {pendingRequest ? <div className="provider-toast" role="status">يوجد طلب تعديل لهذا المنتج بانتظار قرار الإدارة. لا يمكن إرسال طلب ثانٍ الآن.</div> : null}
    <form className="provider-product-form" onSubmit={submit}>
      <fieldset className="provider-form-section"><legend><span>1</span> البيانات الأساسية</legend><div className="provider-form-grid">
        <label className="provider-field"><span>اسم المنتج *</span><input name="name" required minLength={2} maxLength={160} defaultValue={product.name}/></label>
        <label className="provider-field"><span>التصنيف *</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}<option value="other">أخرى</option></select></label>
        {categoryId === "other" ? <label className="provider-field"><span>التصنيف الآخر *</span><input name="custom_category" required defaultValue={product.custom_category || ""}/></label> : null}
        <label className="provider-field"><span>رمز SKU</span><input name="sku" dir="ltr" defaultValue={product.sku || ""}/></label>
        <label className="provider-field"><span>وحدة البيع *</span><input name="base_unit" required defaultValue={product.base_unit}/></label>
        <label className="provider-field wide"><span>وصف المنتج *</span><textarea name="description" required minLength={10} rows={4} defaultValue={product.full_description || product.description}/></label>
      </div></fieldset>

      <fieldset className="provider-form-section"><legend><span>2</span> صور المنتج</legend><div className={styles.changeImageGrid}>
        {existingImages.map((image)=><article key={image.id}>{image.signed_url?<Image src={image.signed_url} alt={image.alt_text || product.name} width={320} height={220} unoptimized/>:<div>صورة محفوظة</div>}<button type="button" onClick={()=>setExistingImages((items)=>items.filter((item)=>item.id!==image.id))}>إزالة من الطلب</button></article>)}
        {newImages.map((image,index)=><article key={image.preview}><Image src={image.preview} alt={image.file.name} width={320} height={220} unoptimized/><button type="button" onClick={()=>{URL.revokeObjectURL(image.preview);setNewImages((items)=>items.filter((_,itemIndex)=>itemIndex!==index));}}>إزالة</button></article>)}
      </div><label className="provider-image-drop"><strong>إضافة صور جديدة</strong><small>يمكنك الإبقاء على الصور الحالية أو حذفها وإضافة بدائل. الحد الأقصى 6 صور.</small><input className="provider-image-input" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={selectImages}/></label></fieldset>

      <fieldset className="provider-form-section"><legend><span>3</span> المقاسات والخيارات والمواصفات</legend>
        <RepeatEditor label="قياس أو أبعاد" value={measurementDraft} onValue={setMeasurementDraft} onAdd={()=>{const value=measurementDraft.trim();if(value&&!measurements.includes(value)){setMeasurements((items)=>[...items,value]);setMeasurementDraft("");}}} items={measurements.map((value)=>({label:value,onRemove:()=>setMeasurements((items)=>items.filter((item)=>item!==value))}))}/>
        <div className={styles.repeatBuilder}><div className={styles.repeatInputs}><label className="provider-field"><span>نوع الخيار</span><small>لعدة علامات أو مصانع، أضف كل قيمة متاحة كخيار مستقل من النوع نفسه.</small><select value={variantType} onChange={(event)=>setVariantType(event.target.value)}>{["المقاس","الضغط","الكثافة","السماكة","الدرجة","اللون","الموديل","العلامة التجارية","المصنّع","أخرى"].map((value)=><option key={value}>{value}</option>)}</select></label><label className="provider-field"><span>قيمة الخيار</span><input value={variantValue} onChange={(event)=>setVariantValue(event.target.value)}/></label><button className="provider-secondary" type="button" onClick={()=>{const value=variantValue.trim();if(value&&!variants.some((item)=>item.type===variantType&&item.value===value)){setVariants((items)=>[...items,{type:variantType,value}]);setVariantValue("");}}}>إضافة الخيار</button></div><div className={styles.repeatList}>{variants.map((item,index)=><button type="button" key={`${item.type}-${item.value}-${index}`} onClick={()=>setVariants((items)=>items.filter((_,itemIndex)=>itemIndex!==index))}>{item.type}: {item.value} ×</button>)}</div></div>
        <div className="provider-form-grid">{specificationFields.map(([label,name])=><label className="provider-field" key={name}><span>{label}</span><input name={name} defaultValue={specificationValue(product,label)}/></label>)}<label className="provider-field"><span>مدة الضمان</span><input name="warranty_duration" defaultValue={product.product_warranties?.duration || ""}/></label><label className="provider-field"><span>تفاصيل الضمان</span><input name="warranty_details" defaultValue={product.product_warranties?.details || ""}/></label></div>
      </fieldset>

      <fieldset className="provider-form-section"><legend><span>4</span> السعر والمخزون</legend><div className="provider-form-grid compact">
        <label className="provider-field"><span>نوع العرض *</span><select value={offerType} onChange={(event)=>setOfferType(event.target.value)}><option value="sale">بيع</option><option value="rental">تأجير</option></select></label>
        <label className="provider-field"><span>سعر الوحدة *</span><input name="unit_price" type="number" min="0" step="0.01" required defaultValue={product.unit_price ?? ""}/></label>
        <label className="provider-field"><span>الحد الأدنى</span><input name="minimum_order" type="number" min="0.001" step="0.001" defaultValue={product.minimum_order ?? ""}/></label>
        <label className="provider-check"><input type="checkbox" checked={vatInclusive} onChange={(event)=>setVatInclusive(event.target.checked)}/> السعر شامل الضريبة</label>
        {offerType==="rental"?<><label className="provider-field"><span>مدة التأجير *</span><input name="rental_duration_value" type="number" min="0.01" step="0.01" required defaultValue={product.rental_duration_value ?? ""}/></label><label className="provider-field"><span>وحدة المدة *</span><input name="rental_duration_unit" required defaultValue={product.rental_duration_unit || ""}/></label></>:null}
      </div></fieldset>

      <fieldset className="provider-form-section"><legend><span>5</span> التوفر والتوصيل</legend><div className="provider-form-grid">
        <label className="provider-field"><span>حالة التوفر *</span><select value={availability} onChange={(event)=>setAvailability(event.target.value)}><option value="available">متوفر</option><option value="limited">كمية محدودة</option><option value="on_request">حسب الطلب</option><option value="unavailable">غير متوفر</option></select></label>
        <label className="provider-field"><span>كمية المخزون</span><input name="stock_quantity" type="number" min="0" step="0.001" defaultValue={product.stock_quantity ?? ""}/></label>
        <label className="provider-field"><span>مدة التجهيز *</span><input name="lead_time_label" required defaultValue={product.lead_time_label}/></label>
        <label className="provider-field"><span>نافذة التوصيل *</span><input name="delivery_window" required defaultValue={product.delivery_window}/></label>
        <label className="provider-field wide"><span>تعليمات التوصيل *</span><textarea name="delivery_notes" rows={3} required defaultValue={product.delivery_notes}/></label>
      </div>
      <RepeatEditor label="مدينة توفر المنتج" value={availabilityCity} onValue={setAvailabilityCity} onAdd={()=>{const city=availabilityCity.trim();if(city&&!availabilityRegions.some((item)=>item.city===city)){setAvailabilityRegions((items)=>[...items,{city,scope:"المدينة"}]);setAvailabilityCity("");}}} items={availabilityRegions.map((item)=>({label:item.city,onRemove:()=>setAvailabilityRegions((items)=>items.filter((value)=>value.city!==item.city))}))}/>
      <RepeatEditor label="منطقة توصيل" value={deliveryRegion} onValue={setDeliveryRegion} onAdd={()=>{const value=deliveryRegion.trim();if(value&&!deliveryRegions.includes(value)){setDeliveryRegions((items)=>[...items,value]);setDeliveryRegion("");}}} items={deliveryRegions.map((value)=>({label:value,onRemove:()=>setDeliveryRegions((items)=>items.filter((item)=>item!==value))}))}/>
      <label className="provider-check"><input type="checkbox" checked={deliveryAvailable} onChange={(event)=>setDeliveryAvailable(event.target.checked)}/> خدمة توصيل خاصة بالمنتج متاحة</label>
      {deliveryAvailable?<div className="provider-form-grid compact"><label className="provider-field"><span>المدة القصوى *</span><input name="delivery_maximum_duration" type="number" min="0.01" step="0.01" required defaultValue={delivery?.maximum_duration ?? ""}/></label><label className="provider-field"><span>وحدة المدة *</span><input name="delivery_duration_unit" required defaultValue={delivery?.duration_unit || "ساعة"}/></label><label className="provider-field"><span>السعر لكل كم</span><input name="delivery_price_per_km" type="number" min="0" step="0.01" defaultValue={delivery?.price_per_km ?? ""}/></label><label className="provider-field"><span>أقصى مسافة كم</span><input name="delivery_maximum_distance_km" type="number" min="0.01" step="0.01" defaultValue={delivery?.maximum_distance_km ?? ""}/></label><label className="provider-field wide"><span>ملاحظات خدمة التوصيل</span><textarea name="delivery_config_notes" rows={2} defaultValue={delivery?.notes || ""}/></label></div>:null}
      </fieldset>

      <fieldset className="provider-form-section"><legend><span>6</span> سبب التعديل</legend><label className="provider-field"><span>ملاحظة للإدارة</span><textarea name="request_note" rows={3} maxLength={1000} placeholder="اشرح سبب التعديل أو أي معلومة تساعد الإدارة في المراجعة"/></label></fieldset>
      {error?<p className="provider-toast provider-toast-error" role="alert">{error}</p>:null}
      <footer className="provider-form-actions"><Link className="provider-secondary" href="/merchant/products">إلغاء</Link><button className="provider-primary" type="submit" disabled={busy||pendingRequest}>{busy?"جارٍ إرسال الطلب…":"إرسال طلب التعديل للإدارة"}</button></footer>
    </form>
  </section>;
}

function RepeatEditor({label,value,onValue,onAdd,items}:{label:string;value:string;onValue:(value:string)=>void;onAdd:()=>void;items:Array<{label:string;onRemove:()=>void}>}) {
  return <div className={styles.repeatBuilder}><div className={styles.repeatInputs}><label className="provider-field"><span>{label}</span><input value={value} onChange={(event)=>onValue(event.target.value)}/></label><button className="provider-secondary" type="button" onClick={onAdd}>إضافة</button></div>{items.length?<div className={styles.repeatList}>{items.map((item,index)=><button type="button" key={`${item.label}-${index}`} onClick={item.onRemove}>{item.label} ×</button>)}</div>:null}</div>;
}
