/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect,useMemo,useState } from "react";
import Link from "next/link";
import type { NotificationType,ProviderNotification } from "@/lib/provider-types";
import { notificationsMock } from "@/lib/provider-data";
import { readProviderCollection,writeProviderCollection } from "@/lib/provider-storage";
import { formatProviderDate,ProviderEmpty,ProviderPageHeader } from "./ProviderUI";

const typeLabels:Record<NotificationType,string>={quote_request:"طلب عرض سعر",quote_decision:"قرار عرض",product:"منتج",order:"طلب",delivery:"توصيل",settlement:"تصفية",admin:"إداري"};
export function ProviderNotifications(){const[items,setItems]=useState<ProviderNotification[]>(notificationsMock);const[type,setType]=useState("all");useEffect(()=>setItems(readProviderCollection("notifications")),[]);const persist=(next:ProviderNotification[])=>{setItems(next);writeProviderCollection("notifications",next);};const visible=useMemo(()=>type==="all"?items:items.filter((item)=>item.type===type),[items,type]);return <div className="provider-page-stack"><ProviderPageHeader eyebrow="مركز التنبيهات" title="الإشعارات" description="تابع الطلبات والقرارات والتوصيل والتصفية من سجل موحد." action={<button className="provider-secondary" type="button" onClick={()=>persist(items.map((item)=>({...item,read:true})))}>تعليم الكل كمقروء</button>}/><section className="provider-filters"><select value={type} onChange={(event)=>setType(event.target.value)}><option value="all">كل الأنواع</option>{Object.entries(typeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></section>{visible.length?<section className="provider-notifications-list">{visible.map((item)=><Link href={item.link} onClick={()=>persist(items.map((value)=>value.id===item.id?{...value,read:true}:value))} className={item.read?"":"unread"} key={item.id}><span>{item.read?"○":"●"}</span><div><small>{typeLabels[item.type]} · {formatProviderDate(item.createdAt)}</small><h3>{item.title}</h3><p>{item.message}</p></div><b>←</b></Link>)}</section>:<ProviderEmpty title="لا توجد إشعارات" description="لا توجد عناصر ضمن هذا النوع."/>}</div>}
