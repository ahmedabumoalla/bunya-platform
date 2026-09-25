export type AdminRow = Record<string, unknown>;
export type RecordField = { key: string; label: string; kind?: "money" | "date" | "status" | "text" | "percent" | "boolean"; empty?: string };
export type RecordPage = {
  title: string; description: string; table: string; select: string; columns: RecordField[];
  details?: RecordField[]; status?: string; order?: string; empty: string;
};
const f = (key: string, label: string, kind?: RecordField["kind"], empty?: string): RecordField => ({ key, label, kind, empty });
const created = f("created_at", "تاريخ الإنشاء", "date");
const updated = f("updated_at", "آخر تحديث", "date");
const state = f("status", "الحالة", "status");
const customer = f("customer.full_name", "العميل");
const contractor = f("contractor.display_name", "المقاول");
const total = f("total", "الإجمالي", "money");
const payments = f("payment_status", "الدفع", "status");
const priceDetails = [f("subtotal", "المجموع قبل الضريبة", "money"), f("vat_amount", "ضريبة القيمة المضافة", "money"), f("delivery_fee", "رسوم التوصيل", "money")];
const notes = [f("notes", "ملاحظات"), updated];
const profileJoin = "customer:profiles!customer_profile_id(full_name,email,mobile)";
const contractorJoin = "contractor:contractor_profiles!contractor_profile_id(display_name,commercial_name,phone,email)";
const requestJoin = "request:quote_requests!customer_request_id(request_code,city,requester:profiles!requester_id(full_name,mobile))";
const deliverySelect = "*,order:orders!order_id(order_code,customer:profiles!customer_profile_id(full_name,mobile)),provider:providers!provider_id(company_name),driver:provider_drivers!assigned_driver_id(full_name,mobile)";
const deliveryColumns = [f("order.order_code", "رقم الطلب"), f("order.customer.full_name", "العميل"), f("provider.company_name", "المزود"), f("driver.full_name", "السائق", "text", "لم يُعيّن سائق"), state, f("expected_at", "موعد التوصيل", "date")];

