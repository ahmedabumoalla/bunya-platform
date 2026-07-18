import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["src/app", "src/components", "src/lib"];
const extensions = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const forbiddenNames = /(?:blue|sky|cyan|teal|turquoise|light-blue)/i;
const forbiddenUtility = /(?:^|\s)(?:text|fill|stroke)-(?:blue|sky|cyan|teal|turquoise|light-blue)-[^\s"'`}]+/gi;
const arbitraryForegroundUtility = /(?:^|\s)(?:text|fill|stroke)-\[([^\]]+)\]/gi;
const foregroundDeclaration = /(?:^|[;{,])\s*(color|fill|stroke|caret-color|accent-color|outline(?:-color)?)\s*:\s*([^;}\n]+)/gim;
const foregroundAttribute = /\b(fill|stroke)\s*=\s*["'{]([^"'}]+)["'}]/gim;

const violations = [];

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function parseHex(value) {
  const match = value.match(/#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})\b/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((character) => character + character).join("");
  if (hex.length === 8) hex = hex.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function parseRgb(value) {
  const match = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isForbiddenHue(rgb) {
  if (!rgb) return false;
  const [red, green, blue] = rgb.map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta < 0.08) return false;

  let hue = 0;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  if (hue < 0) hue += 360;

  const lightness = (maximum + minimum) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return hue >= 165 && hue <= 260 && saturation >= 0.18;
}

function foregroundIsForbidden(value) {
  return forbiddenNames.test(value) || isForbiddenHue(parseHex(value) ?? parseRgb(value));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else if (extensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function addViolation(file, source, index, kind, value) {
  violations.push({ file: file.replaceAll("\\", "/"), line: lineNumber(source, index), kind, value: value.trim() });
}

for (const root of roots) {
  for (const file of await collectFiles(root)) {
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(forbiddenUtility)) {
      addViolation(file, source, match.index, "utility", match[0]);
    }

    for (const match of source.matchAll(arbitraryForegroundUtility)) {
      if (foregroundIsForbidden(match[1])) addViolation(file, source, match.index, "utility", match[0]);
    }

    for (const match of source.matchAll(foregroundDeclaration)) {
      if (foregroundIsForbidden(match[2])) addViolation(file, source, match.index, match[1], match[2]);
    }

    for (const match of source.matchAll(foregroundAttribute)) {
      if (foregroundIsForbidden(match[2])) addViolation(file, source, match.index, match[1], match[2]);
    }
  }
}

if (violations.length) {
  console.error(`فشل فحص ألوان الواجهة: ${violations.length} مخالفات Foreground.`);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} [${violation.kind}] ${violation.value}`);
  }
  process.exitCode = 1;
} else {
  console.log("نجح فحص ألوان الواجهة: 0 مخالفات Foreground زرقاء أو سماوية.");
}
