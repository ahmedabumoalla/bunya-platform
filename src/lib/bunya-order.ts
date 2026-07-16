import type {
  AdminMetric,
  DriverDelivery,
  FinalOffer,
  MerchantQuote,
  OrderTimelineEvent,
  QuoteRequest,
} from "./bunya-types";

export type QuoteWindowResult = {
  label: string;
  duration: string;
  description: string;
  isFastWindow: boolean;
};

export function getQuoteWindow(hour: number): QuoteWindowResult {
  const isMorningWindow = hour >= 6 && hour < 12;
  const isEveningWindow = hour >= 16 && hour < 18;

  if (isMorningWindow || isEveningWindow) {
    return {
      label: "داخل نافذة تجميع سريعة",
      duration: "ساعتان",
      description:
        "الطلب داخل فترة 6 صباحا إلى 12 ظهرا أو 4 عصرا إلى 6 مساء، لذلك تجمع بُنية عروض التجار خلال ساعتين.",
      isFastWindow: true,
    };
  }

  return {
    label: "خارج نافذة التجميع السريعة",
    duration: "12 ساعة",
    description:
      "الطلب خارج نوافذ التجميع السريعة، لذلك يصل إشعار للتاجر ويكون لديه 12 ساعة للرد.",
    isFastWindow: false,
  };
}

export const defaultMockQuoteWindow = getQuoteWindow(10);

export const quoteRequests: QuoteRequest[] = [
  {
    id: "BUN-24018",
    requesterRole: "customer",
    productId: "cement-src-50",
    productName: "أسمنت مقاوم 50 كجم",
    quantity: 420,
    unit: "كيس",
    city: "الرياض",
    locationHint: "حي النرجس، شمال الرياض",
    coordinates: "24.8467, 46.6891",
    quoteWindow: "داخل نافذة 6 صباحا إلى 12 ظهرا",
    quoteDeadline: "ساعتان",
    paymentStatus: "مدفوع",
    deliveryPromise: "اليوم قبل 5:30 مساء",
    handshakeCode: "483921",
    status: "out_for_delivery",
    createdAt: "اليوم 10:15 صباحا",
  },
  {
    id: "BUN-24022",
    requesterRole: "contractor",
    productId: "rebar-16",
    productName: "حديد تسليح 16 مم",
    quantity: 9,
    unit: "طن",
    city: "جدة",
    locationHint: "نطاق شرق جدة",
    coordinates: "21.5433, 39.1728",
    quoteWindow: "خارج نافذة التجميع السريعة",
    quoteDeadline: "12 ساعة",
    paymentStatus: "بانتظار السداد",
    deliveryPromise: "غدا قبل 2:00 مساء",
    handshakeCode: "790144",
    status: "final_offer_ready",
    createdAt: "أمس 4:20 مساء",
  },
  {
    id: "BUN-23990",
    requesterRole: "customer",
    productId: "washed-sand",
    productName: "رمل مغسول",
    quantity: 18,
    unit: "متر مكعب",
    city: "الرياض",
    locationHint: "حي الياسمين",
    coordinates: "24.8281, 46.6410",
    quoteWindow: "داخل نافذة 4 إلى 6 مساء",
    quoteDeadline: "ساعتان",
    paymentStatus: "مدفوع",
    deliveryPromise: "تم التسليم",
    handshakeCode: "112845",
    status: "delivered",
    createdAt: "الأسبوع الماضي",
  },
];

export const sampleRequest = quoteRequests[0];

export const merchantQuotes: MerchantQuote[] = [
  {
    id: "MQ-01",
    requestId: "BUN-24018",
    merchantName: "متجر عمران الخليج",
    maskedMerchant: "تاجر مؤهل 01",
    price: 7420,
    deliveryDuration: "6 ساعات",
    notes: "توريد مباشر من المستودع الشمالي",
    eligible: true,
    receivedAt: "10:42 صباحا",
    status: "qualified",
    statusLabel: "مؤهل، أعلى من الأرخص",
  },
  {
    id: "MQ-02",
    requestId: "BUN-24018",
    merchantName: "شركة مواد البناء الحديثة",
    maskedMerchant: "تاجر مؤهل 02",
    price: 7224,
    deliveryDuration: "5 ساعات",
    notes: "يشمل التحميل والتوصيل",
    eligible: true,
    receivedAt: "10:58 صباحا",
    status: "selected",
    statusLabel: "الأرخص المؤهل",
  },
  {
    id: "MQ-03",
    requestId: "BUN-24018",
    merchantName: "مؤسسة روافد التوريد",
    maskedMerchant: "تاجر مؤهل 03",
    price: 7590,
    deliveryDuration: "4 ساعات",
    eligible: true,
    receivedAt: "11:13 صباحا",
    status: "qualified",
    statusLabel: "مؤهل، أعلى من الأرخص",
  },
  {
    id: "MQ-04",
    requestId: "BUN-24018",
    merchantName: "مخازن نجد",
    maskedMerchant: "تاجر مؤهل 04",
    price: 7160,
    deliveryDuration: "36 ساعة",
    eligible: false,
    receivedAt: "11:20 صباحا",
    status: "rejected",
    statusLabel: "غير مؤهل: مدة التوصيل لا تطابق شرط الطلب",
  },
];

