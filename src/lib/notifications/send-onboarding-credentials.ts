import "server-only";
import {sendGreenApiMessage,maskWhatsAppDestination} from "./providers/green-api";
import {sendResendSensitiveCopy} from "./providers/resend";
import {maskEmail,recordProviderSubmission} from "./submissions";

export async function sendOnboardingCredentials(input:{kind:"provider"|"contractor";applicationId:string;applicantName:string;details:Array<{label:string;value:string}>;email:string;mobile:string;password:string;idempotencyKey:string}){
  const site=(process.env.APP_URL||process.env.NEXT_PUBLIC_SITE_URL||"https://buniahksa.com").replace(/\/$/,"");
  const role=input.kind==="provider"?"مزود":"مقاول";
  const portal=input.kind==="provider"?"/merchant":"/contractor";
  const details=input.details.map(({label,value})=>`${label}: ${value||"—"}`).join("\n");
  const text=`مرحبًا ${input.applicantName}،\nتمت الموافقة على طلب انضمامك كـ${role} في منصة بُنية.\nرقم الطلب: ${input.applicationId}\n\nبيانات الطلب:\n${details}\n\nبيانات الدخول:\nالبريد المستخدم: ${input.email}\nكلمة المرور المؤقتة: ${input.password}\nالدخول إلى لوحة التحكم: ${site}/login?returnTo=${encodeURIComponent(portal)}\nغيّر كلمة المرور فور الدخول ولا تشاركها مع أي شخص.`;
  const whatsapp=await sendGreenApiMessage({to:input.mobile,text,idempotencyKey:`${input.idempotencyKey}-wa`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(input.mobile),idempotencyKey:`${input.idempotencyKey}-wa`,result:whatsapp}).catch(()=>undefined);
  const email=await sendResendSensitiveCopy({to:input.email,subject:"بيانات الدخول إلى منصة بُنية",text,idempotencyKey:`${input.idempotencyKey}-email`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password_copy",channel:"email",destinationMasked:maskEmail(input.email),idempotencyKey:`${input.idempotencyKey}-email`,result:email}).catch(()=>undefined);
  return{email,whatsapp};
}