export const adminRecordPages: Record<string, RecordPage> = {
  "/admin/pricing": { title: "الأسعار والتوفر", description: "أسعار المنتجات لدى المزودين وآخر مواعيد تأكيدها.", table: "provider_product_prices", select: "*,provider:providers!provider_id(company_name),product:products!product_id(name,sku)", columns: [f("product.name", "المنتج"), f("provider.company_name", "المزود"), f("unit_price", "سعر الوحدة", "money"), f("vat_inclusive", "شامل الضريبة", "boolean"), f("freshness_status", "صلاحية السعر", "status"), f("expires_at", "صالح حتى", "date")], details: [f("product.sku", "رمز المنتج"), f("last_confirmed_at", "آخر تأكيد", "date"), updated], status: "freshness_status", empty: "لا توجد أسعار مسجلة من المزودين حتى الآن." },
  "/admin/sourcing": { title: "محرك التوريد", description: "تابع تجهيز طلب العميل، ومقارنة الأسعار، ومرحلة إصدار العرض.", table: "internal_sourcing_requests", select: `*,${requestJoin}`, columns: [f("internal_code", "رقم عملية التوريد"), f("request.requester.full_name", "العميل"), f("request.request_code", "طلب المنتجات"), f("stage", "مرحلة التجهيز", "status"), f("response_deadline_at", "مهلة رد المزودين", "date"), f("expected_ready_at", "جاهزية العرض المتوقعة", "date")], details: [f("request.city", "المدينة"), created, f("completed_at", "اكتمال المعالجة", "date"), updated], status: "stage", empty: "تظهر عمليات التوريد بعد إرسال العميل طلب منتجات." },
  "/admin/bunya-quotes": { title: "عروض بُنية", description: "عروض الأسعار المقدمة للعملاء، وقيمتها وصلاحيتها وقرار العميل.", table: "bunya_customer_quotes", select: `*,${requestJoin}`, columns: [f("quote_code", "رقم العرض"), f("request.requester.full_name", "العميل"), total, state, f("valid_until", "صالح حتى", "date"), created], details: [f("request.request_code", "طلب المنتجات"), ...priceDetails, f("processing_stage", "مرحلة التجهيز", "status"), f("expected_delivery_at", "التوصيل المتوقع", "date"), f("customer_decided_at", "تاريخ قرار العميل", "date"), f("terms", "شروط العرض"), ...notes], status: "status", empty: "لا توجد عروض أسعار صادرة بعد. تبدأ العملية من محرك التوريد." },
  "/admin/quote-requests": { title: "طلبات المنتجات", description: "طلبات العملاء ومدينة الاستلام ومهلة تقديم الأسعار وحالة المعالجة.", table: "quote_requests", select: "*,customer:profiles!requester_id(full_name,email,mobile)", columns: [f("request_code", "رقم الطلب"), customer, f("city", "المدينة"), state, payments, f("quote_deadline", "مهلة الأسعار", "date"), created], details: [f("requester_role", "نوع الحساب", "status"), f("customer.mobile", "جوال العميل"), f("location_hint", "موقع الاستلام"), f("desired_receipt_at", "الاستلام المطلوب", "date"), ...notes], status: "status", empty: "لم تُرسل طلبات منتجات بعد. ستظهر هنا عند إرسالها من العملاء." },
  "/admin/orders": { title: "الطلبات", description: "طلبات الشراء المعتمدة ومتابعة الدفع والتجهيز والتسليم.", table: "orders", select: `*,${profileJoin}`, columns: [f("order_code", "رقم الطلب"), customer, total, payments, state, created], details: [f("customer.mobile", "جوال العميل"), ...priceDetails, f("discount_amount", "قيمة الخصم", "money"), f("desired_receipt_at", "الاستلام المطلوب", "date"), f("completed_at", "اكتمال الطلب", "date"), ...notes], status: "status", empty: "لا توجد طلبات شراء معتمدة حتى الآن." },
  "/admin/deliveries": { title: "التوصيل والسائقون", description: "كل شحنة مرتبطة بطلبها ومزودها والسائق المسؤول عنها.", table: "provider_delivery_assignments", select: deliverySelect, columns: deliveryColumns, details: [f("order.customer.mobile", "جوال العميل"), f("driver.mobile", "جوال السائق", "text", "لم يُعيّن سائق"), f("assigned_at", "تعيين السائق", "date"), f("pickup_at", "استلام الشحنة", "date"), f("delivered_at", "التسليم الفعلي", "date"), f("delivery_note", "ملاحظات التوصيل"), updated], status: "status", empty: "لا توجد شحنات مسندة بعد. تظهر هنا عند تجهيز الطلبات للتوصيل." },
  "/admin/delivery-monitoring": { title: "مراقبة التوصيل", description: "تابع حالة الشحنات ومواعيدها وآخر تحديث لكل عملية توصيل.", table: "provider_delivery_assignments", select: deliverySelect, columns: [...deliveryColumns, updated], details: [f("driver.mobile", "جوال السائق"), f("delivered_at", "التسليم الفعلي", "date"), f("delivery_note", "ملاحظات التوصيل")], status: "status", empty: "لا توجد شحنات للمتابعة حاليًا." },
  "/admin/delivery-codes": { title: "تأكيدات التسليم", description: "سجل عمليات التسليم المؤكدة وطريقة التأكيد والمستلم. رموز التحقق السرية لا تُعرض هنا.", table: "delivery_confirmation_records", select: "*,assignment:provider_delivery_assignments!assignment_id(order:orders!order_id(order_code),provider:providers!provider_id(company_name)),driver:provider_drivers!assigned_driver_id(full_name),actor:profiles!confirmed_by_user_id(full_name)", columns: [f("assignment.order.order_code", "رقم الطلب"), f("assignment.provider.company_name", "المزود"), f("method", "طريقة التأكيد", "status"), f("actor.full_name", "أكّد التسليم"), f("confirmed_at", "وقت التأكيد", "date")], details: [f("driver.full_name", "السائق"), f("delegate_name", "المستلم / المندوب"), f("delivery_reference", "مرجع التسليم"), f("note", "ملاحظات")], order: "confirmed_at", empty: "لم يُؤكّد تسليم أي شحنة بعد. يظهر السجل تلقائيًا بعد إتمام تأكيد الاستلام." },
  "/admin/project-requests": { title: "طلبات المشاريع", description: "مشاريع العملاء ونطاق العمل والميزانية والموعد المحدد للعروض.", table: "project_requests", select: `*,${profileJoin}`, columns: [f("title", "اسم المشروع"), customer, f("city", "المدينة"), f("estimated_budget_min", "الميزانية من", "money"), f("estimated_budget_max", "الميزانية إلى", "money"), f("proposal_deadline_at", "استقبال العروض حتى", "date")], details: [f("request_code", "رقم طلب المشروع"), f("project_type", "نوع المشروع"), f("is_open", "مفتوح للعروض", "boolean"), f("description", "وصف المشروع"), f("scope", "نطاق العمل"), f("expected_start_at", "البداية المتوقعة", "date"), f("estimated_duration", "المدة المتوقعة"), f("terms", "الشروط"), created], empty: "لا توجد طلبات مشاريع مقدمة من العملاء بعد." },
  "/admin/contractor-opportunities": { title: "فرص المشاريع", description: "الفرص الموجهة للمقاولين والمشروع المرتبط بكل فرصة ومرحلة استجابتها.", table: "contractor_opportunities", select: `*,${contractorJoin},project:project_requests!project_request_id(title,request_code,city,estimated_budget_min,estimated_budget_max,scope)`, columns: [f("project.title", "المشروع"), contractor, f("project.city", "المدينة"), state, f("expires_at", "تنتهي الفرصة", "date"), created], details: [f("project.request_code", "رقم طلب المشروع"), f("project.estimated_budget_min", "الميزانية من", "money"), f("project.estimated_budget_max", "الميزانية إلى", "money"), f("project.scope", "نطاق المشروع"), f("viewed_at", "اطّلع عليها المقاول", "date")], status: "status", empty: "لا توجد فرص موجهة للمقاولين حتى الآن." },
  "/admin/contractor-proposals": { title: "عروض المقاولين", description: "قارن اسم المقاول والمشروع وقيمة العرض وحالة مراجعته.", table: "contractor_proposals", select: `*,${contractorJoin},opportunity:contractor_opportunities!opportunity_id(project:project_requests!project_request_id(title,city))`, columns: [f("proposal_code", "رقم العرض"), contractor, f("opportunity.project.title", "المشروع"), f("amount", "قيمة العرض", "money"), state, created], details: [f("vat_inclusive", "شامل الضريبة", "boolean"), f("execution_duration", "مدة التنفيذ"), f("proposed_start_at", "البداية المقترحة", "date"), f("valid_until", "صلاحية العرض", "date"), f("scope_details", "نطاق التنفيذ"), f("includes", "يشمل العرض"), f("excludes", "لا يشمل العرض"), f("warranty", "الضمان"), f("rejection_reason", "سبب الرفض"), f("change_request", "التعديلات المطلوبة"), ...notes], status: "status", empty: "لم يقدم المقاولون عروضًا على المشاريع بعد." },
  "/admin/contractor-projects": { title: "مشاريع المقاولات", description: "المشاريع المعتمدة، والمقاول المسؤول، وقيمة التعاقد ونسبة الإنجاز.", table: "contractor_projects", select: `*,${contractorJoin},${profileJoin}`, columns: [f("name", "المشروع"), contractor, customer, f("project_value", "قيمة المشروع", "money"), f("progress", "الإنجاز", "percent"), state], details: [f("project_code", "رقم المشروع"), payments, f("start_at", "بداية المشروع", "date"), f("expected_end_at", "النهاية المتوقعة", "date"), f("scope", "نطاق العمل"), f("next_payment_label", "الدفعة القادمة"), ...notes], status: "status", empty: "لا توجد مشاريع متعاقد عليها بعد. تظهر المشاريع بعد قبول عروض المقاولين." },
  "/admin/invoices": { title: "الفواتير", description: "فواتير الطلبات باسم العميل مع تفاصيل المبالغ والضريبة وحالة السداد.", table: "invoices", select: `*,${profileJoin},order:orders!order_id(order_code)`, columns: [f("invoice_code", "رقم الفاتورة"), customer, f("order.order_code", "رقم الطلب"), total, state, f("issued_at", "تاريخ الإصدار", "date")], details: [...priceDetails, f("paid_at", "تاريخ السداد", "date"), updated], status: "status", empty: "لم تُصدر فواتير بعد. ترتبط كل فاتورة بطلب الشراء الخاص بها." },
  "/admin/settings": { title: "إعدادات المنصة", description: "الإعدادات التشغيلية المحفوظة وآخر تعديل عليها. السياسات والصلاحيات لها أقسام مستقلة.", table: "platform_settings", select: "setting_key,section,value_type,sensitivity,change_reason,updated_at", columns: [f("section", "القسم"), f("setting_key", "اسم الإعداد"), f("value_type", "نوع القيمة", "status"), f("sensitivity", "مستوى الوصول", "status"), f("change_reason", "سبب التعديل"), updated], order: "updated_at", empty: "لا توجد إعدادات تشغيلية مخصصة محفوظة حاليًا. يمكنك إدارة السياسات أو حسابات المدراء من الروابط أعلاه." },
};

