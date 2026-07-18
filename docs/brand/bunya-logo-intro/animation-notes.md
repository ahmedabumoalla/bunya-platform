# Animation Notes (GSAP)

## ملاحظات عامة
- المدة المستهدفة: من 2.0 إلى 2.5 ثانية.
- استخدم الطبقات الكاملة (*-full.png) مع `position:absolute; inset:0;` داخل حاوية بأبعاد 2048px × 1536px أو بنسبة مطابقة.
- الترتيب المقترح في DOM: square-1, square-3, square-2, word, tagline.
- لم أرفق SVG مستقل هنا لأن أي auto-trace متجهي للنص العربي قد يغيّر الحواف الدقيقة؛ ملفات PNG المرفقة هي الأقرب لمرجع الصورة المصدر.

## تسلسل حركة مقترح (إجمالي ~2.25s)
1. **0.00s → 0.85s**
   - المربع الأول يدخل من اليسار السفلي قليلًا (`x:-140`, `y:80`, `rotation:-18`, `filter:blur(10px)`) ثم يستقر على موضعه.
   - المربع الثاني يدخل من الأعلى (`y:-120`, `rotation:12`, `filter:blur(10px)`) ويستقر في المنتصف الأمامي.
   - المربع الثالث يدخل من اليمين العلوي (`x:150`, `y:-70`, `rotation:16`, `filter:blur(10px)`) ثم يستقر على موضعه.
   - اجعل الثلاثة يتداخلون زمنيًا (`stagger` خفيف جدًا أو بدايات متقاربة) حتى يبدو التجمع سريعًا وحيويًا.

2. **0.78s → 1.45s**
   - بعد أن تتقارب المربعات وتثبت، تظهر كلمة **بُنية**.
   - الحركة المقترحة: `autoAlpha:0 -> 1`, `y:20 -> 0`, `filter:blur(8px) -> blur(0px)`, مع ease ناعم مثل `power3.out`.

3. **1.30s → 1.80s**
   - تظهر العبارة السفلية أخيرًا.
   - الحركة المقترحة: `autoAlpha:0 -> 1`, `y:14 -> 0`, `filter:blur(6px) -> blur(0px)`.

4. **1.85s → 2.25s**
   - بعد اكتمال الشعار، نفّذ انتقالًا سلسًا إلى الهيدر أو الصفحة الرئيسية:
     - إمّا تصغير خفيف للشعار كاملًا (`scale:1 -> 0.92`) مع رفعه للأعلى قليلًا.
     - أو Fade/Scale-out قصير يعقبه ظهور محتوى الصفحة.

## قيم Ease مناسبة
- دخول المربعات: `power3.out` أو `expo.out`
- ظهور النص: `power2.out`
- الانتقال النهائي: `sine.inOut`

## مثال Timeline مختصر
```js
const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

tl
  .fromTo(square1,
    { x: -140, y: 80, rotation: -18, autoAlpha: 0, filter: 'blur(10px)' },
    { x: 0, y: 0, rotation: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.85 }
  )
  .fromTo(square2,
    { y: -120, rotation: 12, autoAlpha: 0, filter: 'blur(10px)' },
    { y: 0, rotation: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.82 },
    0.08
  )
  .fromTo(square3,
    { x: 150, y: -70, rotation: 16, autoAlpha: 0, filter: 'blur(10px)' },
    { x: 0, y: 0, rotation: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.85 },
    0.04
  )
  .fromTo(word,
    { y: 20, autoAlpha: 0, filter: 'blur(8px)' },
    { y: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.52, ease: 'power2.out' },
    0.78
  )
  .fromTo(tagline,
    { y: 14, autoAlpha: 0, filter: 'blur(6px)' },
    { y: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.45, ease: 'power2.out' },
    1.30
  )
  .to(logoWrapper, { scale: 0.92, y: -18, duration: 0.40, ease: 'sine.inOut' }, 1.85);
```

## ملاحظة تنفيذية
إذا أردت انتقالًا أنعم، يمكنك بعد نهاية الـtimeline:
- تثبيت الشعار في مكانه داخل الهيدر، ثم
- تشغيل `page content fade-in` بالتوازي خلال آخر 0.25–0.35 ثانية.
