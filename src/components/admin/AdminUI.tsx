"use client";
import type {ReactNode} from "react";
export function AdminHeader({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <header className="admin-page-header"><div><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>{action}</header>}
export function AdminStatus({value}:{value:string}){return <span className="admin-status">{value}</span>}
export function AdminEmpty({text}:{text:string}){return <section className="admin-empty"><p>{text}</p></section>}
export function AdminToast({message}:{message:string}){return message?<p className="admin-toast" role="status">{message}</p>:null}
export function AdminDecisionDialog({title,description,reason,onReason,onCancel,onConfirm}:{title:string;description:string;reason:string;onReason:(value:string)=>void;onCancel:()=>void;onConfirm:()=>void}){return <div className="admin-modal-backdrop"><section className="admin-modal" role="dialog" aria-modal="true"><h3>{title}</h3><p>{description}</p><textarea value={reason} onChange={event=>onReason(event.target.value)} rows={4}/><footer><button onClick={onCancel}>إلغاء</button><button onClick={onConfirm} disabled={reason.trim().length<5}>تأكيد</button></footer></section></div>}
