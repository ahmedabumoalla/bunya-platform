export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return "يجب ألا تقل كلمة المرور عن 8 أحرف.";
  }
  if (!/[A-Z]/.test(password)) {
    return "يجب أن تحتوي كلمة المرور على حرف إنجليزي كبير واحد على الأقل.";
  }
  if (!/[0-9]/.test(password)) {
    return "يجب أن تحتوي كلمة المرور على رقم واحد على الأقل.";
  }
  return "";
}
