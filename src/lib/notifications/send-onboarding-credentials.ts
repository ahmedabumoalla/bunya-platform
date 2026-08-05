import "server-only";
import {sendGreenApiMessage,maskWhatsAppDestination} from "./providers/green-api";
import {sendResendSensitiveCopy} from "./providers/resend";
import {maskEmail,recordProviderSubmission} from "./submissions";

export async function sendOnboardingCredentials(input:{kind:"provider"|"contractor";email:string;mobile:string;password:string;idempotencyKey:string}){
  const site=process.env.APP_URL||"https://bunya-platform.vercel.app";
  const role=input.kind==="provider"?"مزود":"مقاول";
  const text=`مرحبًا بك في منصة بُنية. تم اعتماد حسابك كـ${role}.\nالبريد المستخدم للدخول: ${input.email}\nكلمة المرور المؤقتة: ${input.password}\nتسجيل الدخول: ${site}/login\nغيّر كلمة المرور فور الدخول ولا تشاركها مع أي شخص.`;
  const whatsapp=await sendGreenApiMessage({to:input.mobile,text,idempotencyKey:`${input.idempotencyKey}-wa`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(input.mobile),idempotencyKey:`${input.idempotencyKey}-wa`,result:whatsapp}).catch(()=>undefined);
  const email=await sendResendSensitiveCopy({to:input.email,subject:"بيانات الدخول إلى منصة بُنية",text,idempotencyKey:`${input.idempotencyKey}-email`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password_copy",channel:"email",destinationMasked:maskEmail(input.email),idempotencyKey:`${input.idempotencyKey}-email`,result:email}).catch(()=>undefined);
  return{email,whatsapp};
}
