import type {
  DeliveryAssignment,
  FinancialTransaction,
  PlatformPolicy,
  ProviderNotification,
  ProviderOrder,
  ProviderProduct,
  ProviderProfile,
  ProviderQuote,
  QuoteRequest,
  SettlementRequest,
  SupportTicket,
} from "./provider-types";

export const providerSettings = {
  vatRate: 0.15,
  currency: "ر.س",
  settlementReviewDays: 7,
  maximumProductImages: 6,
  maximumFileSize: 5 * 1024 * 1024,
} as const;

export const providerProfileMock: ProviderProfile = {
  id: "provider-modern-materials",
  companyName: "شركة مواد البناء الحديثة",
  contactName: "عبدالله السبيعي",
  mobile: "050 248 9012",
  email: "provider@bunya.example",
  username: "modern_materials",
  mapsUrl: "https://www.google.com/maps/@24.7136,46.6753,15z",
  latitude: 24.7136,
  longitude: 46.6753,
  categories: ["الأسمنت", "الحديد", "العزل", "الأدوات والمعدات"],
  deliveryAvailable: true,
  deliveryRegions: ["الرياض", "الخرج", "المزاحمية"],
  logoLabel: "م",
  accountStatus: "approved",
  bankAccounts: [{ id: "bank-1", bankName: "البنك الأهلي السعودي", accountName: "شركة مواد البناء الحديثة", ibanMasked: "SA** **** **** 4821", isDefault: true }],
};

