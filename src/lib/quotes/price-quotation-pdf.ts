import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb, type PDFPage, type PDFImage } from "pdf-lib";
import type { PriceQuotation } from "./price-quotation-types";
import type { PriceInvoice } from "./price-invoice-types";
import { priceQuotationPolicy } from "./price-quotation-policy";
import { quotationItemPresentation } from "./price-quotation-presentation";
import { priceInvoiceBreakdown } from "./price-invoice-breakdown";

const PAGE_WIDTH = 595.28, PAGE_HEIGHT = 841.89, MARGIN = 28, CONTENT = PAGE_WIDTH - MARGIN * 2;
const SCALE = 3;
const INK = "#14234d", TEAL = "#087c89", MUTED = "#52647c", LINE = "#c7dee7", PALE = "#edf5f8";
// One bundled face covers both Arabic and Latin. Salma lacks Latin glyphs and
// relied on desktop font fallback, which is absent in the production runtime.
const fontFile = path.join(process.cwd(), "src/app/fonts/IBMPlexSansArabic-Regular.ttf");
const logoFile = path.join(process.cwd(), "public/brand/exclusive-address.png");
const escapeMarkup = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const directedText = (value: string, align: string) => escapeMarkup(align === "right" ? value.split("\n").map(line => `\u200f${line}`).join("\n") : value);
// Keep phone prefixes, SKU segments and dimensions in their original order
// when they are embedded after an Arabic label.
const inlineValue = (value: string) => `${/\p{Script=Arabic}/u.test(value.replace(/[\d\u0660-\u0669\u066a]/g, "")) ? "\u2067" : "\u2066"}${value}\u2069`;
const color = (hex: string) => rgb(...([1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]));
const money = (value: number) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
type Text = { image: PDFImage; width: number; height: number; png: Buffer };

/** Pango shapes Arabic and bidirectional text with our bundled font. Text is
 * embedded at 216dpi, while rules/backgrounds stay vector. No browser or
 * third-party rendering service receives customer data. */
export async function renderPriceQuotationPdf(quote: PriceQuotation): Promise<Uint8Array> {
  return renderPriceDocumentPdf(quote);
}

