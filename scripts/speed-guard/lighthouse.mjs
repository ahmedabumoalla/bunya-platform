import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENT, config, riyadhTime, sendWhatsApp, summary } from "./shared.mjs";

// Mobile Lighthouse audits for the public pages following a production deployment.

const { runs, budgetsByPath } = config.lighthouse;
const lighthouse = process.env.LIGHTHOUSE_BIN || "lighthouse";
const work = mkdtempSync(path.join(tmpdir(), "speed-guard-lh-"));
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function audit(url, index) {
  const output = path.join(work, `${index}.json`);
  const cli = process.env.LIGHTHOUSE_CLI_JS;
  execFileSync(cli ? process.execPath : lighthouse, [...(cli ? [cli] : []), url, "--quiet", "--output=json", `--output-path=${output}`, "--only-categories=performance",
    `--emulated-user-agent=${AGENT} Chrome-Lighthouse`, ...(config.lighthouse.blockedUrlPatterns || []).map(pattern => `--blocked-url-patterns=${pattern}`), "--chrome-flags=--headless=new --no-sandbox --disable-gpu"], { stdio: ["ignore", "ignore", "inherit"], timeout: 180000 });
  const report = JSON.parse(readFileSync(output, "utf8"));
  const value = id => report.audits[id]?.numericValue ?? NaN;
  const finalUrl = report.finalDisplayedUrl || report.finalUrl;
  const requests = report.audits["network-requests"]?.details?.items || [];
  const document = requests.find(item => item.resourceType === "Document" && item.url === finalUrl);
  if (report.runtimeError || finalUrl !== url || !document || document.statusCode < 200 || document.statusCode >= 400) {
    throw new Error("Lighthouse could not load the requested page");
  }
  const metrics = { lcpMs: value("largest-contentful-paint"), ttfbMs: value("server-response-time"), totalKb: value("total-byte-weight") / 1024, score: Math.round((report.categories.performance.score ?? 0) * 100) };
  if (!Object.values(metrics).every(Number.isFinite)) throw new Error("Missing Lighthouse metric");
  return metrics;
}

const paths = config.lighthouse.fixedPaths;
const results = [];
let index = 0;
try {
  for (const value of paths) {
    const samples = [];
    for (let run = 0; run < runs; run++) {
      try { samples.push(audit(new URL(value, config.site).href, index++)); } catch (error) { console.log(`[speed-guard] Lighthouse run failed on ${value}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
    }
    if (samples.length !== runs) { results.push({ path: value, failed: true, problems: ["ما انفتحت الصفحة في الفحص"] }); continue; }
    const result = { path: value, lcpMs: Math.round(median(samples.map(s => s.lcpMs))), ttfbMs: Math.round(median(samples.map(s => s.ttfbMs))), totalKb: Math.round(median(samples.map(s => s.totalKb))), score: median(samples.map(s => s.score)) };
    console.log("[speed-guard] " + JSON.stringify(result));
    const budgets = budgetsByPath[value];
    result.problems = [
      result.lcpMs > budgets.lcpMs && `أكبر عنصر طلع بعد ${(result.lcpMs / 1000).toFixed(1)} ثانية والحد ${budgets.lcpMs / 1000}`,
      result.ttfbMs > budgets.ttfbMs && `السيرفر بدأ يرد بعد ${result.ttfbMs} ms والحد ${budgets.ttfbMs}`,
      result.totalKb > budgets.totalKb && `وزن الصفحة ${result.totalKb} KB والحد ${budgets.totalKb}`,
      result.score < budgets.score && `درجة الأداء ${result.score} والحد ${budgets.score}`,
    ].filter(Boolean);
    results.push(result);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const bad = results.filter(result => result.problems.length);
summary([
  "### حارس السرعة: فحص ما بعد النشر",
  "| الصفحة | أكبر عنصر | بداية الرد | الوزن | الدرجة |", "|---|---|---|---|---|",
  ...results.map(r => r.failed ? `| ${r.path} | فشل الفتح | - | - | - |` : `| ${r.path} | ${(r.lcpMs / 1000).toFixed(1)} s | ${r.ttfbMs} ms | ${r.totalKb} KB | ${r.score}${r.problems.length ? " ⚠️" : ""} |`),
]);
if (bad.length) {
  await sendWhatsApp([
    `حارس السرعة: بعد آخر نشر فيه ${bad.length} صفحة أبطأ من حدها، الساعة ${riyadhTime()}`,
    ...bad.slice(0, 5).map(r => `${r.path}\n${r.problems.join("\n")}`),
    "ما رجّعت النسخة القديمة، القرار لك",
  ].join("\n"));
  process.exit(1);
}