export function recordValue(row: AdminRow, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" && !Array.isArray(value) ? (value as AdminRow)[key] : undefined, row);
}

export const stateLabels: Record<string, string> = {
  pending: "بانتظار المعالجة", unpaid: "غير مدفوع", paid: "مدفوع", partially_paid: "مدفوع جزئيًا", refunded: "مسترد", partially_refunded: "مسترد جزئيًا", failed: "فشل", processing: "قيد المعالجة",
  draft: "مسودة", submitted: "مُرسل", sourcing: "جارٍ التوريد", verifying: "جارٍ التحقق", quote_ready: "العرض جاهز", customer_review: "بانتظار العميل", accepted: "مقبول", rejected: "مرفوض", expired: "منتهي", cancelled: "ملغي",
  received: "تم استلام الطلب", comparing_prices: "مقارنة الأسعار", verifying_availability: "التحقق من التوفر", verifying_delivery: "التحقق من التوصيل", building_quote: "تجهيز العرض", sent_to_customer: "أُرسل للعميل",
  preparing: "قيد التجهيز", ready: "جاهز", confirmed: "مؤكد", ready_for_pickup: "جاهز للاستلام", assigned_driver: "تم تعيين السائق", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", completed: "مكتمل",
  assigned: "مسند للمزود", picked_up: "استلم السائق الشحنة", in_transit: "في الطريق", arrived: "وصل للموقع", failed_delivery: "تعذر التسليم",
  new: "جديدة", viewed: "تم الاطلاع", proposed: "تم تقديم عرض", under_review: "قيد المراجعة", needs_changes: "مطلوب تعديل", withdrawn: "مسحوب", awaiting_start: "بانتظار البدء", active: "قيد التنفيذ", paused: "متوقف مؤقتًا", delayed: "متأخر", awaiting_milestone_approval: "بانتظار اعتماد المرحلة",
  valid: "ساري", stale: "يحتاج تحديثًا", invalid: "غير صالح", customer: "العميل", contractor: "المقاول", provider: "المزود", driver: "السائق", admin: "الإدارة", code: "رمز التحقق", otp: "رمز التحقق", customer_code: "رمز العميل", delegate: "مندوب الاستلام", manual: "تأكيد يدوي",
  number: "رقم", string: "نص", boolean: "نعم / لا", json: "إعداد مركب", normal: "عادي", sensitive: "مقيد", critical: "عالي الحساسية",
};

