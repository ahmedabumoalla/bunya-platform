import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb, type PDFPage, type PDFImage } from "pdf-lib";
import type { PriceQuotation } from "./price-quotation-types";
import { priceQuotationPolicy } from "./price-quotation-policy";

const PAGE_WIDTH = 595.28, PAGE_HEIGHT = 841.89, MARGIN = 28, CONTENT = PAGE_WIDTH - MARGIN * 2;
const SCALE = 3;
const INK = "#14234d", TEAL = "#087c89", MUTED = "#52647c", LINE = "#c7dee7", PALE = "#edf5f8";
const fontFile = path.join(process.cwd(), "src/app/fonts/SalmaArabic-Regular.otf");
const logoFile = path.join(process.cwd(), "public/brand/exclusive-address.png");
const escapeMarkup = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const directedText = (value: string, align: string) => escapeMarkup(align === "right" ? value.split("\n").map(line => `\u200f${line}`).join("\n") : value);
const color = (hex: string) => rgb(...([1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]));
const money = (value: number) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
type Text = { image: PDFImage; width: number; height: number };

/** Pango shapes Arabic and bidirectional text with our bundled font. Text is
 * embedded at 216dpi, while rules/backgrounds stay vector. No browser or
 * third-party rendering service receives customer data. */
export async function renderPriceQuotationPdf(quote: PriceQuotation): Promise<Uint8Array> {
  const policy = priceQuotationPolicy(quote);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`عرض سعر ${quote.quotation_code}`);
  pdf.setAuthor("شركة العنوان الحصري");
  pdf.setSubject("عرض سعر — سياسة البيع والشروط والأحكام");
  pdf.setCreationDate(new Date(quote.created_at));
  const logo = await pdf.embedPng(await readFile(logoFile));
  const cache = new Map<string, Promise<Text>>();
  async function text(value: string, width: number, size = 10, ink = INK, align: "right" | "center" | "left" = "right"): Promise<Text> {
    const key = JSON.stringify([value, width, size, ink, align]);
    if (!cache.has(key)) cache.set(key, (async () => {
      const rendered = await sharp({ text: {
        text: `<span foreground="${ink}">${directedText(value || "—", align)}</span>`,
        font: `Salma Arabic ${size}`, fontfile: fontFile, width: Math.floor(width * SCALE),
        dpi: 72 * SCALE, rgba: true, align: align === "right" ? "left" : align, wrap: "word-char", spacing: 1,
      } }).png().toBuffer({ resolveWithObject: true });
      return { image: await pdf.embedPng(rendered.data), width: rendered.info.width / SCALE, height: rendered.info.height / SCALE };
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
  async function newPage(subtitle = "عرض سعر") {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(logo, { x: PAGE_WIDTH - MARGIN - 132, y: PAGE_HEIGHT - 102, width: 132, height: 80 });
    await put(page, subtitle, 215, 42, 162, 21, INK, "center");
    await put(page, "Quotation", 215, 74, 162, 12, MUTED, "center");
    await put(page, quote.quotation_code, MARGIN, 35, 178, 11, INK, "left");
    await put(page, `تاريخ العرض: ${date(quote.created_at)}`, MARGIN, 59, 178, 9);
    await put(page, quote.valid_until ? `صالح حتى: ${date(quote.valid_until)}` : "العملة: ريال سعودي", MARGIN, 80, 178, 9);
    page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 114 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 114 }, color: color(TEAL), thickness: 1 });
    return page;
  }
  let page = await newPage(), top = 128;
  const gap = 10, half = (CONTENT - gap) / 2;
  const seller = ["شركة العنوان الحصري", "السجل التجاري: 5850157983", "الرقم الضريبي: 312872746700003", "العنوان الوطني: AKAA8043", "8043 حي الخالدية، خميس مشيط 62411", "الرقم الإضافي: 3076 — المملكة العربية السعودية"];
  const customer = [quote.customer_name || "العميل", `الجوال: ${quote.customer_phone}`, ...(quote.customer_tax_number ? [`الرقم الضريبي: ${quote.customer_tax_number}`] : []), ...(quote.customer_address ? [quote.customer_address] : []), ...(quote.source_request_code ? [`مرجع الطلب: ${quote.source_request_code}`] : [])];
  const sellerBlocks = await Promise.all(seller.map(line => text(line, half - 20, 9)));
  const customerBlocks = await Promise.all(customer.map(line => text(line, half - 20, 9)));
  const cardHeight = 44 + Math.max(...[sellerBlocks, customerBlocks].map(blocks => blocks.reduce((height, block) => height + block.height + 9, 0)));
  for (const [x, title, blocks] of [[MARGIN + half + gap, "بيانات البائع", sellerBlocks], [MARGIN, "بيانات العميل", customerBlocks]] as const) {
    box(page, x, top, half, cardHeight); box(page, x, top, half, 26, TEAL);
    await put(page, title, x + 10, top + 7, half - 20, 10, "#ffffff");
    let rowTop = top + 38;
    for (const block of blocks) { draw(page, block, x + 10, rowTop, half - 20); rowTop += block.height + 9; }
  }
  top += cardHeight + 18;
  // Left-to-right column positions, with the product description on the RTL side.
  const widths = [82, 72, 65, CONTENT - 243, 24];
  const labels = ["الإجمالي قبل الضريبة", "سعر الوحدة", "الكمية / الوحدة", "المنتج والمواصفات", "م"];
  async function tableHeader() {
    let x = MARGIN;
    for (let i = 0; i < widths.length; i++) { box(page, x, top, widths[i], 30, TEAL); await put(page, labels[i], x + 5, top + 9, widths[i] - 10, 8, "#ffffff", "center"); x += widths[i]; }
    top += 30;
  }
  if (top > 650) { page = await newPage(); top = 130; }
  await tableHeader();
  for (const [index, item] of quote.items.entries()) {
    const description = [item.product_name, ...(item.sku ? [`SKU: ${item.sku}`] : []), ...item.attributes.map(attribute => `${attribute.label}: ${attribute.value}`), ...(item.notes ? [item.notes] : [])].join("\n");
    const blocks = await Promise.all([money(item.line_total), money(item.unit_price), `${item.quantity}\n${item.unit}`, description, String(index + 1)].map((value, i) => text(value, widths[i] - 14, i === 3 ? 10 : 9, INK, i === 3 ? "right" : "center")));
    const height = Math.max(42, ...blocks.map(block => block.height + 20));
    if (top + height > 760 && top > 160) { page = await newPage(); top = 130; await tableHeader(); }
    // Very long item notes/specifications continue across pages without clipping.
    let consumed = 0;
    while (consumed < height) {
      const fragment = Math.min(height - consumed, 760 - top);
      let x = MARGIN;
      for (let i = 0; i < widths.length; i++) {
        box(page, x, top, widths[i], fragment, index % 2 ? PALE : "#ffffff");
        const block = blocks[i];
        if (consumed === 0 && block.height + 10 <= fragment) draw(page, block, x + 7, top + 10, widths[i] - 14, i === 3 ? "right" : "center");
        else if (block.height > consumed) {
          // Crop only overflowing text images; normal rows remain one PDF image.
          const raw = await sharp({ text: { text: `<span foreground="${INK}">${directedText(i === 3 ? description : [money(item.line_total), money(item.unit_price), `${item.quantity}\n${item.unit}`, "", String(index + 1)][i], i === 3 ? "right" : "center")}</span>`, font: `Salma Arabic ${i === 3 ? 10 : 9}`, fontfile: fontFile, width: Math.floor((widths[i] - 14) * SCALE), dpi: 72 * SCALE, rgba: true, align: i === 3 ? "left" : "center", wrap: "word-char", spacing: 1 } }).png().toBuffer({ resolveWithObject: true });
          const cropTop = Math.max(0, Math.round(consumed * SCALE));
          const cropHeight = Math.min(raw.info.height - cropTop, Math.floor((fragment - 10) * SCALE));
          if (cropHeight > 0) {
            const cropped = await sharp(raw.data).extract({ left: 0, top: cropTop, width: raw.info.width, height: cropHeight }).png().toBuffer();
            draw(page, { image: await pdf.embedPng(cropped), width: raw.info.width / SCALE, height: cropHeight / SCALE }, x + 7, top + 5, widths[i] - 14, i === 3 ? "right" : "center");
          }
        }
        x += widths[i];
      }
      consumed += fragment - (consumed + fragment < height ? 10 : 0); top += fragment;
      if (consumed < height) { page = await newPage(); top = 130; await tableHeader(); }
    }
  }
  if (top + 170 > 760) { page = await newPage(); top = 130; }
  top += 16;
  const totals = [["الإجمالي قبل الضريبة", quote.subtotal], ["التوصيل قبل الضريبة", quote.delivery_fee], [`ضريبة القيمة المضافة (${quote.vat_rate}٪)`, quote.vat_amount], ["الإجمالي شامل الضريبة — ر.س", quote.total]] as const;
  for (const [index, [label, value]] of totals.entries()) {
    const x = PAGE_WIDTH - MARGIN - 340;
    box(page, x, top, 340, 31, index === 3 ? "#dff0f2" : index % 2 ? PALE : "#ffffff");
    await put(page, label, x + 106, top + 10, 224, 10);
    await put(page, money(value), x + 10, top + 9, 92, index === 3 ? 13 : 10, INK, "left");
    top += 31;
  }
  // The sales policy always travels inside the PDF, including forwarded copies.
  page = await newPage("سياسة البيع"); top = 132;
  const sections = [...(quote.terms ? [{ title: "شروط العرض الإضافية", body: quote.terms }] : []), ...policy];
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
    await put(sheet, "شركة العنوان الحصري — Exclusive Address", 260, PAGE_HEIGHT - 39, CONTENT - 232, 8);
    await put(sheet, `${index + 1} / ${pdf.getPageCount()}`, 250, PAGE_HEIGHT - 39, 55, 8, MUTED, "center");
    await put(sheet, "C.R: 5850157983", MARGIN, PAGE_HEIGHT - 39, 170, 8, MUTED, "left");
  }
  return pdf.save();
}