/** Shared stationery; invoice inputs are immutable issuance snapshots. */
export async function renderPriceDocumentPdf(input: PriceQuotation | PriceInvoice, qrPng?: Buffer): Promise<Uint8Array> {
  const invoice = "invoice_number" in input ? input : null;
  const quote = "invoice_number" in input ? {
    ...input, quotation_code: input.invoice_number, created_at: input.issued_at,
    customer_name: input.buyer.name, customer_phone: input.buyer.phone,
    customer_tax_number: input.buyer.vat_number, customer_address: input.buyer.address,
    source_request_code: input.quotation_code, valid_until: null, terms: "",
  } : input;
  const draft = invoice?.status === "draft";
  const inclusive = quote.pricing_basis === "inclusive";
  const invoiceMoney = invoice ? priceInvoiceBreakdown(invoice) : null;
  const documentTitle = invoice ? invoice.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة" : "عرض سعر";
  const documentSubtitle = invoice ? invoice.invoice_type === "standard" ? "Tax invoice" : "Simplified tax invoice" : "Quotation";
  const bodyTop = draft ? 164 : 128;
  const policy = "invoice_number" in input ? [] : priceQuotationPolicy(input);
  if (invoice?.status === "issued" && !qrPng) throw new Error("An issued invoice requires its persisted tax QR code");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${draft ? "مسودة — " : ""}${documentTitle} ${quote.quotation_code}`);
  pdf.setAuthor(invoice?.seller.name || "شركة العنوان الحصري");
  pdf.setSubject(invoice ? draft ? "معاينة تجريبية — غير صالحة كفاتورة ضريبية" : documentTitle : "عرض سعر — سياسة البيع والشروط والأحكام");
  pdf.setCreationDate(new Date(quote.created_at));
  const logo = await pdf.embedPng(await readFile(logoFile));
  const cache = new Map<string, Promise<Text>>();
  async function text(value: string, width: number, size = 10, ink = INK, align: "right" | "center" | "left" = "right"): Promise<Text> {
    const key = JSON.stringify([value, width, size, ink, align]);
    if (!cache.has(key)) cache.set(key, (async () => {
      const rendered = await sharp({ text: {
        text: `<span foreground="${ink}">${directedText(value || "—", align)}</span>`,
        font: `IBM Plex Sans Arabic ${size}`, fontfile: fontFile, width: Math.floor(width * SCALE),
        dpi: 72 * SCALE, rgba: true, align: align === "right" ? "left" : align, wrap: "word-char", spacing: SCALE,
      } }).png().toBuffer({ resolveWithObject: true });
      return { image: await pdf.embedPng(rendered.data), width: rendered.info.width / SCALE, height: rendered.info.height / SCALE, png: rendered.data };
    })());
    return cache.get(key)!;
  }
  function draw(page: PDFPage, block: Text, x: number, top: number, width: number, align: "right" | "center" | "left" = "right") {
    page.drawImage(block.image, { x: x + (align === "right" ? width - block.width : align === "center" ? (width - block.width) / 2 : 0), y: PAGE_HEIGHT - top - block.height, width: block.width, height: block.height });
  }
  function box(page: PDFPage, x: number, top: number, width: number, height: number, fill = "#ffffff") {
    page.drawRectangle({ x, y: PAGE_HEIGHT - top - height, width, height, color: color(fill), borderColor: color(LINE), borderWidth: .5 });
  }
  async function put(page: PDFPage, value: string, x: number, top: number, width: number, size = 10, ink = INK, align: "right" | "center" | "left" = "right") {
    const block = await text(value, width, size, ink, align); draw(page, block, x, top, width, align); return block.height;
  }
  async function newPage(subtitle = documentTitle) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(logo, { x: PAGE_WIDTH - MARGIN - 132, y: PAGE_HEIGHT - 102, width: 132, height: 80 });
    await put(page, subtitle, 215, 42, 162, invoice ? 16 : 21, INK, "center");
    await put(page, subtitle === "سياسة البيع" ? "Sales policy" : documentSubtitle, 215, 76, 162, 10, MUTED, "center");
    await put(page, quote.quotation_code, MARGIN, 35, 178, 10, INK, "left");
    const issued = invoice ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }).format(new Date(invoice.issued_at)) : date(quote.created_at);
    await put(page, `${invoice ? draft ? "تاريخ المعاينة" : "تاريخ الإصدار" : "تاريخ العرض"}: ${inlineValue(issued)}`, MARGIN, 59, 178, 8.5);
    await put(page, invoice ? `تاريخ التوريد: ${inlineValue(date(invoice.supply_date))}` : quote.valid_until ? `صالح حتى: ${inlineValue(date(quote.valid_until))}` : "العملة: ريال سعودي", MARGIN, 80, 178, 9);
    page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 114 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 114 }, color: color(TEAL), thickness: 1 });
    if (draft) {
      box(page, MARGIN, 123, CONTENT, 26, PALE);
      await put(page, "معاينة تجريبية — غير صالحة كفاتورة ضريبية", MARGIN + 10, 130, CONTENT - 20, 11, INK, "center");
    }
    return page;
  }
  let page = await newPage(), top = bodyTop;
  const gap = 10, half = (CONTENT - gap) / 2;
  const seller = invoice ? [invoice.seller.name, `السجل التجاري: ${inlineValue(invoice.seller.commercial_registration)}`, `الرقم الضريبي: ${inlineValue(invoice.seller.vat_number)}`, invoice.seller.address]
    : ["شركة العنوان الحصري", `السجل التجاري: ${inlineValue("5850157983")}`, `الرقم الضريبي: ${inlineValue("312872746700003")}`, `العنوان الوطني: ${inlineValue("AKAA8043")}`, "8043 حي الخالدية، خميس مشيط 62411", "الرقم الإضافي: 3076 — المملكة العربية السعودية"];
  const customer = [quote.customer_name || "العميل", `الجوال: ${inlineValue(quote.customer_phone)}`, ...(quote.customer_tax_number ? [`الرقم الضريبي: ${inlineValue(quote.customer_tax_number)}`] : []), ...(quote.customer_address ? [quote.customer_address] : []), ...(quote.source_request_code ? [`مرجع الطلب: ${inlineValue(quote.source_request_code)}`] : [])];
  const cardSpacing = invoice ? 4 : 7;
  const sellerBlocks = await Promise.all(seller.map(line => text(line, half - 20, invoice ? 8.5 : 9)));
  const customerBlocks = await Promise.all(customer.map(line => text(line, half - 20, invoice ? 8.5 : 9)));
  const cardHeight = (invoice ? 37 : 43) + Math.max(...[sellerBlocks, customerBlocks].map(blocks => blocks.reduce((height, block) => height + block.height + cardSpacing, 0)));
  for (const [x, title, blocks] of [[MARGIN + half + gap, "بيانات البائع", sellerBlocks], [MARGIN, invoice ? "بيانات المشتري" : "بيانات العميل", customerBlocks]] as const) {
    box(page, x, top, half, cardHeight); box(page, x, top, half, 26, TEAL);
    await put(page, title, x + 10, top + 7, half - 20, 10, "#ffffff");
    let rowTop = top + (invoice ? 33 : 38);
    for (const block of blocks) { draw(page, block, x + 10, rowTop, half - 20); rowTop += block.height + cardSpacing; }
  }
  top += cardHeight + (invoice ? 12 : 18);
  // Left-to-right column positions, with the product description on the RTL side.
  const widths = invoice ? [67, 67, 49, 35, 40, 35, 59, CONTENT - 370, 18] : [91, 80, 66, CONTENT - 261, 24];
  const labels = invoice
    ? ["الإجمالي شامل الضريبة", "الإجمالي قبل الضريبة", "مبلغ الضريبة", "نسبة الضريبة", "الكمية", "الوحدة", inclusive ? "سعر الوحدة شامل الضريبة" : "سعر الوحدة قبل الضريبة", "المنتج والمواصفات", "م"]
    : [inclusive ? "الإجمالي شامل الضريبة" : "الإجمالي قبل الضريبة", inclusive ? "سعر الوحدة شامل الضريبة" : "سعر الوحدة", "الكمية / الوحدة", "المنتج والمواصفات", "م"];
  const descriptionColumn = invoice ? 7 : 3;
  const cellPadding = invoice ? 4 : 7;
  const headerBlocks = await Promise.all(labels.map((label, index) => text(label, widths[index] - (invoice ? 6 : 10), invoice ? 7.5 : 8, "#ffffff", "center")));
  const headerHeight = Math.max(30, ...headerBlocks.map(block => block.height + 12));
  async function tableHeader() {
    let x = MARGIN;
    for (let i = 0; i < widths.length; i++) { box(page, x, top, widths[i], headerHeight, TEAL); draw(page, headerBlocks[i], x, top + (headerHeight - headerBlocks[i].height) / 2, widths[i], "center"); x += widths[i]; }
    top += headerHeight;
  }
  if (top > 650) { page = await newPage(); top = bodyTop; }
  await tableHeader();
  // Issued invoice line descriptions are immutable. New invoice snapshots have
  // already applied this presentation rule at issuance.
  const items = invoice ? quote.items : quote.items.map(quotationItemPresentation);
  for (const [index, item] of items.entries()) {
    const description = [item.product_name, ...(item.sku ? [inlineValue(`SKU: ${item.sku}`)] : []), ...item.attributes.map(attribute => `${attribute.label}: ${inlineValue(attribute.value)}`), ...(item.notes ? [item.notes] : [])].join("\n");
    const lineMoney = invoiceMoney?.lines[index];
    const values = lineMoney
      ? [money(lineMoney.gross), money(lineMoney.net), money(lineMoney.vat), `${quote.vat_rate}%`, String(item.quantity), item.unit, money(item.unit_price), description, String(index + 1)]
      : [money(item.line_total), money(item.unit_price), `${item.quantity}\n${item.unit}`, description, String(index + 1)];
    const blocks = await Promise.all(values.map((value, i) => text(value, widths[i] - cellPadding * 2, invoice ? 8 : 9, INK, i === descriptionColumn ? "right" : "center")));
    const height = Math.max(42, ...blocks.map(block => block.height + 20));
    if (top + height > 760 && top > bodyTop + headerHeight) { page = await newPage(); top = bodyTop; await tableHeader(); }
    // Very long item notes/specifications continue across pages without clipping.
    let consumed = 0;
    while (consumed < height) {
      const fragment = Math.min(height - consumed, 760 - top);
      let x = MARGIN;
      for (let i = 0; i < widths.length; i++) {
        box(page, x, top, widths[i], fragment, index % 2 ? PALE : "#ffffff");
        const block = blocks[i];
        if (consumed === 0 && block.height + 10 <= fragment) draw(page, block, x + cellPadding, top + 10, widths[i] - cellPadding * 2, i === descriptionColumn ? "right" : "center");
        else if (block.height > consumed) {
          // Crop only overflowing text images; normal rows remain one PDF image.
          const cropTop = Math.max(0, Math.round(consumed * SCALE));
          const cropHeight = Math.min(Math.round(block.height * SCALE) - cropTop, Math.floor((fragment - 10) * SCALE));
          if (cropHeight > 0) {
            const cropped = await sharp(block.png).extract({ left: 0, top: cropTop, width: Math.round(block.width * SCALE), height: cropHeight }).png().toBuffer();
            draw(page, { image: await pdf.embedPng(cropped), width: block.width, height: cropHeight / SCALE, png: cropped }, x + cellPadding, top + 5, widths[i] - cellPadding * 2, i === descriptionColumn ? "right" : "center");
          }
        }
        x += widths[i];
      }
      consumed += fragment - (consumed + fragment < height ? 10 : 0); top += fragment;
      if (consumed < height) { page = await newPage(); top = bodyTop; await tableHeader(); }
    }
  }
  // Keep the invoice totals and its sales policy together.
  // Compact RTL columns use the blank area instead of a dedicated policy page.
  const singlePolicy = invoice?.sales_policy.length === 1;
  const policyGap = 18, policyWidth = singlePolicy ? CONTENT : (CONTENT - policyGap) / 2;
  const invoicePolicy = invoice ? await Promise.all(invoice.sales_policy.map((section, index) =>
    text(singlePolicy ? section.body : `${index + 1}. ${section.title}: ${section.body}`, policyWidth, singlePolicy ? 9.5 : 7.5))) : [];
  const columnHeight = (blocks: Text[]) => blocks.reduce((sum, block) => sum + block.height + 3, 0);
  let policySplit = 0, policyHeight = 0;
  if (invoicePolicy.length) {
    policyHeight = Infinity;
    for (let split = 1; split <= invoicePolicy.length; split++) {
      const height = Math.max(columnHeight(invoicePolicy.slice(0, split)), columnHeight(invoicePolicy.slice(split)));
      if (height < policyHeight) { policySplit = split; policyHeight = height; }
    }
    policyHeight += 32;
  }
  if (top + Math.max(170, 141 + policyHeight) > 760) { page = await newPage(); top = bodyTop; }
  top += 16;
  if (invoice && qrPng) {
    const qr = await pdf.embedPng(qrPng);
    page.drawImage(qr, { x: MARGIN + 37, y: PAGE_HEIGHT - top - 102, width: 102, height: 102 });
  }
  // Keep a net taxable breakdown even when item prices were entered gross.
  // Allocate the total's rounded tax exactly, rather than round each unit net
  // and inadvertently change the customer's agreed gross amount.
  const deliveryNet = invoiceMoney ? invoiceMoney.delivery.net : inclusive ? Math.round(quote.delivery_fee * 100 / (1 + quote.vat_rate / 100)) / 100 : quote.delivery_fee;
  const subtotalNet = invoiceMoney ? invoiceMoney.productsNet : inclusive ? (Math.round(quote.total * 100) - Math.round(quote.vat_amount * 100) - Math.round(deliveryNet * 100)) / 100 : quote.subtotal;
  const totals = [[invoice ? "إجمالي المنتجات قبل الضريبة" : "المنتجات قبل الضريبة", subtotalNet], [invoice ? "رسوم التوصيل قبل الضريبة" : "التوصيل قبل الضريبة", deliveryNet], ...(invoiceMoney ? [["الإجمالي قبل الضريبة", invoiceMoney.net] as const] : []), [`ضريبة القيمة المضافة (${inlineValue(`${quote.vat_rate}٪`)})`, quote.vat_amount], ["الإجمالي شامل الضريبة — ر.س", quote.total]] as const;
  const totalRowHeight = invoice ? 25 : 31;
  for (const [index, [label, value]] of totals.entries()) {
    const x = PAGE_WIDTH - MARGIN - 340;
    const final = index === totals.length - 1;
    box(page, x, top, 340, totalRowHeight, final ? "#dff0f2" : index % 2 ? PALE : "#ffffff");
    await put(page, label, x + 106, top + (invoice ? 7 : 10), 224, invoice ? 9.5 : 10);
    await put(page, money(value), x + 10, top + (invoice ? 6 : 9), 92, final ? invoice ? 12 : 13 : 10, INK, "left");
    top += totalRowHeight;
  }
  if (invoicePolicy.length) {
    top += 12;
    const policyTitle = singlePolicy && invoice ? invoice.sales_policy[0].title : "سياسة البيع";
    if (policyTitle) { await put(page, policyTitle, MARGIN, top, CONTENT, 10, TEAL); top += 20; }
    for (const [column, blocks] of [invoicePolicy.slice(0, policySplit), invoicePolicy.slice(policySplit)].entries()) {
      const x = singlePolicy ? MARGIN : column === 0 ? MARGIN + policyWidth + policyGap : MARGIN;
      let policyTop = top;
      for (const block of blocks) {
        draw(page, block, x, policyTop, policyWidth);
        policyTop += block.height + 3;
      }
    }
  }
  // The sales policy always travels inside the PDF, including forwarded copies.
  if (!invoice) { page = await newPage("سياسة البيع"); top = 132; }
  const sections = invoice ? [] : [...(quote.terms ? [{ title: "شروط العرض الإضافية", body: quote.terms }] : []), ...policy];
  for (const section of sections) {
    const title = await text(section.title, CONTENT - 20, 12, TEAL);
    // Paragraphs are laid out individually so long additional conditions paginate.
    const paragraphs = section.body.match(/[^\n]{1,280}(?:\s|$)|[^\n]{1,280}/g) || [section.body];
    if (top + title.height + 45 > 755) { page = await newPage("سياسة البيع"); top = 132; }
    draw(page, title, MARGIN + 10, top, CONTENT - 20); top += title.height + 5;
    for (const paragraph of paragraphs) {
      const block = await text(paragraph.trim(), CONTENT - 20, 10);
      if (top + block.height > 755) { page = await newPage("سياسة البيع"); top = 132; }
      draw(page, block, MARGIN + 10, top, CONTENT - 20); top += block.height + 3;
    }
    top += 7;
  }
  for (const [index, sheet] of pdf.getPages().entries()) {
    sheet.drawLine({ start: { x: MARGIN, y: 51 }, end: { x: PAGE_WIDTH - MARGIN, y: 51 }, color: color(TEAL), thickness: .6 });
    await put(sheet, invoice?.seller.name || "شركة العنوان الحصري — Exclusive Address", 330, PAGE_HEIGHT - 39, PAGE_WIDTH - MARGIN - 330, 7.5);
    await put(sheet, `${index + 1} / ${pdf.getPageCount()}`, (PAGE_WIDTH - 55) / 2, PAGE_HEIGHT - 39, 55, 8, MUTED, "center");
    await put(sheet, `C.R: ${invoice?.seller.commercial_registration || "5850157983"}`, MARGIN, PAGE_HEIGHT - 39, 170, 8, MUTED, "left");
  }
  return pdf.save();
}
