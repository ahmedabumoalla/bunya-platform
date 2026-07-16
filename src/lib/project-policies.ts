import type {PlatformPolicy} from "./project-request-types";

export const platformProjectPolicies:PlatformPolicy[]=[
 {id:"project-publication",title:"سياسة نشر طلبات المشاريع",version:"1.0",active:true,requiresAcceptance:true,updatedAt:"2026-07-16T00:00:00.000Z",content:["يخضع الطلب لمراجعة بُنية قبل النشر للمقاولين.","لا تظهر هوية العميل أو وسائل التواصل ضمن الفرصة.","يجب أن تكون المعلومات الفنية والميزانية والمواعيد دقيقة قدر الإمكان.","يجوز لبُنية إعادة الطلب لاستكمال البيانات أو رفض المحتوى المخالف."]},
 {id:"project-comments",title:"سياسة التعليقات على فرص المشاريع",version:"1.0",active:true,requiresAcceptance:true,updatedAt:"2026-07-16T00:00:00.000Z",content:["يرسل التعليق إلى الإدارة أولًا ولا يعدّل الطلب تلقائيًا.","يمنع تضمين بيانات اتصال أو محاولة التواصل خارج المنصة.","يجب أن يكون الاقتراح مهنيًا ومبررًا ومتصلاً بنطاق المشروع.","لا يرى العميل التعليق إلا بعد اعتماد الإدارة."]},
 {id:"contractor-proposals",title:"سياسة عروض المقاولين",version:"1.0",active:true,requiresAcceptance:true,updatedAt:"2026-07-16T00:00:00.000Z",content:["يتضمن العرض نطاقًا ومراحل ودفعات واضحة.","لا يضمن إرسال العرض إسناد المشروع.","تبقى بيانات التواصل محمية حتى تسمح سياسة المنصة بذلك."]},
 {id:"admin-project-review",title:"سياسة مراجعة الإدارة",version:"1.0",active:false,requiresAcceptance:false,updatedAt:"2026-07-16T00:00:00.000Z",content:["تراجع الإدارة سلامة المحتوى والخصوصية والارتباط الفني بالمشروع.","تسجل جميع القرارات وأسبابها في سجل التدقيق."]},
 {id:"budget-duration-change",title:"سياسة تعديل الميزانية أو المدة",version:"1.0",active:true,requiresAcceptance:false,updatedAt:"2026-07-16T00:00:00.000Z",content:["التعديل المقترح لا يصبح نافذًا قبل موافقة العميل.","تحفظ النسخة السابقة والجديدة للرجوع إليها.","رفض الاقتراح لا يغير بيانات الطلب المنشور."]},
];
export const projectPolicy=(id:string)=>platformProjectPolicies.find(policy=>policy.id===id);
