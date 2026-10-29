import type { AppLocale } from "./config";
import { messages, statusKeys, translate, type MessageKey } from "./messages";
import generatedLiteralTranslations from "./literal-translations.generated.json";
import productChangeTranslations from "./product-change-literals.json";
import phoneVerificationTranslations from "./phone-verification-literals.json";

const arabicLiteralKeys = Object.fromEntries(
  Object.entries(messages.ar).map(([key, value]) => [value, key]),
) as Record<string, MessageKey>;

const generatedLiterals = {
  ...generatedLiteralTranslations,
  ...productChangeTranslations,
  ...phoneVerificationTranslations,
} as Record<
  string,
  Partial<Record<AppLocale, string>>
>;

const generatedLiteralSources = Object.keys(generatedLiterals)
  .filter((source) => source.length > 1)
  .sort((left, right) => right.length - left.length);

function normalizeLiteral(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function preserveOuterWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

const localizedDigitSets: Record<Exclude<AppLocale, "ar">, string> = {
  en: "0123456789",
  ur: "۰۱۲۳۴۵۶۷۸۹",
  hi: "०१२३४५६७८९",
  bn: "০১২৩৪৫৬৭৮৯",
  fil: "0123456789",
};

function localizeNumerals(locale: Exclude<AppLocale, "ar">, value: string): string {
  const digits = localizedDigitSets[locale];
  return value
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
      const code = digit.charCodeAt(0);
      const index = code >= 0x06f0 ? code - 0x06f0 : code - 0x0660;
      return digits[index] ?? digit;
    })
    .replaceAll("٬", locale === "ur" ? "،" : ",")
    .replaceAll("٫", ".");
}

export function translateLiteral(locale: AppLocale, value: string): string {
  if (locale === "ar") return value;
  const normalized = normalizeLiteral(value);
  if (!normalized) return value;
  if (!/[\u0600-\u06ff]/.test(normalized)) return value;

  const key = arabicLiteralKeys[normalized];
  if (key) return preserveOuterWhitespace(value, localizeNumerals(locale, translate(locale, key)));

  const status = statusKeys[normalized];
  if (status) return preserveOuterWhitespace(value, localizeNumerals(locale, translate(locale, status)));

  const generated = generatedLiterals[normalized]?.[locale];
  if (generated) return preserveOuterWhitespace(value, localizeNumerals(locale, generated));

  let translated = normalized;
  for (const source of generatedLiteralSources) {
    const replacement = generatedLiterals[source]?.[locale];
    if (replacement && translated.includes(source)) {
      translated = translated.replaceAll(source, replacement);
    }
  }
  const localized = localizeNumerals(locale, translated);
  return localized === normalized
    ? value
    : preserveOuterWhitespace(value, localized);
}

export function observeLiteralTranslations(locale: AppLocale): () => void {
  if (locale === "ar") return () => {};
  const translateElement = (root: ParentNode) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script,style,[data-no-localize]") || !node.nodeValue?.trim()) continue;
      const next = translateLiteral(locale, node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    if (root instanceof Element) {
      for (const attribute of ["placeholder", "title", "aria-label"] as const) {
        const current = root.getAttribute(attribute);
        if (!current) continue;
        const next = translateLiteral(locale, current);
        if (next !== current) root.setAttribute(attribute, next);
      }
    }
    root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach((element) => {
      for (const attribute of ["placeholder", "title", "aria-label"] as const) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        const next = translateLiteral(locale, current);
        if (next !== current) element.setAttribute(attribute, next);
      }
    });
  };
  translateElement(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData" && record.target.parentNode) {
        translateElement(record.target.parentNode);
        continue;
      }
      if (record.type === "attributes" && record.target instanceof Element) {
        translateElement(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element || node instanceof DocumentFragment) translateElement(node);
        else if (node.nodeType === Node.TEXT_NODE && node.parentNode) translateElement(node.parentNode);
      }
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
