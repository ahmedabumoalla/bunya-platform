import {AdminRoute} from "@/components/admin/AdminRoute";
export default async function Page({params}:{params:Promise<{module:string[]}>}){const{module}=await params;return <AdminRoute segments={module}/>}
