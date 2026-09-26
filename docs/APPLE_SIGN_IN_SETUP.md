# Sign in with Apple — إعداد بُنية

الكود الداخلي جاهز للويب وتطبيق Flutter/iOS، لكنه يبقى مخفيًا حتى تكتمل
إعدادات Apple وSupabase التالية. لا تحفظ ملف `.p8` أو السر المولّد داخل المستودع.

## المطلوب من حساب Apple Developer

1. عضوية Apple Developer فعّالة، بصلاحية `Account Holder` أو `Admin`.
2. تفعيل `Sign in with Apple` على App ID ذي Bundle ID:
   `com.buniahksa.app`، وجعله Primary App ID عند عدم وجود Primary سابق.
3. إنشاء Services ID خاص بالويب، مثل `com.buniahksa.web`، وربطه بالـApp ID.
4. في إعداد Website URLs للـServices ID:
   - Domain: `ccvbtduzkvuzvckfwqik.supabase.co`
   - Return URL: `https://ccvbtduzkvuzvckfwqik.supabase.co/auth/v1/callback`
5. إنشاء Sign in with Apple Key وتنزيل ملف `AuthKey_<KEY_ID>.p8` مرة واحدة،
   وحفظ Team ID وKey ID في مدير أسرار آمن.
6. تسجيل نطاقات البريد الخاصة ببُنية لدى Apple حتى تصل الرسائل إلى عناوين
   `privaterelay.appleid.com` عندما يختار المستخدم إخفاء بريده.

## إعداد Supabase

من Authentication > Providers > Apple:

- فعّل Apple.
- ضع Services ID أول عنصر في Client IDs حتى يعمل OAuth للويب.
- أضف `com.buniahksa.app` بعده لقبول رمز التطبيق الأصلي.
- أنشئ Apple client secret من Team ID وKey ID وملف `.p8` وأدخله في Supabase.
- أضف عناوين التطبيق المسموحة إلى Redirect URLs، ومنها:
  - `https://www.buniahksa.com/auth/callback`
  - عنوان localhost المستخدم للاختبار، مثل `http://localhost:3001/auth/callback`

سر OAuth الخاص بـApple ينتهي كل ستة أشهر. يجب وضع تذكير تشغيلي لتدويره قبل
انتهائه، مع الاحتفاظ الآمن بملف `.p8` أو إلغائه وإنشاء مفتاح جديد عند فقده.

## تشغيل الواجهة بعد اكتمال الإعداد

- الويب: عيّن `NEXT_PUBLIC_APPLE_SIGN_IN_ENABLED=true` في بيئة البناء.
- Flutter/iOS: مرّر `--dart-define=APPLE_SIGN_IN_ENABLED=true` عند التشغيل أو
  البناء. لا تُفعّل هذا العلم قبل توقيع التطبيق بفريق Apple الذي يملك App ID.

## اختبار القبول

- دخول أول مرة بعنوان Apple حقيقي، مرة مع مشاركة البريد ومرة باستخدام Hide My Email.
- التأكد من حفظ الاسم عند أول تفويض؛ Apple لا يعيده في مرات الدخول التالية.
- إكمال توثيق الجوال السعودي، ثم إنشاء ملف العميل وفتح البوابة المطلوبة.
- تسجيل الخروج ثم الدخول مجددًا، وتجربة إلغاء شاشة Apple والخطأ وانتهاء الجلسة.
- اختبار رابط العودة إلى سلة طلب السعر في الويب.
