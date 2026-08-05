import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import type {ProviderSubmission} from "./providers/green-api";

export async function recordProviderSubmission(input:{eventType:string;channel:"whatsapp"|"email";destinationMasked:string;idempotencyKey:string;result:ProviderSubmission}){
  const admin=createAdminClient();
  await admin.from("notification_provider_submissions").upsert({event_type:input.eventType,channel:input.channel,masked_destination:input.destinationMasked,idempotency_key:input.idempotencyKey,status:input.result.status,provider_message_id:input.result.providerMessageId,submitted_at:input.result.submittedAt,sanitized_error:input.result.sanitizedError,attempts:1},{onConflict:"idempotency_key",ignoreDuplicates:true});
  if(input.result.status==="failed"||input.result.status==="configuration_missing"){
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const failures=await admin.from("notification_provider_submissions").select("id",{count:"exact",head:true}).eq("channel",input.channel).in("status",["failed","configuration_missing"]).gte("created_at",since);
    if((failures.count??0)>=3){const eventType=input.channel==="email"?"admin.resend_repeated_failure":"admin.green_api_repeated_failure",bucket=new Date().toISOString().slice(0,13);await admin.from("outbox_events").upsert({aggregate_type:"notification_provider",aggregate_id:crypto.randomUUID(),event_type:eventType,payload:{channel:input.channel,failure_count:failures.count},idempotency_key:`provider-failures:${input.channel}:${bucket}`},{onConflict:"idempotency_key",ignoreDuplicates:true})}
  }
}

export function maskEmail(value:string){const [name,domain]=value.split("@");return !domain?"***":`${name.slice(0,1)}***@${domain}`}
