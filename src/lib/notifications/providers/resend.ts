import "server-only";
import type {ProviderSubmission} from "./green-api";

export async function sendResendSensitiveCopy(input:{to:string;subject:string;text:string;idempotencyKey:string}):Promise<ProviderSubmission>{
  const key=process.env.RESEND_API_KEY,fromEmail=process.env.RESEND_FROM_EMAIL,fromName=process.env.RESEND_FROM_NAME||"منصة بُنية",apiUrl=process.env.RESEND_API_URL||"https://api.resend.com/emails";
  if(!key||!fromEmail)return{status:"configuration_missing",providerMessageId:null,sanitizedError:"provider_configuration_missing",submittedAt:null};
  try{const response=await fetch(apiUrl,{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json","Idempotency-Key":input.idempotencyKey},body:JSON.stringify({from:`${fromName} <${fromEmail}>`,to:[input.to],reply_to:process.env.RESEND_REPLY_TO||undefined,subject:input.subject,text:input.text}),signal:AbortSignal.timeout(12000),cache:"no-store"});const body=await response.json().catch(()=>({})) as {id?:string};if(response.ok&&body.id)return{status:"submitted",providerMessageId:body.id,sanitizedError:null,submittedAt:new Date().toISOString()};return{status:"failed",providerMessageId:null,sanitizedError:`provider_http_${response.status}`,submittedAt:null}}catch(error){return{status:"failed",providerMessageId:null,sanitizedError:error instanceof DOMException&&error.name==="TimeoutError"?"provider_timeout":"provider_network_error",submittedAt:null}}
}
