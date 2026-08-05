import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";

export function verifySupabaseHook(rawBody:string,headers:Headers){
  const configured=process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
  const webhookId=headers.get("webhook-id"),timestamp=headers.get("webhook-timestamp"),signature=headers.get("webhook-signature");
  if(!configured||!webhookId||!timestamp||!signature)return false;
  const seconds=Number(timestamp);if(!Number.isFinite(seconds)||Math.abs(Date.now()/1000-seconds)>300)return false;
  const encoded=configured.replace(/^v1,whsec_/,"").replace(/^whsec_/,"");
  let secret:Buffer;try{secret=Buffer.from(encoded,"base64")}catch{return false}
  const expected=createHmac("sha256",secret).update(`${webhookId}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some(item=>{const value=item.replace(/^v1,/,"");try{const actual=Buffer.from(value,"base64");return actual.length===expected.length&&timingSafeEqual(actual,expected)}catch{return false}});
}
