import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {sendGreenApiMessage,maskWhatsAppDestination} from "./providers/green-api";
import {recordProviderSubmission} from "./submissions";

export async function notifyJoinReviewers(input:{kind:"provider"|"contractor";applicationId:string;name:string;company?:string;submittedAt:string}){
  if(process.env.NOTIFICATIONS_ENABLED!=="true")return;
  const admin=createAdminClient();
  const [users,superRole,permissionRoles]=await Promise.all([admin.from("admin_users").select("profile_id,role_id,profiles(mobile)").eq("is_active",true),admin.from("admin_roles").select("id").eq("role_key","super_admin").maybeSingle(),admin.from("admin_role_permissions").select("role_id,admin_permissions!inner(permission_key)").eq("admin_permissions.permission_key","reviews.manage")]);
  if(users.error)return;const roles=new Set<string>((permissionRoles.data||[]).map(row=>row.role_id));if(superRole.data?.id)roles.add(superRole.data.id);
  const reviewPath=input.kind==="provider"?"providers":"contractors",site=process.env.APP_URL||"https://bunya-platform.vercel.app";
  const text=`طلب انضمام جديد في بُنية\nالنوع: ${input.kind==="provider"?"مزود":"مقاول"}\nالاسم: ${input.name}${input.company?`\nالمنشأة: ${input.company}`:""}\nرقم الطلب: ${input.applicationId}\nالوقت: ${input.submittedAt}\nالمراجعة: ${site}/admin/join-requests/${reviewPath}`;
  for(const row of users.data||[]){const mobile=(row.profiles as unknown as {mobile:string|null}|null)?.mobile;if(!roles.has(row.role_id)||!mobile)continue;const key=`join-submitted-${input.applicationId}-${row.profile_id}`;const result=await sendGreenApiMessage({to:mobile,text,idempotencyKey:key});await recordProviderSubmission({eventType:"join.application_submitted",channel:"whatsapp",destinationMasked:maskWhatsAppDestination(mobile),idempotencyKey:key,result}).catch(()=>undefined);await admin.from("notifications").insert({profile_id:row.profile_id,type:"join_application_submitted",title:"طلب انضمام جديد",message:`طلب ${input.kind==="provider"?"مزود":"مقاول"} جديد برقم ${input.applicationId}`,action_url:`/admin/join-requests/${reviewPath}`,entity_type:`${input.kind}_application`,entity_id:input.applicationId})}
}
