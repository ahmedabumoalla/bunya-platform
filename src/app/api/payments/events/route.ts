import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskWhatsAppDestination, sendGreenApiMessage } from "@/lib/notifications/providers/green-api";
import { recordProviderSubmission } from "@/lib/notifications/submissions";

export const runtime="nodejs";
type PaymentEvent={id:string;type:"payment.succeeded"|"payment.failed"|"payment.refunded";payment_record_id:string;gateway_reference?:string};

function validSignature(body:string,provided:string|null){const secret=process.env.PAYMENT_EVENTS_SECRET;if(!secret||!provided)return false;const expected=createHmac("sha256",secret).update(body).digest("hex");const a=Buffer.from(expected),b=Buffer.from(provided.replace(/^sha256=/,""));return a.length===b.length&&timingSafeEqual(a,b)}

export async function POST(request:NextRequest){
  const raw=await request.text();if(!validSignature(raw,request.headers.get("x-bunya-signature")))return NextResponse.json({message:"Unauthorized"},{status:401});
  let event:PaymentEvent;try{event=JSON.parse(raw) as PaymentEvent}catch{return NextResponse.json({message:"Invalid JSON"},{status:400})}
  if(!event.id||!event.payment_record_id||!["payment.succeeded","payment.failed","payment.refunded"].includes(event.type))return NextResponse.json({message:"Invalid event"},{status:400});
  const admin=createAdminClient();const applied=await admin.rpc("apply_trusted_payment_event",{p_event_id:event.id,p_payment_id:event.payment_record_id,p_event_type:event.type,p_gateway_reference:event.gateway_reference||""});
  if(applied.error)return NextResponse.json({message:"Event processing failed"},{status:409});
  if(event.type==="payment.succeeded"&&applied.data)await issueDeliveryCodes(admin,String(applied.data),event.id);
  return NextResponse.json({accepted:true,duplicate:applied.data===null});
}

async function issueDeliveryCodes(admin:ReturnType<typeof createAdminClient>,orderId:string,eventId:string){
  const order=await admin.from("orders").select("customer_profile_id,profiles!orders_customer_profile_id_fkey(mobile)").eq("id",orderId).single();const mobile=(order.data?.profiles as unknown as {mobile:string|null}|null)?.mobile;if(!mobile)return;
  const assignments=await admin.from("provider_delivery_assignments").select("id").eq("order_id",orderId);
  for(const assignment of assignments.data??[]){
    const code=String(randomInt(100000,1000000)),salt=randomBytes(24).toString("hex"),hash=createHash("sha256").update(`${salt}:${code}`).digest("hex");
    await admin.from("delivery_confirmation_codes").upsert({assignment_id:assignment.id,code_salt:salt,code_hash:hash,expires_at:new Date(Date.now()+7*86400000).toISOString(),max_attempts:5,attempts:0,locked_until:null,verified_at:null,created_at:new Date().toISOString()});
    const key=`delivery-code:${eventId}:${assignment.id}`;const result=await sendGreenApiMessage({to:mobile,text:`رمز تأكيد استلام طلبك في منصة بُنية: ${code}\nلا تشارك الرمز إلا بعد استلام الشحنة كاملة.`,idempotencyKey:key});
    await recordProviderSubmission({eventType:"customer.delivery_code_issued",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(mobile),idempotencyKey:key,result});
    if(result.status!=="submitted")await admin.from("outbox_events").insert({aggregate_type:"delivery",aggregate_id:assignment.id,event_type:"admin.delivery_code_delivery_failed",payload:{},idempotency_key:`delivery-code-failed:${eventId}:${assignment.id}`});
  }
}
