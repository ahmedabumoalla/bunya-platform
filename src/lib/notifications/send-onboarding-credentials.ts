import "server-only";
import {sendGreenApiMessage,maskWhatsAppDestination} from "./providers/green-api";
import {sendResendSensitiveCopy} from "./providers/resend";
import {OFFICIAL_PLATFORM_URL} from "./site-url";
import {maskEmail,recordProviderSubmission} from "./submissions";
import {compactText,shortReference} from "./compact";

export async function sendOnboardingCredentials(input:{kind:"provider"|"contractor";applicationId:string;applicantName:string;details:Array<{label:string;value:string}>;email:string;mobile:string;password:string;idempotencyKey:string}){
  const site=OFFICIAL_PLATFORM_URL;
  const text=`${compactText(input.applicantName,60)}، تم قبول انضمامك #${shortReference(input.applicationId)}.\nالجوال: ${input.mobile}\nكلمة المرور المؤقتة: ${input.password}\nصالحة 24 ساعة؛ غيّرها عند الدخول ولا تشاركها.\n${site}/login`;
  const whatsapp=await sendGreenApiMessage({to:input.mobile,text,idempotencyKey:`${input.idempotencyKey}-wa`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(input.mobile),idempotencyKey:`${input.idempotencyKey}-wa`,result:whatsapp}).catch(()=>undefined);
  const email=await sendResendSensitiveCopy({to:input.email,subject:"بيانات الدخول إلى منصة بُنية",text,idempotencyKey:`${input.idempotencyKey}-email`});
  await recordProviderSubmission({eventType:"onboarding.temporary_password_copy",channel:"email",destinationMasked:maskEmail(input.email),idempotencyKey:`${input.idempotencyKey}-email`,result:email}).catch(()=>undefined);
  return{email,whatsapp};
}
