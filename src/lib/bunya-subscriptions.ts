import type { SubscriptionPlan } from "./bunya-types";

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: "merchant-monthly",
    role: "merchant",
    name: "اشتراك التاجر",
    priceMonthly: 99,
    description: "لوحة تاجر لاستقبال طلبات عروض السعر المجهولة وإدارة المنتجات والعروض المرسلة.",
    benefits: [
      "استقبال طلبات RFQ بدون كشف اسم العميل أو المقاول",
      "إدارة منتجات التاجر وحالات التوفر",
      "إرسال السعر ومدة التوصيل والملاحظات",
      "متابعة الطلبات المدفوعة الجاهزة للتجهيز",
    ],
    cta: "اشتراك تاجر Mock",
  },
  {
    id: "contractor-visibility",
    role: "contractor",
    name: "ظهور المقاول",
    priceMonthly: 49,
    description: "ظهور ملف المقاول في صفحة البحث مع الخدمات والخبرة وطرق التواصل وصور أعمال Mock.",
    benefits: [
      "بطاقة مقاول قابلة للبحث حسب المدينة والخدمة",
      "عرض الخدمات وسنوات الخبرة ونماذج الأعمال",
      "طرق تواصل واضحة للمستخدمين",
      "دعوة مباشرة لطلبات مواد البناء عبر بُنية",
    ],
    cta: "اشتراك مقاول Mock",
  },
];

export const merchantSubscription = subscriptionPlans[0];
export const contractorSubscription = subscriptionPlans[1];
