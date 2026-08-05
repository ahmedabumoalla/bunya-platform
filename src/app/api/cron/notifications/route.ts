import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {dispatchNotificationBatch} from "@/lib/notifications/dispatcher";
import {createAdminClient} from "@/lib/supabase/admin";

export const runtime="nodejs";
export async function GET(request:NextRequest){const configured=process.env.CRON_SECRET||"",provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";if(!configured||configured.length!==provided.length||!timingSafeEqual(Buffer.from(configured),Buffer.from(provided)))return NextResponse.json({message:"Unauthorized"},{status:401});if(process.env.NOTIFICATIONS_ENABLED!=="true")return NextResponse.json({status:"disabled"});try{await createAdminClient().rpc("schedule_operational_notifications");return NextResponse.json(await dispatchNotificationBatch(10))}catch{return NextResponse.json({message:"Dispatcher unavailable"},{status:503})}}
