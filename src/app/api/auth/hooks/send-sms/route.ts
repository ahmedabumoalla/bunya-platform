import {after,NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {sendGreenApiMessage,maskWhatsAppDestination} from "@/lib/notifications/providers/green-api";
import {sendResendSensitiveCopy} from "@/lib/notifications/providers/resend";
import {maskEmail,recordProviderSubmission} from "@/lib/notifications/submissions";
import {verifySupabaseHook} from "@/lib/notifications/verify-supabase-hook";

export const runtime="nodejs";
type SmsHook={user?:{phone?:string;email?:string};sms?:{otp?:string}};

export async function POST(request:Request){
  const raw=await request.text();
  if(!verifySupabaseHook(raw,request.headers))return NextResponse.json({error:{http_code:401,message:"Invalid hook signature"}},{status:401});
  let payload:SmsHook;try{payload=JSON.parse(raw) as SmsHook}catch{return NextResponse.json({error:{http_code:400,message:"Invalid hook payload"}},{status:400})}
  const phone=payload.user?.phone?.trim(),otp=payload.sms?.otp?.trim(),email=payload.user?.email?.trim().toLowerCase();
  if(!phone||!otp||!/^\d{4,10}$/.test(otp))return NextResponse.json({error:{http_code:400,message:"Invalid hook payload"}},{status:400});
  const webhookId=request.headers.get("webhook-id")||createHash("sha256").update(raw).digest("hex");
  const whatsapp=await sendGreenApiMessage({to:phone,text:`رمز التحقق في منصة بُنية: ${otp}\nلا تشارك هذا الرمز مع أي شخص.`,idempotencyKey:`otp-wa-${webhookId}`,urgent:true});
  after(async()=>{
    await recordProviderSubmission({eventType:"auth.phone_otp",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(phone),idempotencyKey:`otp-wa-${webhookId}`,result:whatsapp}).catch(()=>undefined);
    if(email){const copy=await sendResendSensitiveCopy({to:email,subject:"نسخة رمز التحقق — منصة بُنية",text:`رمز التحقق في منصة بُنية: ${otp}\nلا تشارك هذا الرمز مع أي شخص.`,idempotencyKey:`otp-email-${webhookId}`});await recordProviderSubmission({eventType:"auth.phone_otp_copy",channel:"email",destinationMasked:maskEmail(email),idempotencyKey:`otp-email-${webhookId}`,result:copy}).catch(()=>undefined)}
  });
  if(whatsapp.status!=="submitted")return NextResponse.json({error:{http_code:502,message:"Primary OTP channel failed"}},{status:502});
  return new Response(null,{status:204});
}
