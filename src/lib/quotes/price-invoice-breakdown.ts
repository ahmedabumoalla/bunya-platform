import type { PriceInvoice } from "./price-invoice-types";

type InvoiceMoney = Pick<PriceInvoice, "items" | "subtotal" | "delivery_fee" | "vat_rate" | "vat_amount" | "total" | "pricing_basis">;

/** Allocate the persisted document VAT by largest remainder in integer fils.
 * This preserves the agreed line basis, and makes the printed line/delivery
 * components reconcile exactly with the immutable document total and QR.
 */
export function priceInvoiceBreakdown(invoice: InvoiceMoney) {
  const cents = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value !== Number(value.toFixed(2))) throw new Error("Invalid invoice monetary snapshot");
    return BigInt(Math.round(value * 100));
  };
  const inclusive = invoice.pricing_basis === "inclusive";
  const amounts = [...invoice.items.map(item => cents(item.line_total)), cents(invoice.delivery_fee)];
  const sum = amounts.reduce((total, amount) => total + amount, BigInt(0));
  const rate = cents(invoice.vat_rate);
  const denominator = BigInt(10000) + (inclusive ? rate : BigInt(0));
  const tax = cents(invoice.vat_amount);
  const total = cents(invoice.total);
  if (sum !== cents(invoice.subtotal) + cents(invoice.delivery_fee)
    || tax !== (sum * rate + denominator / BigInt(2)) / denominator
    || total !== sum + (inclusive ? BigInt(0) : tax)) throw new Error("Invoice amounts do not reconcile");
  const components = amounts.map((amount, index) => ({ amount, index, tax: amount * rate / denominator, remainder: amount * rate % denominator }));
  let remaining = tax - components.reduce((value, component) => value + component.tax, BigInt(0));
  const ranked = [...components].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const component of ranked) {
    if (remaining === BigInt(0)) break;
    component.tax += BigInt(1);
    remaining -= BigInt(1);
  }
  if (remaining !== BigInt(0)) throw new Error("Invoice VAT allocation failed");
  const money = (value: bigint) => Number(value) / 100;
  const rows = components.map(component => ({
    net: money(component.amount - (inclusive ? component.tax : BigInt(0))),
    vat: money(component.tax),
    gross: money(component.amount + (inclusive ? BigInt(0) : component.tax)),
  }));
  const delivery = rows[rows.length - 1];
  return {
    lines: rows.slice(0, -1), delivery,
    productsNet: money(total - tax - cents(delivery.net)),
    net: money(total - tax), vat: money(tax), gross: money(total),
  };
}