export const quoteOffers = merchantQuotes;

export const finalOffer: FinalOffer = {
  id: "FO-24018",
  requestId: "BUN-24018",
  platformName: "بُنية",
  totalPrice: 7224,
  deliveryDuration: "5 ساعات",
  paymentStatus: "مدفوع",
  offerStatus: "paid",
};

export const anonymousQuoteRequests = quoteRequests.map((request) => ({
  id: request.id.replace("BUN", "RFQ"),
  requestId: request.id,
  product: request.productName,
  quantity: String(request.quantity),
  unit: request.unit,
  locationHint: request.city === "الرياض" ? "نطاق شمال الرياض" : `نطاق ${request.city}`,
  deadline: request.status === "final_offer_ready" ? "بانتظار اعتماد العميل" : `متبقي ${request.quoteDeadline}`,
  window: request.quoteWindow,
}));

export const sentMerchantQuotes = [
  {
    id: "SENT-801",
    requestCode: "RFQ-24018",
    product: "أسمنت مقاوم 50 كجم",
    price: 7224,
    deliveryDuration: "5 ساعات",
    status: "مرسل إلى بُنية",
  },
  {
    id: "SENT-802",
    requestCode: "RFQ-24031",
    product: "بلوك أسمنتي 20 سم",
    price: 18800,
    deliveryDuration: "يوم عمل",
    status: "قيد المقارنة الداخلية",
  },
];

export const orderTimeline: OrderTimelineEvent[] = [
  {
    title: "تم إنشاء الطلب",
    description: "اختار العميل المنتج والكمية وثبت موقع التسليم ببيانات Mock.",
    time: "10:15 صباحا",
    status: "draft",
  },
  {
    title: "تم إرسال الطلب للتجار",
    description: "وصل الطلب إلى التجار المؤهلين بدون اسم العميل أو المقاول.",
    time: "10:16 صباحا",
    status: "collecting_quotes",
  },
  {
    title: "تم استقبال العروض",
    description: "استقبلت بُنية عدة أسعار ومدد توصيل من التجار.",
    time: "11:20 صباحا",
    status: "collecting_quotes",
  },
  {
    title: "تم اعتماد الأرخص المؤهل",
    description: "اعتمدت المنصة أرخص عرض مؤهل واستبعدت العروض الأعلى أو غير المطابقة.",
    time: "11:24 صباحا",
    status: "final_offer_ready",
  },
  {
    title: "تم إرسال العرض باسم بُنية",
    description: "وصل للعميل عرض نهائي باسم بُنية دون اسم التاجر أو عروض المنافسين.",
    time: "11:26 صباحا",
    status: "final_offer_ready",
  },
  {
    title: "تم السداد",
    description: "أكمل العميل دفعا وهميا داخل تجربة الواجهة.",
    time: "11:32 صباحا",
    status: "paid",
  },
  {
    title: "خرج للتوصيل",
    description: "تم تسليم بيانات الموقع المسموحة للسائق وبدأت رحلة التوصيل.",
    time: "1:40 مساء",
    status: "out_for_delivery",
  },
  {
    title: "تم تأكيد الاستلام",
    description: "قدم العميل كود المصافحة الرقمية للسائق وتم توثيق التسليم.",
    time: "5:12 مساء",
    status: "delivered",
  },
];

export const quoteRequestLifecycle = orderTimeline;

export const driverDeliveries: DriverDelivery[] = [
  {
    id: "DEL-24018",
    orderId: "BUN-24018",
    productName: "أسمنت مقاوم 50 كجم",
    allowedDetails: ["المنتج والكمية", "موقع التسليم", "مدة التوصيل", "حالة التسليم"],
    destination: "حي النرجس، الرياض",
    mapLabel: "واجهة خريطة Mock: شمال الرياض، أقرب بوابة للموقع",
    eta: "42 دقيقة",
    handshakeCode: "483921",
    status: "assigned",
    statusLabel: "بانتظار كود المصافحة من العميل",
  },
  {
    id: "DEL-23990",
    orderId: "BUN-23990",
    productName: "رمل مغسول",
    allowedDetails: ["المنتج", "الوجهة", "حالة التسليم"],
    destination: "حي الياسمين، الرياض",
    mapLabel: "تم الوصول إلى الموقع Mock",
    eta: "تم التسليم",
    handshakeCode: "112845",
    status: "delivered",
    statusLabel: "موثق بكود العميل",
  },
];

export const adminMetrics: AdminMetric[] = [
  { label: "عدد الطلبات", value: "42", detail: "18 طلبا جديدا و11 طلبا مدفوعا" },
  { label: "عدد العروض", value: "96", detail: "متوسط الاستجابة 47 دقيقة" },
  { label: "عدد التجار", value: "24", detail: "اشتراكات تجار نشطة" },
  { label: "عدد المقاولين", value: "31", detail: "ملفات ظهور نشطة" },
  { label: "إيرادات التجار", value: "2,376 ريال", detail: "24 × 99 ريال شهريا" },
  { label: "إيرادات المقاولين", value: "1,519 ريال", detail: "31 × 49 ريال شهريا" },
  { label: "الإجمالي الشهري", value: "3,895 ريال", detail: "إيراد اشتراكات متوقع Mock" },
];

export const adminPipeline = adminMetrics.slice(0, 4);
