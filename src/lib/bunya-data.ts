import type { Product, ProductCategory } from "./bunya-types";

export const platformName = "بُنية";

export const navItems = [
  { label: "الرئيسية", href: "/" },
  { label: "المنتجات", href: "/products" },
  { label: "المستخدم", href: "/customer" },
  { label: "المقاول", href: "/contractor" },
  { label: "التاجر", href: "/merchant" },
  { label: "السائق", href: "/driver" },
  { label: "الأدمن", href: "/admin" },
  { label: "المقاولون", href: "/contractors" },
  { label: "الاشتراكات", href: "/subscriptions" },
] as const;

export const productCategories: ProductCategory[] = [
  "الأسمنت",
  "الحديد",
  "البلك والطوب",
  "العزل",
  "السباكة",
  "الكهرباء",
  "الأخشاب",
  "الدهانات",
  "الأدوات والمعدات",
];

export const products: Product[] = [
  {
    id: "cement-src-50",
    name: "أسمنت مقاوم 50 كجم",
    category: "الأسمنت",
    unit: "كيس",
    shortDescription: "أسمنت مقاوم للرطوبة للقواعد والخزانات.",
    description: "أسمنت مناسب للقواعد والخزانات والأعمال التي تحتاج مقاومة أعلى للرطوبة.",
    fullDescription:
      "أسمنت مقاوم معبأ في أكياس 50 كجم ومناسب للأعمال الخرسانية التي تتعرض للرطوبة مثل القواعد والخزانات والأقبية. يورد من مصانع محلية مع تعبئة محكمة وخيارات كميات للمواقع السكنية والتجارية.",
    availability: "متوفر في الرياض والخرج",
    availabilityStatus: "متوفر",
    leadTime: "توصيل خلال 4-6 ساعات",
    specs: ["مطابق للمواصفات السعودية", "تعبئة محكمة 50 كجم", "مقاومة محسنة للرطوبة", "مناسب للقواعد والخزانات"],
    measurements: [
      { id: "bag-50", label: "كيس 50 كجم", unit: "كيس", isDefault: true },
      { id: "pallet-60", label: "طبليّة 60 كيس", unit: "طبليّة" },
    ],
    units: ["كيس", "طبليّة"],
    delivery: {
      label: "سريع داخل المدينة",
      window: "4-6 ساعات",
      notes: "يشترط توفر مدخل مناسب للرافعة أو التنزيل اليدوي حسب الموقع.",
    },
    regions: [
      { city: "الرياض", scope: "الشمال والشرق والوسط" },
      { city: "الخرج", scope: "داخل النطاق العمراني" },
    ],
    warranty: {
      label: "ضمان توريد",
      duration: "7 أيام",
      details: "استبدال الكميات المتضررة من النقل عند توثيقها وقت الاستلام.",
    },
    images: [
      { id: "cement-main", label: "الأكياس", alt: "أكياس أسمنت مقاوم 50 كجم", tone: "cement" },
      { id: "cement-pallet", label: "الطبالي", alt: "طبالي أسمنت مرتبة للتوريد", tone: "cement" },
      { id: "cement-site", label: "الموقع", alt: "توريد أسمنت إلى موقع بناء", tone: "cement" },
    ],
    deliveryNotes: "التحميل على طبالي متاح للكميات الكبيرة، وتحديد نقطة التنزيل مطلوب قبل اعتماد العرض.",
    isNew: true,
  },
  {
    id: "rebar-16",
    name: "حديد تسليح 16 مم",
    category: "الحديد",
    unit: "طن",
    shortDescription: "حديد درجة 60 مع شهادة منشأ.",
    description: "حديد درجة 60 مع شهادة منشأ وتجهيز تحميل مباشر للمواقع.",
    fullDescription:
      "حديد تسليح قطر 16 مم للمشاريع السكنية والتجارية، يورد بالطن مع شهادة منشأ وخيارات ربط أو تحميل مباشر حسب متطلبات الموقع. مناسب للقواعد والأعمدة والجسور الخرسانية.",
    availability: "متوفر حسب الكمية",
    availabilityStatus: "كمية محدودة",
    leadTime: "توصيل خلال 24 ساعة",
    specs: ["درجة 60", "قطر 16 مم", "شهادة منشأ", "تحميل مباشر للمواقع"],
    measurements: [
      { id: "rebar-ton", label: "طن", unit: "طن", isDefault: true },
      { id: "rebar-bundle", label: "حزمة قياسية", unit: "حزمة" },
    ],
    units: ["طن", "حزمة"],
    delivery: {
      label: "توريد مجدول",
      window: "خلال 24 ساعة",
      notes: "يتطلب تحديد مساحة التفريغ واتجاه دخول الشاحنة قبل التسليم.",
    },
    regions: [
      { city: "الرياض", scope: "كل الأحياء" },
      { city: "جدة", scope: "الشرق والجنوب" },
      { city: "الدمام", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "مطابقة مواصفات",
      duration: "حسب شهادة المصنع",
      details: "يتم إرفاق بيانات المصدر والدرجة مع العرض النهائي.",
    },
    images: [
      { id: "rebar-main", label: "الحزم", alt: "حزم حديد تسليح 16 مم", tone: "steel" },
      { id: "rebar-close", label: "القطر", alt: "تفاصيل قطر حديد التسليح", tone: "steel" },
      { id: "rebar-yard", label: "المستودع", alt: "حديد تسليح في مستودع توريد", tone: "steel" },
    ],
    deliveryNotes: "الكميات الكبيرة تحتاج موعد تسليم مؤكد ومساحة آمنة للتنزيل.",
    isNew: true,
  },
  {
    id: "block-20",
    name: "بلوك أسمنتي 20 سم",
    category: "البلك والطوب",
    unit: "حبة",
    shortDescription: "بلوك موحد للجدران الخارجية والداخلية.",
    description: "بلوك أسمنتي موحد المقاس مناسب للجدران الخارجية والداخلية.",
    fullDescription:
      "بلوك أسمنتي مقاس 20 سم بجودة ثابتة للاستخدام في الجدران الخارجية والداخلية. يورد بالكميات الكبيرة على طبالي مع ترتيب التحميل حسب قرب المشروع من الموردين المؤهلين.",
    availability: "متوفر بكميات مشاريع",
    availabilityStatus: "متوفر",
    leadTime: "توصيل خلال يوم عمل",
    specs: ["مقاس 20 سم", "تحميل على طبالي", "مناسب للجدران الخارجية", "حواف منتظمة"],
    measurements: [
      { id: "block-piece", label: "حبة", unit: "حبة", isDefault: true },
      { id: "block-pallet", label: "طبليّة", unit: "طبليّة" },
    ],
    units: ["حبة", "طبليّة"],
    delivery: {
      label: "كميات مشاريع",
      window: "يوم عمل",
      notes: "تحدد تكلفة الرافعة أو التنزيل اليدوي ضمن العرض حسب الموقع.",
    },
    regions: [
      { city: "الرياض", scope: "داخل المدينة" },
      { city: "القصيم", scope: "بريدة وعنيزة" },
    ],
    warranty: {
      label: "سلامة نقل",
      duration: "وقت الاستلام",
      details: "يتم استبدال الكسر الزائد عن النسبة المتفق عليها في العرض.",
    },
    images: [
      { id: "block-main", label: "البلوك", alt: "بلوك أسمنتي 20 سم", tone: "blocks" },
      { id: "block-stack", label: "التكديس", alt: "رصات بلوك على طبالي", tone: "blocks" },
      { id: "block-wall", label: "الجدار", alt: "بلوك مستخدم في جدار بناء", tone: "blocks" },
    ],
    deliveryNotes: "يفضل تجهيز أرضية مستوية لاستلام الطبالي وتقليل التلف أثناء التنزيل.",
  },
  {
    id: "insulation-xps",
    name: "ألواح عزل XPS 5 سم",
    category: "العزل",
    unit: "لوح",
    shortDescription: "ألواح عزل حراري للأسطح والجدران.",
    description: "ألواح عزل حراري XPS بسماكة 5 سم للأسطح والجدران ومناطق الرطوبة.",
    fullDescription:
      "ألواح عزل XPS بسماكة 5 سم وكثافة مناسبة للمشاريع السكنية، تستخدم في عزل الأسطح والجدران ومناطق الرطوبة. توفر مقاومة ضغط جيدة وسهولة قص وتركيب داخل الموقع.",
    availability: "متوفر في الرياض وجدة",
    availabilityStatus: "متوفر",
    leadTime: "توصيل خلال 12 ساعة",
    specs: ["سماكة 5 سم", "مقاومة رطوبة", "قابل للقص", "مناسب للأسطح والجدران"],
    measurements: [
      { id: "xps-board", label: "لوح 60 × 120 سم", unit: "لوح", isDefault: true },
      { id: "xps-pack", label: "حزمة 12 لوح", unit: "حزمة" },
    ],
    units: ["لوح", "حزمة"],
    delivery: {
      label: "توريد خفيف",
      window: "8-12 ساعة",
      notes: "يلزم حفظ الألواح بعيدا عن مصادر الحرارة المباشرة في الموقع.",
    },
    regions: [
      { city: "الرياض", scope: "داخل المدينة" },
      { city: "جدة", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "ضمان تخزين",
      duration: "3 أيام",
      details: "يشمل العيوب الواضحة في الألواح قبل التركيب.",
    },
    images: [
      { id: "xps-main", label: "الألواح", alt: "ألواح عزل XPS زرقاء", tone: "insulation" },
      { id: "xps-stack", label: "الحزم", alt: "حزم ألواح عزل حراري", tone: "insulation" },
      { id: "xps-roof", label: "السطح", alt: "ألواح عزل على سطح مبنى", tone: "insulation" },
    ],
    deliveryNotes: "يجب تحديد مكان تخزين جاف ومظلل قبل التسليم.",
    isNew: true,
  },
  {
    id: "pvc-pipes",
    name: "مواسير PVC للصرف",
    category: "السباكة",
    unit: "حزمة",
    shortDescription: "مواسير صرف بمقاسات متعددة ووصلات معتمدة.",
    description: "مواسير صرف بمقاسات متعددة مع وصلات معتمدة وتغليف آمن.",
    fullDescription:
      "مواسير PVC للصرف الصحي بمقاسات متعددة، مناسبة للتمديدات الداخلية والخارجية في المشاريع السكنية. يمكن طلبها بالحزمة مع اختيار القطر المناسب وإضافة ملاحظات الوصلات المطلوبة ضمن عرض السعر.",
    availability: "متوفر بمقاسات متعددة",
    availabilityStatus: "متوفر",
    leadTime: "توصيل خلال 6 ساعات",
    specs: ["مقاسات 2-6 بوصة", "وصلات معتمدة", "تغليف آمن", "مقاومة للتآكل"],
    measurements: [
      { id: "pipe-2", label: "2 بوصة", unit: "حزمة" },
      { id: "pipe-4", label: "4 بوصة", unit: "حزمة", isDefault: true },
      { id: "pipe-6", label: "6 بوصة", unit: "حزمة" },
    ],
    units: ["حزمة", "ماسورة"],
    delivery: {
      label: "متاح اليوم",
      window: "4-6 ساعات",
      notes: "تسلم الحزم مغلفة، والقطع أو الوصلات الخاصة تذكر في الملاحظات.",
    },
    regions: [
      { city: "الرياض", scope: "كل الأحياء" },
      { city: "الدمام", scope: "الدمام والخبر" },
    ],
    warranty: {
      label: "ضمان مصنع",
      duration: "12 شهرا",
      details: "حسب شروط المصنع ضد عيوب التصنيع قبل الاستخدام.",
    },
    images: [
      { id: "pvc-main", label: "المواسير", alt: "مواسير PVC بيضاء للصرف", tone: "plumbing" },
      { id: "pvc-size", label: "المقاسات", alt: "مقاسات مواسير PVC مختلفة", tone: "plumbing" },
      { id: "pvc-bundle", label: "الحزمة", alt: "حزمة مواسير جاهزة للتوريد", tone: "plumbing" },
    ],
    deliveryNotes: "اكتب نوع الوصلات المطلوبة في الملاحظات لتضمينها ضمن العرض.",
  },
  {
    id: "copper-cable-16",
    name: "كيبل نحاس 16 مم",
    category: "الكهرباء",
    unit: "لفة",
    shortDescription: "كيبل نحاس معزول للتمديدات الرئيسية.",
    description: "كيبل نحاس معزول مناسب للتمديدات الرئيسية داخل المشاريع السكنية.",
    fullDescription:
      "كيبل نحاس مقاس 16 مم بعزل قوي للتمديدات الرئيسية ولوحات التوزيع. يورد باللفة أو المتر حسب توفر المورد، مع إمكانية تحديد الطول المطلوب داخل طلب عرض السعر.",
    availability: "متوفر في المدن الرئيسية",
    availabilityStatus: "كمية محدودة",
    leadTime: "توصيل خلال 24 ساعة",
    specs: ["نحاس عالي النقاوة", "عزل مقاوم للحرارة", "مقاس 16 مم", "مناسب للوحات الرئيسية"],
    measurements: [
      { id: "cable-roll", label: "لفة 100 متر", unit: "لفة", isDefault: true },
      { id: "cable-meter", label: "بالمتر", unit: "متر" },
    ],
    units: ["لفة", "متر"],
    delivery: {
      label: "حسب توفر الطول",
      window: "12-24 ساعة",
      notes: "الأطوال المفتوحة تعتمد على توفر المورد ونوع التغليف.",
    },
    regions: [
      { city: "الرياض", scope: "داخل المدينة" },
      { city: "جدة", scope: "داخل المدينة" },
      { city: "الدمام", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "ضمان مصنع",
      duration: "حسب المورد",
      details: "يشمل عيوب العزل أو القطع قبل الاستخدام.",
    },
    images: [
      { id: "cable-main", label: "اللفة", alt: "لفة كيبل نحاس 16 مم", tone: "electric" },
      { id: "cable-cut", label: "المقطع", alt: "مقطع كيبل نحاس معزول", tone: "electric" },
      { id: "cable-site", label: "التمديد", alt: "كيابل كهربائية في موقع بناء", tone: "electric" },
    ],
    deliveryNotes: "يجب تحديد الطول المطلوب بدقة عند اختيار الشراء بالمتر.",
    isNew: true,
  },
  {
    id: "plywood-18",
    name: "خشب بليوود 18 مم",
    category: "الأخشاب",
    unit: "لوح",
    shortDescription: "ألواح بليوود للقوالب والأعمال المؤقتة.",
    description: "خشب بليوود بسماكة 18 مم مناسب للقوالب الخرسانية والأعمال المؤقتة.",
    fullDescription:
      "ألواح بليوود بسماكة 18 مم للاستخدام في القوالب الخرسانية والتجهيزات المؤقتة. تتوفر بدرجات مختلفة حسب المورد، ويمكن تحديد الاستخدام المطلوب للحصول على عرض مناسب للمقاومة والتكرار.",
    availability: "متوفر حسب الدرجة",
    availabilityStatus: "حسب الطلب",
    leadTime: "توصيل خلال يوم عمل",
    specs: ["سماكة 18 مم", "مناسب للقوالب", "سطح متماسك", "درجات متعددة"],
    measurements: [
      { id: "plywood-sheet", label: "لوح 122 × 244 سم", unit: "لوح", isDefault: true },
      { id: "plywood-pack", label: "حزمة ألواح", unit: "حزمة" },
    ],
    units: ["لوح", "حزمة"],
    delivery: {
      label: "مجدول",
      window: "يوم عمل",
      notes: "يجب توفير مساحة جافة ومظللة لتخزين الألواح عند الاستلام.",
    },
    regions: [
      { city: "الرياض", scope: "داخل المدينة" },
      { city: "جدة", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "فحص استلام",
      duration: "وقت التسليم",
      details: "يشمل الكسر أو الالتواء الواضح قبل الاستخدام.",
    },
    images: [
      { id: "wood-main", label: "الألواح", alt: "ألواح بليوود 18 مم", tone: "wood" },
      { id: "wood-stack", label: "الحزمة", alt: "حزمة خشب بليوود", tone: "wood" },
      { id: "wood-form", label: "القوالب", alt: "خشب مستخدم في قوالب خرسانية", tone: "wood" },
    ],
    deliveryNotes: "اذكر هل الاستخدام للقوالب أو التشطيبات حتى يطابق المورد الدرجة المناسبة.",
  },
  {
    id: "paint-primer",
    name: "برايمر دهان داخلي",
    category: "الدهانات",
    unit: "جالون",
    shortDescription: "برايمر داخلي لتحضير الجدران قبل الدهان.",
    description: "برايمر داخلي لتحسين التصاق الدهان وتقليل امتصاص الجدران.",
    fullDescription:
      "برايمر دهان داخلي يستخدم لتحضير الجدران قبل طبقات الدهان النهائية. مناسب للمشاريع التي تحتاج تشطيب موحد وتقليل تفاوت الامتصاص، ويتوفر بأحجام مختلفة حسب كمية الأعمال.",
    availability: "متوفر في الرياض وجدة والدمام",
    availabilityStatus: "متوفر",
    leadTime: "توصيل خلال 8 ساعات",
    specs: ["استخدام داخلي", "تحسين الالتصاق", "تغطية اقتصادية", "أحجام متعددة"],
    measurements: [
      { id: "paint-gallon", label: "جالون 3.6 لتر", unit: "جالون", isDefault: true },
      { id: "paint-pail", label: "سطل 18 لتر", unit: "سطل" },
    ],
    units: ["جالون", "سطل"],
    delivery: {
      label: "متاح اليوم",
      window: "6-8 ساعات",
      notes: "يحفظ بعيدا عن الشمس المباشرة ويستلم في منطقة جيدة التهوية.",
    },
    regions: [
      { city: "الرياض", scope: "كل الأحياء" },
      { city: "جدة", scope: "داخل المدينة" },
      { city: "الدمام", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "ضمان تخزين",
      duration: "14 يوما",
      details: "يشمل العبوات غير المفتوحة والمتضررة أثناء النقل.",
    },
    images: [
      { id: "paint-main", label: "العبوة", alt: "عبوة برايمر دهان داخلي", tone: "paint" },
      { id: "paint-pail", label: "السطل", alt: "سطل دهان كبير", tone: "paint" },
      { id: "paint-wall", label: "الجدار", alt: "تطبيق برايمر على جدار داخلي", tone: "paint" },
    ],
    deliveryNotes: "يمكن إضافة لون الدهان النهائي في الملاحظات إذا كان العرض يشمل مواد إضافية.",
  },
  {
    id: "rotary-hammer",
    name: "دريل تكسير SDS Plus",
    category: "الأدوات والمعدات",
    unit: "قطعة",
    shortDescription: "دريل تكسير للأعمال الكهربائية والسباكة.",
    description: "دريل تكسير SDS Plus مناسب لفتح المسارات والتثبيت في الخرسانة.",
    fullDescription:
      "دريل تكسير SDS Plus للأعمال المتوسطة داخل مواقع البناء، مناسب للتثبيت وفتح المسارات الخفيفة في الخرسانة والطوب. يمكن طلبه مع ريش ومستلزمات إضافية حسب توفر المورد.",
    availability: "متوفر لدى موردين محددين",
    availabilityStatus: "كمية محدودة",
    leadTime: "توصيل خلال 24 ساعة",
    specs: ["نظام SDS Plus", "مناسب للخرسانة والطوب", "قبضة مريحة", "خيارات ريش إضافية"],
    measurements: [
      { id: "hammer-piece", label: "قطعة", unit: "قطعة", isDefault: true },
      { id: "hammer-kit", label: "طقم مع ريش", unit: "طقم" },
    ],
    units: ["قطعة", "طقم"],
    delivery: {
      label: "حسب المخزون",
      window: "12-24 ساعة",
      notes: "الأطقم تختلف حسب المورد، وتوضح الملحقات في العرض النهائي.",
    },
    regions: [
      { city: "الرياض", scope: "داخل المدينة" },
      { city: "جدة", scope: "داخل المدينة" },
    ],
    warranty: {
      label: "ضمان جهاز",
      duration: "12 شهرا",
      details: "حسب شروط الوكيل، ولا يشمل سوء الاستخدام أو الملحقات الاستهلاكية.",
    },
    images: [
      { id: "tool-main", label: "الجهاز", alt: "دريل تكسير SDS Plus", tone: "tools" },
      { id: "tool-kit", label: "الطقم", alt: "طقم دريل مع ريش", tone: "tools" },
      { id: "tool-site", label: "الاستخدام", alt: "دريل تكسير في موقع بناء", tone: "tools" },
    ],
    deliveryNotes: "حدد إن كنت تحتاج الجهاز فقط أو طقما كاملا مع الريش.",
  },
];

export const workflowSteps = [
  {
    title: "طلب المنتج",
    description: "المستخدم أو المقاول يختار المنتج والكمية ويحدد موقع التسليم بوضوح.",
  },
  {
    title: "إرسال RFQ للتجار",
    description: "بُنية ترسل الطلب للتجار المؤهلين دون كشف اسم العميل أو المقاول.",
  },
  {
    title: "تجميع العروض",
    description: "المنصة تجمع الأسعار ومدد التوصيل ضمن نافذة زمنية واضحة.",
  },
  {
    title: "اعتماد الأرخص المؤهل",
    description: "تتم المقارنة داخليا ويعتمد العرض الأرخص الذي يطابق شروط الطلب.",
  },
  {
    title: "عرض نهائي باسم بُنية",
    description: "العميل يرى عرض بُنية فقط دون اسم التاجر أو عروض المنافسين.",
  },
  {
    title: "السداد والتوصيل",
    description: "بعد السداد يبدأ التجهيز والتوصيل وينتهي الطلب بكود المصافحة الرقمية.",
  },
];

export const quoteRules = [
  "لا يظهر اسم التاجر للمستخدم أو المقاول.",
  "لا يظهر اسم العميل أو المقاول للتاجر.",
  "لا تظهر عروض المنافسين لأي طرف خارج الأدمن.",
  "العرض النهائي يظهر باسم منصة بُنية فقط.",
  "الأدمن فقط يرى التجار والعروض المتعددة للمراجعة الداخلية.",
  "تأكيد الاستلام يتم بكود مصافحة رقمية من العميل.",
];

export const roles = [
  {
    title: "المستخدم",
    description: "يطلب مواد البناء، يرى عرض بُنية النهائي، يدفع، ويتابع التوصيل.",
  },
  {
    title: "المقاول",
    description: "يدير طلبات مواد مواقع المشاريع ويستطيع الاشتراك للظهور في صفحة البحث.",
  },
  {
    title: "التاجر",
    description: "يدير منتجاته ويرسل عروض سعر مجهولة بدون رؤية العميل أو المنافسين.",
  },
  {
    title: "السائق",
    description: "يرى بيانات التوصيل المسموحة فقط ويؤكد التسليم بالكود.",
  },
  {
    title: "الأدمن",
    description: "يراقب الطلبات والعروض والاشتراكات والمنتجات داخليا.",
  },
];

export { contractorProfiles as contractors } from "./bunya-contractors";
export { subscriptionPlans as revenuePlans } from "./bunya-subscriptions";
export {
  adminMetrics,
  adminPipeline,
  anonymousQuoteRequests,
  driverDeliveries,
  finalOffer,
  merchantQuotes,
  orderTimeline,
  quoteOffers,
  quoteRequestLifecycle,
  quoteRequests,
  sampleRequest,
  sentMerchantQuotes,
} from "./bunya-order";
