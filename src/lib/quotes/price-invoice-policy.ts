/** Blank recipient acknowledgement; invoice generation does not sign it. */
export const PRICE_INVOICE_POLICY_VERSION = "exclusive-address-invoice-receipt-v2";

export function priceInvoicePolicy(): { title: string; body: string }[] {
  return [{
    title: "إقرار استلام البضاعة",
    body: "أقر باستلام البضاعة بحالة جيدة ومطابقة للمواصفات الواردة في الفاتورة.\n\nاسم المستلم: ........................    التوقيع: ........................    تاريخ الاستلام: ........................",
  }];
}
