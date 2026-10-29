/** Versioned sales terms adapted from the owner's supplied BRKZ quotation.
 * BRKZ bank accounts, financing/security assignments and transaction-specific
 * dates/locations are deliberately not transferred to this seller.
 * Keep existing versions stable: saved quotations retain their policy version.
 */
export const PRICE_QUOTATION_POLICY_VERSION = "exclusive-address-sales-v1";
export type PriceQuotationPolicyInput = {
  policy_version?: string;
  valid_until?: string | null;
  delivery_city?: string;
  delivery_window?: string;
  delivery_fee: number;
};

export function priceQuotationPolicy(quote: PriceQuotationPolicyInput): { title: string; body: string }[] {
  if (quote.policy_version && quote.policy_version !== PRICE_QUOTATION_POLICY_VERSION) {
    throw new Error("Unsupported quotation policy version");
  }
  const expiry = quote.valid_until ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh", dateStyle: "long", timeStyle: "short",
  }).format(new Date(quote.valid_until)) : null;
  return [
    { title: "الدفع", body: "سداد كامل المبلغ مقدمًا بنسبة ١٠٠٪." },
    { title: "التسليم", body: `يتم تسليم المواد${quote.delivery_city ? ` في ${quote.delivery_city}` : " إلى الموقع المتفق عليه"}${quote.delivery_window ? ` خلال المدة التالية: ${quote.delivery_window}` : " وفق موعد التسليم المتفق عليه كتابيًا"}.` },
    { title: "صلاحية العرض", body: expiry ? `السعر ساري حتى ${expiry} بتوقيت المملكة العربية السعودية.` : "تُؤكَّد صلاحية الأسعار وتوفر المواد مع شركة العنوان الحصري قبل السداد." },
    { title: "شروط التوصيل", body: `تكون تكلفة التوصيل وفق بند التوصيل الموضح في هذا العرض، وتدخل في الإجمالي النهائي. يُعتمد موقع التسليم${quote.delivery_city ? ` في ${quote.delivery_city}` : ""} بالتنسيق مع العميل.` },
    { title: "مسؤولية الأضرار", body: "تتخذ شركة العنوان الحصري الاحتياطات اللازمة لضمان التغليف السليم والتعامل مع المواد أثناء النقل. في حال حدوث أي أضرار خلال النقل، تتعاون الشركة مع العميل ومزود النقل لتسهيل حل المطالبة والوصول إلى نتيجة مرضية." },
    { title: "الفحص عند التسليم", body: "إذا تم تسليم المواد من قبل شركة العنوان الحصري، يجب على العميل فحص المواد فور استلامها وإبلاغ الشركة فورًا بأي أضرار تتم ملاحظتها. يجب توثيق الأضرار وتصويرها كدليل لأي مطالبات محتملة." },
    { title: "حدود المسؤولية", body: "تخلي شركة العنوان الحصري مسؤوليتها عن الأضرار غير المباشرة أو التبعية أو العرضية الناتجة عن أضرار المواد أو التأخير قبل أو بعد أو أثناء تسليم المواد المتفق عليها، في الحدود التي تسمح بها الأنظمة المعمول بها." },
    { title: "تغييرات الكميات والمواصفات", body: "السعر المقدم قابل للتعديل بناءً على أي تغييرات في الكميات أو المواصفات." },
    { title: "وفرة المخزون", body: "تتوفر المواد بحسب الكميات المتاحة في المخزون." },
    { title: "الجودة والضمان", body: "يرجى الرجوع إلى ضمان الشركة المصنعة للحصول على تفاصيل ضمان المنتجات المحددة." },
    { title: "القوة القاهرة", body: "قد تتأثر أوقات التسليم بأحداث غير متوقعة خارجة عن الإرادة. في حال القوة القاهرة، تبذل شركة العنوان الحصري جهودًا معقولة لتقليل التأخير." },
    { title: "القانون المنظم", body: "تخضع أي نزاعات تنشأ عن هذا العرض لأنظمة المملكة العربية السعودية." },
    { title: "الاتفاق الكامل", body: "بقبولك هذا العرض، تؤكد قبولك لهذه الشروط والأحكام والتفاصيل الموضحة فيه." },
  ];
}
