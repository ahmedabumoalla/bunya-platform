import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import generatedLiteralTranslations from "../src/lib/i18n/literal-translations.generated.json" with { type: "json" };
import productChangeTranslations from "../src/lib/i18n/product-change-literals.json" with { type: "json" };
import phoneVerificationTranslations from "../src/lib/i18n/phone-verification-literals.json" with { type: "json" };

const projectRoot = path.resolve(import.meta.dirname, "..");
const requiredLocales = ["en", "ur", "hi", "bn", "fil"];

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["api", "node_modules", ".next"].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, output);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes("literal-translations.generated")) {
      output.push(entryPath);
    }
  }
  return output;
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

const sourceLiterals = new Set();
for (const file of walk(path.join(projectRoot, "src"))) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const value = normalize(node.text);
      if (/[\u0600-\u06ff]/.test(value) && value.length <= 500) sourceLiterals.add(value);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

const missing = [];
for (const source of sourceLiterals) {
  const entry = phoneVerificationTranslations[source] ?? productChangeTranslations[source] ?? generatedLiteralTranslations[source];
  for (const locale of requiredLocales) {
    if (!entry?.[locale]?.trim()) missing.push({ source, locale });
  }
}

if (missing.length) {
  console.error(`Localization coverage failed: ${missing.length} translations are missing.`);
  for (const item of missing.slice(0, 30)) console.error(`${item.locale}: ${item.source}`);
  process.exit(1);
}

console.log(
  `Localization coverage passed: ${sourceLiterals.size} Arabic UI literals × ${requiredLocales.length} target locales.`,
);