export const providerProductsMock: ProviderProduct[] = [
  { id: "pp-cement", name: "أسمنت مقاوم 50 كجم", category: "الأسمنت", description: "أسمنت مقاوم للرطوبة للقواعد والخزانات.", availability: "available", minimumOrder: 20, stockQuantity: 1400, images: [{ id: "pi-1", name: "cement-main.jpg", type: "image/jpeg", size: 284000, isPrimary: true, sortOrder: 0 }], units: [{ id: "unit-bag", name: "كيس", isBase: true }, { id: "unit-pallet", name: "طبليّة", isBase: false }], measurements: [{ id: "measure-50", unit: "كيلوجرام", description: "كيس 50 كجم" }], offerType: "sale", price: 17.2, currency: "SAR", vatInclusive: true, warranty: { available: true, duration: 7, unit: "day", details: "استبدال تلف النقل عند التوثيق." }, delivery: { available: true, maximumDuration: 6, durationUnit: "hour", pricePerKilometer: 4, regions: ["الرياض", "الخرج"], maximumDistanceKm: 120 }, status: "active", createdAt: "2026-06-01T08:00:00.000Z", updatedAt: "2026-07-15T09:00:00.000Z" },
  { id: "pp-rebar", name: "حديد تسليح 16 مم", category: "الحديد", description: "حديد درجة 60 مع شهادة منشأ.", availability: "limited", minimumOrder: 1, stockQuantity: 28, images: [{ id: "pi-2", name: "rebar-main.jpg", type: "image/jpeg", size: 310000, isPrimary: true, sortOrder: 0 }], units: [{ id: "unit-ton", name: "طن", isBase: true }], measurements: [{ id: "measure-16", thickness: 16, unit: "مليمتر", description: "قطر 16 مم" }], offerType: "sale", price: 2780, currency: "SAR", vatInclusive: false, warranty: { available: true, duration: 1, unit: "year", details: "مطابقة شهادة المصنع." }, delivery: { available: true, maximumDuration: 1, durationUnit: "day", pricePerKilometer: 8, regions: ["الرياض"], maximumDistanceKm: 180 }, status: "active", createdAt: "2026-06-04T08:00:00.000Z", updatedAt: "2026-07-14T12:00:00.000Z" },
  { id: "pp-xps", name: "ألواح عزل XPS 5 سم", category: "العزل", description: "ألواح عزل حراري للأسطح والجدران.", availability: "available", stockQuantity: 320, images: [{ id: "pi-3", name: "xps.jpg", type: "image/jpeg", size: 198000, isPrimary: true, sortOrder: 0 }], units: [{ id: "unit-board", name: "لوح", isBase: true }], measurements: [{ id: "measure-xps", length: 120, width: 60, thickness: 5, unit: "سنتيمتر" }], offerType: "sale", price: 34, currency: "SAR", vatInclusive: true, warranty: { available: false, noWarrantyAccepted: true }, delivery: { available: true, maximumDuration: 12, durationUnit: "hour", pricePerKilometer: 3, regions: ["الرياض", "الخرج"] }, status: "pending_review", createdAt: "2026-07-12T08:00:00.000Z", updatedAt: "2026-07-12T08:00:00.000Z" },
  { id: "pp-hammer", name: "دريل تكسير احترافي", category: "الأدوات والمعدات", description: "دريل تكسير للتأجير اليومي أو الأسبوعي.", availability: "unavailable", images: [], units: [{ id: "unit-piece", name: "حبة", isBase: true }], measurements: [], offerType: "rental", rentalDuration: { value: 1, unit: "day" }, price: 120, currency: "SAR", vatInclusive: false, warranty: { available: false, noWarrantyAccepted: true }, delivery: { available: false, regions: [] }, status: "unavailable", createdAt: "2026-06-20T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
];

export const providerQuoteRequestsMock: QuoteRequest[] = [
  { id: "qr-24018", requestCode: "RFQ-24018", productId: "pp-cement", productName: "أسمنت مقاوم 50 كجم", productImageLabel: "أسمنت", category: "الأسمنت", quantity: 420, unit: "كيس", measurement: "50 كجم", deliveryRegion: "شمال الرياض", mapsUrl: "https://www.google.com/maps/@24.8467,46.6891,15z", desiredReceiptAt: "2026-07-17T14:30:00.000Z", receivedAt: "2026-07-16T07:15:00.000Z", deadlineAt: "2026-07-16T11:15:00.000Z", customerLabel: "مشروع سكني — شمال الرياض", customerNotes: "التنزيل عند البوابة الشرقية، المدخل مناسب للرافعة.", specifications: ["مقاوم للرطوبة", "تعبئة 50 كجم", "توريد على طبالي"], status: "new" },
  { id: "qr-24022", requestCode: "RFQ-24022", productId: "pp-rebar", productName: "حديد تسليح 16 مم", productImageLabel: "حديد", category: "الحديد", quantity: 9, unit: "طن", measurement: "قطر 16 مم", deliveryRegion: "شرق جدة", mapsUrl: "https://maps.app.goo.gl/mock", desiredReceiptAt: "2026-07-18T10:00:00.000Z", receivedAt: "2026-07-15T13:20:00.000Z", deadlineAt: "2026-07-17T01:20:00.000Z", customerLabel: "مشروع تجاري — جدة", specifications: ["درجة 60", "شهادة منشأ"], status: "viewed" },
  { id: "qr-24031", requestCode: "RFQ-24031", productId: "pp-xps", productName: "ألواح عزل XPS 5 سم", productImageLabel: "عزل", category: "العزل", quantity: 160, unit: "لوح", measurement: "60 × 120 × 5 سم", deliveryRegion: "الخرج", mapsUrl: "https://www.google.com/maps?q=24.1556,47.3120", desiredReceiptAt: "2026-07-19T08:00:00.000Z", receivedAt: "2026-07-15T09:40:00.000Z", deadlineAt: "2026-07-16T09:40:00.000Z", customerLabel: "مقاول معتمد — الخرج", specifications: ["كثافة عالية", "حواف منتظمة"], status: "quoted" },
];

export const providerQuotesMock: ProviderQuote[] = [
  { id: "pq-801", quoteCode: "BQ-00801", requestId: "qr-24031", requestCode: "RFQ-24031", productId: "pp-xps", productName: "ألواح عزل XPS 5 سم", unitPrice: 34, quantity: 160, subtotal: 5440, vatInclusive: true, vatAmount: 0, deliveryFee: 280, total: 5720, deliveryDuration: "12 ساعة", validUntil: "2026-07-18", providerNotes: "يشمل التغليف والتحميل.", terms: "الدفع قبل التجهيز والتسليم في الموعد المحدد.", attachments: [], status: "pending_customer", sentAt: "2026-07-15T10:10:00.000Z", updatedAt: "2026-07-15T10:10:00.000Z" },
  { id: "pq-790", quoteCode: "BQ-00790", requestId: "qr-legacy-1", requestCode: "RFQ-23998", productId: "pp-cement", productName: "أسمنت مقاوم 50 كجم", unitPrice: 17.2, quantity: 300, subtotal: 5160, vatInclusive: true, vatAmount: 0, deliveryFee: 240, total: 5400, deliveryDuration: "6 ساعات", validUntil: "2026-07-20", terms: "التوريد بعد تأكيد السداد.", attachments: [], status: "approved", sentAt: "2026-07-14T08:30:00.000Z", updatedAt: "2026-07-14T12:20:00.000Z" },
  { id: "pq-765", quoteCode: "BQ-00765", requestId: "qr-legacy-2", requestCode: "RFQ-23975", productId: "pp-rebar", productName: "حديد تسليح 16 مم", unitPrice: 2810, quantity: 4, subtotal: 11240, vatInclusive: false, vatAmount: 1686, deliveryFee: 450, total: 13376, deliveryDuration: "يوم عمل", validUntil: "2026-07-14", terms: "السعر حسب توفر المخزون.", attachments: [], status: "rejected", rejectionReason: "مدة التوصيل أطول من متطلبات المشروع.", sentAt: "2026-07-12T09:00:00.000Z", updatedAt: "2026-07-13T10:00:00.000Z" },
];

export const providerOrdersMock: ProviderOrder[] = [
  { id: "po-901", orderCode: "BO-00901", quoteId: "pq-790", customerLabel: "عميل موثّق", projectLabel: "فيلا الياسمين", productName: "أسمنت مقاوم 50 كجم", productImageLabel: "أسمنت", quantity: 300, unit: "كيس", total: 5400, paymentStatus: "paid", status: "out_for_delivery", deliveryStatus: "خرج للتوصيل", driverName: "محمد القحطاني", deliveryRegion: "شمال الرياض", mapsUrl: "https://www.google.com/maps/@24.8281,46.6410,15z", deliveryCodeVerified: false, createdAt: "2026-07-14T12:20:00.000Z", history: [{ id: "h1", status: "confirmed", label: "تم تأكيد الطلب", at: "2026-07-14T12:20:00.000Z" }, { id: "h2", status: "preparing", label: "بدأ التجهيز", at: "2026-07-14T13:00:00.000Z" }, { id: "h3", status: "ready_for_pickup", label: "جاهز للاستلام", at: "2026-07-15T07:00:00.000Z" }, { id: "h4", status: "assigned_driver", label: "تم إسناده للسائق", at: "2026-07-15T07:30:00.000Z" }, { id: "h5", status: "out_for_delivery", label: "خرج للتوصيل", at: "2026-07-15T08:00:00.000Z" }] },
  { id: "po-902", orderCode: "BO-00902", quoteId: "pq-782", customerLabel: "مقاول معتمد", projectLabel: "مستودع السلي", productName: "حديد تسليح 16 مم", productImageLabel: "حديد", quantity: 6, unit: "طن", total: 19450, paymentStatus: "paid", status: "preparing", deliveryStatus: "بانتظار التجهيز", deliveryRegion: "شرق الرياض", mapsUrl: "https://www.google.com/maps?q=24.665,46.82", deliveryCodeVerified: false, createdAt: "2026-07-15T11:00:00.000Z", history: [{ id: "h6", status: "confirmed", label: "تم تأكيد الطلب", at: "2026-07-15T11:00:00.000Z" }, { id: "h7", status: "preparing", label: "بدأ التجهيز", at: "2026-07-15T12:00:00.000Z" }] },
];

export const providerDeliveriesMock: DeliveryAssignment[] = [
  { id: "delivery-901", deliveryCode: "DEL-00901", orderId: "po-901", orderCode: "BO-00901", driverName: "محمد القحطاني", driverPhone: "055 182 4401", status: "out_for_delivery", assignedAt: "2026-07-15T07:30:00.000Z", customerConfirmed: false, verification: { proof: "c0175176aa62ab5255ea61b581b22d5bad651e77a2bd46c983b6ed0af278bb8d", attempts: 0, maxAttempts: 5 } },
];

export const financialTransactionsMock: FinancialTransaction[] = [
  { id: "ft-1", transactionCode: "TX-1081", date: "2026-07-15", type: "order_amount", reference: "BO-00901", amount: 5400, status: "available", balanceAfter: 5400 },
  { id: "ft-2", transactionCode: "TX-1082", date: "2026-07-15", type: "commission", reference: "BO-00901", amount: -270, status: "completed", balanceAfter: 5130 },
  { id: "ft-3", transactionCode: "TX-1083", date: "2026-07-15", type: "tax", reference: "BO-00901", amount: -669.13, status: "completed", balanceAfter: 4460.87 },
  { id: "ft-4", transactionCode: "TX-1060", date: "2026-07-08", type: "settlement", reference: "ST-0042", amount: -2800, status: "completed", balanceAfter: 1660.87 },
];

export const settlementsMock: SettlementRequest[] = [
  { id: "st-42", settlementCode: "ST-0042", amount: 2800, bankAccountId: "bank-1", bankLabel: "الأهلي — SA**4821", status: "transferred", adminNotes: "تم التحويل بنجاح.", createdAt: "2026-07-07T09:00:00.000Z" },
  { id: "st-48", settlementCode: "ST-0048", amount: 1500, bankAccountId: "bank-1", bankLabel: "الأهلي — SA**4821", status: "pending_review", createdAt: "2026-07-15T10:00:00.000Z" },
];

export const notificationsMock: ProviderNotification[] = [
  { id: "n1", type: "quote_request", title: "طلب تحقق وتسعير جديد", message: "وصل طلب بُنية الداخلي ISR-24018 ويحتاج ردًا خلال ساعات.", link: "/merchant/quote-requests/qr-24018", read: false, createdAt: "2026-07-16T07:15:00.000Z" },
  { id: "n2", type: "quote_decision", title: "تم الفوز داخليًا بطلب", message: "اختارت بُنية استجابتك وأُسند أمر توريد مؤكد.", link: "/merchant/orders/po-901", read: false, createdAt: "2026-07-14T12:20:00.000Z" },
  { id: "n3", type: "product", title: "منتج قيد المراجعة", message: "ألواح عزل XPS أرسلت إلى فريق المراجعة.", link: "/merchant/products", read: true, createdAt: "2026-07-12T08:00:00.000Z" },
  { id: "n4", type: "settlement", title: "طلب تصفية قيد المراجعة", message: "تتم مراجعة الطلب ST-0048.", link: "/merchant/finance", read: false, createdAt: "2026-07-15T10:05:00.000Z" },
];

export const platformPolicies: PlatformPolicy[] = [
  { id: "product", title: "سياسة عرض المنتجات", summary: "معايير دقة بيانات المنتجات ومراجعتها.", content: ["يلتزم المزود بدقة الاسم والوصف والتصنيف.", "لا ينشر المنتج قبل اكتمال المراجعة.", "يجب توضيح السعر والضريبة والتوفر بوضوح."], updatedAt: "2026-07-01" },
  { id: "warranty", title: "سياسة الضمان", summary: "توضيح وجود الضمان أو الإقرار بعدمه.", content: ["تسجل مدة الضمان ووحدته وتفاصيل التغطية.", "عند عدم وجود ضمان يلزم الإقرار قبل إرسال المنتج للمراجعة."], updatedAt: "2026-07-01" },
  { id: "delivery", title: "سياسة التوصيل", summary: "مدد وأسعار ومناطق التوصيل.", content: ["يعرض المزود مدة واقعية وسعرًا واضحًا لكل كيلومتر.", "تحدد مناطق التوصيل والحد الأقصى للمسافة عند توفره."], updatedAt: "2026-07-01" },
  { id: "settlement", title: "سياسة التصفية", summary: "مراجعة طلبات التصفية خلال 7 أيام عمل.", content: ["تتاح للتصفية المبالغ المكتملة وغير المتنازع عليها.", "تراجع بيانات الحساب البنكي قبل التحويل.", "قد تطلب الإدارة مستندات إضافية."], updatedAt: "2026-07-01" },
];

export const supportTicketsMock: SupportTicket[] = [
  { id: "ticket-12", ticketCode: "SUP-0012", subject: "تحديث بيانات الحساب البنكي", category: "الحساب والمالية", priority: "normal", message: "نرغب بتحديث الحساب الافتراضي.", attachments: [], status: "in_progress", createdAt: "2026-07-13T09:00:00.000Z" },
];

export const providerFaq = [
  ["متى يظهر المنتج؟", "بعد إرساله للمراجعة واعتماده وفق سياسة عرض المنتجات."],
  ["كيف أعدل استجابة التسعير؟", "يمكن تحديث السعر والتوفر قبل انتهاء مهلة طلب بُنية الداخلي."],
  ["متى تتاح الأموال للتصفية؟", "بعد اكتمال الطلب وتأكيد التسليم وتسوية الرسوم."],
] as const;