export const unreadableText = "النص المحفوظ غير مقروء ويحتاج إلى تصحيح";
export function readableText(value: unknown, fallback = "غير مسجل"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.map(item => readableText(item, "")).filter(Boolean).join("\n") || fallback;
  if (typeof value === "object") return "بيانات إضافية تحتاج إلى مراجعة";
  const text = String(value);
  if (/\?{3,}|\uFFFD/.test(text)) return unreadableText;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(text)) return "لم يتوفر الاسم المرتبط";
  return text;
}

export function formatRecordField(row: AdminRow, field: RecordField): string {
  const value = recordValue(row, field.key);
  if (value === null || value === undefined || value === "") return field.empty ?? "غير مسجل";
  if (field.kind === "status") return stateLabels[String(value)] ?? "حالة غير مصنفة";
  if (field.kind === "boolean") return value === true ? "نعم" : "لا";
  if (field.kind === "money" || field.kind === "percent") {
    const number = Number(value);
    if (!Number.isFinite(number)) return "غير مسجل";
    return field.kind === "money" ? `${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س` : `${number.toLocaleString("en-US")}٪`;
  }
  if (field.kind === "date") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "تاريخ غير صالح";
    return date.toLocaleString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", ...(String(value).includes("T") ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Riyadh" });
  }
  return readableText(value, field.empty);
}
