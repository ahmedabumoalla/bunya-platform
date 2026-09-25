import "server-only";
import type {ProviderSubmission} from "./green-api";

export async function sendResendSensitiveCopy(input:{to:string;subject:string;text:string;html?:string;idempotencyKey:string}):Promise<ProviderSubmission>{
  const key=process.env.RESEND_API_KEY,fromEmail=process.env.RESEND_FROM_EMAIL,fromName=process.env.RESEND_FROM_NAME||"منصة بُنية",apiUrl=process.env.RESEND_API_URL||"https://api.resend.com/emails";
  if(!key||!fromEmail)return{status:"configuration_missing",providerMessageId:null,sanitizedError:"provider_configuration_missing",submittedAt:null};
  let lastError="provider_request_failed";
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(apiUrl,{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json","Idempotency-Key":input.idempotencyKey},body:JSON.stringify({from:`${fromName} <${fromEmail}>`,to:[input.to],reply_to:process.env.RESEND_REPLY_TO||undefined,subject:input.subject,text:input.text,html:input.html}),signal:AbortSignal.timeout(12000),cache:"no-store"});
      const body=await response.json().catch(()=>({})) as {id?:string};
      if(response.ok&&body.id)return{status:"submitted",providerMessageId:body.id,sanitizedError:null,submittedAt:new Date().toISOString()};
      lastError=`provider_http_${response.status}`;
      if(response.status!==429&&response.status<500)break;
    }catch(error){
      lastError=error instanceof DOMException&&error.name==="TimeoutError"?"provider_timeout":"provider_network_error";
      const cause=error instanceof Error?error.cause:undefined;
      console.error("Resend transport attempt failed",{
        attempt:attempt+1,
        name:error instanceof Error?error.name:"unknown",
        message:error instanceof Error?error.message:"unknown_error",
        causeCode:cause&&typeof cause==="object"&&"code" in cause?String(cause.code):undefined,
        causeMessage:cause instanceof Error?cause.message:undefined,
      });
    }
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,400*2**attempt));
  }
  return{status:"failed",providerMessageId:null,sanitizedError:lastError,submittedAt:null};
}
