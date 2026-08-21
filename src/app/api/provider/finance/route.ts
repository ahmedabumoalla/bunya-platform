import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthIdentity } from "@/lib/auth/server";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
async function requireProvider(){const identity=await getAuthIdentity(),provider=identity?.details.provider;if(!identity||identity.status!=="ready"||!identity.activeRoles.includes("provider")||!provider)throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعال.",401);return{identity,provider}}
function encryptIban(iban:string){const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw new Error("encryption_key_missing");const key=createHash("sha256").update(`provider-bank:${secret}`).digest(),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(iban,"utf8"),cipher.final()]);return`v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`}

export async function POST(request:NextRequest){try{assertSameOrigin(request);const{identity,provider}=await requireProvider(),body=await request.json() as Record<string,unknown>,action=String(body.action||""),admin=createAdminClient();
  if(action==="bank"){
    const bankName=String(body.bankName||"").trim().slice(0,120),holder=String(body.accountHolderName||"").trim().slice(0,160),iban=String(body.iban||"").replace(/\s/g,"").toUpperCase();
    if(bankName.length<2||holder.length<2||!/^SA\d{22}$/.test(iban))throw new PublicJoinError("أدخل بيانات الحساب وآيبان سعوديًا صحيحًا.",400);
    const fingerprint=createHash("sha256").update(iban).digest("hex"),existing=await admin.from("provider_bank_accounts").select("id").eq("provider_id",provider.providerId).eq("iban_fingerprint",fingerprint).maybeSingle();
    if(existing.data)throw new PublicJoinError("هذا الحساب البنكي مسجل مسبقًا.",409);
    const count=await admin.from("provider_bank_accounts").select("id",{count:"exact",head:true}).eq("provider_id",provider.providerId).eq("is_active",true);
    const saved=await admin.from("provider_bank_accounts").insert({provider_id:provider.providerId,bank_name:bankName,account_holder_name:holder,iban_ciphertext:encryptIban(iban),iban_last4:iban.slice(-4),iban_fingerprint:fingerprint,is_primary:(count.count??0)===0,is_verified:false,is_active:true}).select("id").single();
    if(saved.error)throw new Error("bank_save_failed");await admin.from("audit_logs").insert({actor_profile_id:identity.userId,entity_table:"provider_bank_accounts",entity_id:saved.data.id,action:"provider_bank_account_added",new_data:{provider_id:provider.providerId,iban_last4:iban.slice(-4)}});return NextResponse.json({id:saved.data.id},{status:201});
  }
  if(action==="primary"){
    const id=String(body.id||"");const owned=await admin.from("provider_bank_accounts").select("id,is_active").eq("id",id).eq("provider_id",provider.providerId).maybeSingle();if(!owned.data?.is_active)throw new PublicJoinError("الحساب البنكي غير متاح.",404);
    await admin.from("provider_bank_accounts").update({is_primary:false}).eq("provider_id",provider.providerId);const updated=await admin.from("provider_bank_accounts").update({is_primary:true}).eq("id",id).eq("provider_id",provider.providerId);if(updated.error)throw new Error("primary_update_failed");return NextResponse.json({ok:true});
  }
  if(action==="settlement"){
    const amount=Number(body.amount),bankAccountId=String(body.bankAccountId||""),notes=String(body.notes||"").trim().slice(0,500)||null,idempotencyKey=String(body.idempotencyKey||crypto.randomUUID());if(!Number.isFinite(amount)||amount<=0)throw new PublicJoinError("مبلغ الصرف غير صالح.",400);
    const session=await createClient(),saved=await session.rpc("request_provider_settlement",{p_amount:amount,p_bank:bankAccountId,p_notes:notes,p_idempotency_key:idempotencyKey});if(saved.error||!saved.data)throw new PublicJoinError(saved.error?.message.includes("balance")?"المبلغ المطلوب يتجاوز الرصيد المتاح للصرف.":"يجب اختيار حساب بنكي فعال ومعتمد.",409);return NextResponse.json({id:saved.data},{status:201});
  }
  throw new PublicJoinError("العملية غير مدعومة.",400);
}catch(error){if(error instanceof PublicJoinError)return NextResponse.json({error:error.message},{status:error.status});console.error("provider_finance_failed",{code:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"تعذر تنفيذ العملية المالية حاليًا."},{status:500})}}
