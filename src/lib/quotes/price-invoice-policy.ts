/** Owner-requested printed receipt phrase; does not change delivery records. */
export const PRICE_INVOICE_POLICY_VERSION = "exclusive-address-invoice-receipt-v3";

export function priceInvoicePolicy(): { title: string; body: string }[] {
  return [{
    title: "",
    body: "تم استلام البضاعة بحالتها الأصلية ومطابقة للمواصفات الواردة في الفاتورة وبحالة ممتازة",
  }];
}
