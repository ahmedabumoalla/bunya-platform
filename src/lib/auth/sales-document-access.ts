// Owner-designated restriction by immutable identity, independent of roles/email.
// Keep synchronized with private.sales_documents_restricted in migration111.
export function salesDocumentsRestricted(userId: string | null | undefined) {
  return userId === "7f4152b6-63d2-49ec-866f-681a3308f670"
    || userId === "d5b7d59e-3a22-4d59-8096-d546c9bd8c4e";
}

export const salesDocumentTables = ["price_quotation", "price_quotations", "price_quotation_event", "price_quotation_events", "price_invoice", "price_invoices", "price_invoice_settings", "sales_customer", "sales_customers", "invoice", "invoices", "invoice_item", "invoice_items"] as const;

export function salesDocumentPath(path: string) {
  return ["/admin/price-quotations", "/admin/invoices", "/customer/billing"].some(root => path === root || path.startsWith(`${root}/`));
}
