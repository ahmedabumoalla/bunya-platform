type LoginError = { code?: string; status?: number; message?: string; name?: string };

export function loginErrorMessage(error: LoginError) {
  if (error.code === "invalid_credentials") return "لم تقبل خدمة تسجيل الدخول البريد أو كلمة المرور. أعد كتابتهما يدويًا أو استخدم استعادة كلمة المرور.";
  if (error.code === "email_not_confirmed") return "البريد الإلكتروني غير مؤكد بعد. افتح رسالة التأكيد ثم حاول مجددًا.";
  if (error.code === "user_banned") return "الحساب موقوف حاليًا. تواصل مع إدارة المنصة.";
  if (error.code === "over_request_rate_limit" || error.status === 429) return "تمت محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة واحدة.";
  if (error.code === "request_timeout") return "انتهت مهلة الاتصال بخدمة تسجيل الدخول. تحقق من الشبكة ثم حاول مجددًا.";
  // Supabase preserves the hook message but currently reports code="unknown".
  if (error.status === 403 && /انتهت صلاحية كلمة المرور المؤقتة|temporary password (?:has )?expired/i.test(error.message || "")) {
    return "انتهت صلاحية كلمة المرور المؤقتة (٢٤ ساعة). اطلب من الإدارة إعادة إرسال بيانات الدخول.";
  }
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status !== undefined && error.status >= 500)) {
    return "تعذر الاتصال بخدمة تسجيل الدخول حاليًا. تحقق من الاتصال وحاول مرة أخرى بعد قليل.";
  }
  // An unclassified refusal is not proof of a network failure or accepted credentials.
  return "تعذر إكمال تسجيل الدخول. إذا استمرت المشكلة فتواصل مع إدارة المنصة.";
}
