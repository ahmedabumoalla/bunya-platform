import type { ContractorProfile } from "./bunya-types";

export const contractorCities = ["الرياض", "جدة", "الدمام", "الخبر"] as const;

export const contractorServiceTypes = [
  "بناء عظم",
  "تشطيبات",
  "ترميم",
  "إشراف هندسي",
  "عزل أسطح",
  "سباكة وكهرباء",
] as const;

export const contractorProfiles: ContractorProfile[] = [
  {
    id: "ctr-asas",
    displayName: "أساس العمران",
    commercialName: "شركة أساس العمران للمقاولات",
    city: "الرياض",
    badge: "مقاول موثق",
    serviceTypes: ["بناء عظم", "تشطيبات", "إشراف هندسي"],
    yearsExperience: 12,
    summary: "تنفيذ فلل سكنية ومبان تجارية صغيرة مع إدارة توريد المواد ومتابعة الجودة.",
    mockWorkImages: ["فيلا سكنية 480م", "مستودع تجاري", "واجهة حجر"],
    phone: "050 114 8820",
    email: "info@asas-omran.example",
    subscriptionActive: true,
    approvalStatus: "approved",
  },
  {
    id: "ctr-rawasi",
    displayName: "رواسي للبناء",
    commercialName: "مكتب رواسي للبناء",
    city: "جدة",
    badge: "اشتراك نشط",
    serviceTypes: ["إشراف هندسي", "عزل أسطح", "سباكة وكهرباء"],
    yearsExperience: 8,
    summary: "إدارة مشاريع سكنية متوسطة، أعمال خرسانة، عزل، وتمديدات تأسيسية.",
    mockWorkImages: ["عمارة 6 أدوار", "استراحة خاصة", "ملحق سكني"],
    phone: "055 778 3410",
    email: "hello@rawasi.example",
    subscriptionActive: true,
    approvalStatus: "approved",
  },
  {
    id: "ctr-midad",
    displayName: "مداد التشييد",
    commercialName: "مؤسسة مداد التشييد",
    city: "الدمام",
    badge: "متاح هذا الأسبوع",
    serviceTypes: ["ترميم", "تشطيبات", "بناء عظم"],
    yearsExperience: 10,
    summary: "أعمال خرسانة وتشطيبات وترميم مجالس وملاحق ومواقف مظللة.",
    mockWorkImages: ["مجمع دوبلكسات", "ترميم مجلس", "مواقف مظللة"],
    phone: "053 441 9921",
    email: "contact@midad.example",
    subscriptionActive: true,
    approvalStatus: "approved",
  },
];
