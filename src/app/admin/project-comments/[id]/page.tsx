import {AdminProjectCommentDetails} from "@/components/admin/AdminProjectComments";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AdminProjectCommentDetails id={id}/>}
