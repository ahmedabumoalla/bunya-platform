import { NextResponse } from "next/server";
import { requireJoinReviewer } from "@/lib/join/admin";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const auth=await requireJoinReviewer();
  if("error" in auth)return NextResponse.json({message:"غير مصرح."},{status:auth.error==="unauthorized"?401:403});
  const {kind}=await context.params;
  if(kind!=="provider"&&kind!=="contractor")return NextResponse.json({message:"المسار غير صالح."},{status:404});
  const table=kind==="provider"?"provider_applications":"contractor_applications";
  const relation=kind==="provider"?"provider_application_categories(custom_category,product_categories(name)),provider_delivery_regions(region_name),provider_application_documents(id,document_type,files(original_name,object_path))":"contractor_work_regions(region_name),contractor_specialties(specialty_name),contractor_documents(id,file_name,storage_path)";
  const rows=await auth.admin.from(table).select(`*,${relation}`).order("created_at",{ascending:false});
  if(rows.error)return NextResponse.json({message:"تعذر تحميل الطلبات."},{status:500});
  const ids=(rows.data||[]).map(row=>row.id);
  const reviews=ids.length?await auth.admin.from("join_request_reviews").select("request_id,outcome,reason,created_at").eq("request_kind",kind).in("request_id",ids).order("created_at",{ascending:false}):{data:[]};
  const onboarding=ids.length?await auth.admin.from("account_onboarding_deliveries").select("application_id,provisioning_status,email_delivery_status,whatsapp_delivery_status,last_delivery_error").eq("application_kind",kind).in("application_id",ids):{data:[]};
  const output=[];
  for(const row of rows.data||[]){
    const docs=kind==="provider"?(row.provider_application_documents||[]).map((d:Record<string,unknown>)=>({id:d.id,name:(d.files as {original_name:string})?.original_name,path:(d.files as {object_path:string})?.object_path})):(row.contractor_documents||[]).map((d:Record<string,unknown>)=>({id:d.id,name:d.file_name,path:d.storage_path}));
    const documents=[];
    for(const doc of docs){const signed=await auth.admin.storage.from("join-applications").createSignedUrl(String(doc.path),300);documents.push({...doc,url:signed.data?.signedUrl||null})}
    output.push({...row,documents,reviews:(reviews.data||[]).filter(review=>review.request_id===row.id),onboarding:(onboarding.data||[]).find(item=>item.application_id===row.id)||null});
  }
  return NextResponse.json({applications:output});
}
