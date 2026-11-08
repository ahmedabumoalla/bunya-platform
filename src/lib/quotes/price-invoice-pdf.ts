import "server-only";
import QRCode from "qrcode";
import type { PriceInvoice } from "./price-invoice-types";
import { renderPriceDocumentPdf } from "./price-quotation-pdf";

/** Issued documents retain their saved payload. Preview markers are explicitly
 * non-tax data, so scanning an experimental layout cannot imply issuance. */
export async function renderPriceInvoicePdf(invoice: PriceInvoice): Promise<Uint8Array> {
  if (invoice.status === "issued" && !invoice.qr_payload) throw new Error("Issued invoice QR payload is missing");
  const payload = invoice.status === "issued" ? invoice.qr_payload : `PREVIEW_ONLY:${invoice.quotation_id}`;
  const qr = await QRCode.toBuffer(payload, {
    type: "png", errorCorrectionLevel: "M", margin: 4, width: 408,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return renderPriceDocumentPdf(invoice, qr);
}
