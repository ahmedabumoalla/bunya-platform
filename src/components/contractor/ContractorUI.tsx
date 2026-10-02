const approvalLabels: Record<string, string> = {
  approved: "معتمد", pending: "بانتظار المراجعة", pending_review: "قيد المراجعة",
  rejected: "لم يُعتمد", suspended: "موقوف", needs_changes: "يحتاج تعديلات",
};
export function ContractorStatus({value}:{value:string}) {
  return <span className="contractor-status" data-status={value}>{approvalLabels[value] ?? "قيد المتابعة"}</span>;
}
