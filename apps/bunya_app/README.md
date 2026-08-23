# تطبيق بُنية Flutter

تطبيق مستقل بدون WebView، مرتبط مباشرة بنفس Supabase المستخدم في منصة الويب.

## المعاينة السريعة

من جذر المستودع:

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\bunya_app\tool\run.ps1
```

ثم افتح `http://127.0.0.1:8090`. استخدم `r` في الطرفية للتحديث السريع.

للتشغيل على جهاز Android متصل:

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\bunya_app\tool\run.ps1 -Target android
```

إعداد Firebase مطلوب قبل تفعيل Push على الأجهزة: `google-services.json` لـAndroid و`GoogleService-Info.plist` لـiOS. التطبيق يستمر بالعمل بدونهما، بينما تبقى الإشعارات داخل التطبيق مرتبطة بجدول `notifications` نفسه.
