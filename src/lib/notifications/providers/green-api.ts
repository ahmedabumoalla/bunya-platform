import "server-only";

import { setTimeout as delay } from "node:timers/promises";

export type ProviderSubmission = {
  status: "submitted" | "failed" | "configuration_missing";
  providerMessageId: string | null;
  sanitizedError: string | null;
  submittedAt: string | null;
};

let queue: Promise<unknown> = Promise.resolve();

function configuration() {
  const apiUrl=process.env.GREEN_API_URL?.replace(/\/$/,"");
  const mediaUrl=process.env.GREEN_API_MEDIA_URL?.replace(/\/$/,"");
  const id=process.env.GREEN_API_ID_INSTANCE;
  const token=process.env.GREEN_API_TOKEN_INSTANCE;
  return apiUrl&&id&&token?{apiUrl,mediaUrl,id,token}:null;
}

export function normalizeWhatsAppChatId(value:string) {
  let digits=value.replace(/\D/g,"");
  if(digits.startsWith("05"))digits=`966${digits.slice(1)}`;
  else if(digits.startsWith("5"))digits=`966${digits}`;
  if(!/^9665\d{8}$/.test(digits))throw new Error("invalid_saudi_mobile");
  return `${digits}@c.us`;
}

export function maskWhatsAppDestination(value:string) {
  const digits=value.replace(/\D/g,"");
  return digits.length<7?"***":`${digits.slice(0,3)}****${digits.slice(-3)}`;
}

export function sendGreenApiMessage(input:{to:string;text:string;idempotencyKey:string}) {
  return enqueue(()=>submitText(input));
}

export function sendGreenApiFile(input:{to:string;file:File;caption:string;idempotencyKey:string}) {
  return enqueue(()=>submitFile(input));
}

function enqueue<T>(work:()=>Promise<T>):Promise<T>{const next=queue.then(work,work);queue=next.catch(()=>undefined);return next}

async function submitText(input:{to:string;text:string;idempotencyKey:string}):Promise<ProviderSubmission>{
  const config=configuration();if(!config)return missing();
  const chatId=normalizeWhatsAppChatId(input.to);
  return retry(async()=>fetch(`${config.apiUrl}/waInstance${config.id}/sendMessage/${config.token}`,{method:"POST",headers:{"content-type":"application/json","x-idempotency-key":input.idempotencyKey},body:JSON.stringify({chatId,message:input.text}),signal:AbortSignal.timeout(12000),cache:"no-store"}));
}

async function submitFile(input:{to:string;file:File;caption:string;idempotencyKey:string}):Promise<ProviderSubmission>{
  const config=configuration();if(!config||!config.mediaUrl)return missing();
  if(!["application/pdf","image/jpeg","image/png"].includes(input.file.type))return {status:"failed",providerMessageId:null,sanitizedError:"unsupported_media_type",submittedAt:null};
  if(input.caption.length>1024)return {status:"failed",providerMessageId:null,sanitizedError:"caption_too_long",submittedAt:null};
  const body=new FormData();body.set("chatId",normalizeWhatsAppChatId(input.to));body.set("caption",input.caption);body.set("file",input.file);
  return retry(async()=>fetch(`${config.mediaUrl}/waInstance${config.id}/sendFileByUpload/${config.token}`,{method:"POST",headers:{"x-idempotency-key":input.idempotencyKey},body,signal:AbortSignal.timeout(20000),cache:"no-store"}));
}

async function retry(operation:()=>Promise<Response>):Promise<ProviderSubmission>{
  const sendDelay=Math.max(0,Number(process.env.GREEN_API_SEND_DELAY_MS||1500));
  let last="provider_request_failed";
  for(let attempt=0;attempt<3;attempt++){
    if(sendDelay)await delay(sendDelay);
    try{const response=await operation();const payload=await response.json().catch(()=>({})) as {idMessage?:string};if(response.ok&&payload.idMessage)return{status:"submitted",providerMessageId:payload.idMessage,sanitizedError:null,submittedAt:new Date().toISOString()};last=`provider_http_${response.status}`;if(response.status!==429&&response.status<500)break}catch(error){last=error instanceof DOMException&&error.name==="TimeoutError"?"provider_timeout":"provider_network_error"}
    if(attempt<2)await delay(500*2**attempt);
  }
  return{status:"failed",providerMessageId:null,sanitizedError:last,submittedAt:null};
}

function missing():ProviderSubmission{return{status:"configuration_missing",providerMessageId:null,sanitizedError:"provider_configuration_missing",submittedAt:null}}
