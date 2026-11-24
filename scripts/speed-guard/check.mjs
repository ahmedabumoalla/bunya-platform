import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { limitFor, measurePages, MissingStats, verifyPageWeight } from "./verify-page-weight.mjs";

// Self test of حارس السرعة plus checks that it stays wired. Needs no build, no network and no secrets.
// Run before every push, and by .github/workflows/speed-guard.yml whenever one of its files changes

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(here, "../..");
const root = mkdtempSync(path.join(tmpdir(), "speed-guard-"));
const put = (file, contents) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, contents); return file; };
try {
  const config = { growthPercent: 30, growthMinKb: 80, newPublicRouteKb: 560, newRouteKb: 1240, privatePrefixes: ["/dashboard"] };
  // Measuring: compressed size of each page's first load chunks, shared chunks counted once per page
  put(path.join(root, ".next/static/chunks/a.js"), "x".repeat(200000));
  put(path.join(root, ".next/static/chunks/b.js"), randomBytes(300000));
  put(path.join(root, ".next/diagnostics/route-bundle-stats.json"), JSON.stringify([
    { route: "/", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next\\static\\chunks\\a.js"] },
    { route: "/menu/[slug]", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next\\static\\chunks\\a.js", ".next\\static\\chunks\\b.js"] },
  ]));
  const pages = measurePages(root);
  assert.ok(pages["/"] < 5, "repeated text compresses");
  assert.ok(pages["/menu/[slug]"] > 200, "the second chunk counts");

  // Limits: growth over the measured size, and fixed caps for pages that have no measurement yet
  assert.equal(limitFor("/", { "/": 100 }, config), 180);
  assert.equal(limitFor("/", { "/": 1000 }, config), 1300);
  assert.equal(limitFor("/new", {}, config), 560);
  assert.equal(limitFor("/dashboard/new", {}, config), 1240);
  assert.deepEqual(verifyPageWeight({ "/": 180 }, { "/": 100 }, config), []);
  assert.match(verifyPageWeight({ "/": 181 }, { "/": 100 }, config)[0], /\/ loads 181 KB of JavaScript, over its 180 KB limit \(measured 100 KB\)/);
  assert.match(verifyPageWeight({ "/new": 600 }, {}, config)[0], /for a new page/);

  // Missing or unknown stats never block a release, they are reported as a warning
  rmSync(path.join(root, ".next/diagnostics"), { recursive: true });
  assert.throws(() => measurePages(root), MissingStats);
  put(path.join(root, ".next/diagnostics/route-bundle-stats.json"), JSON.stringify([{ path: "/" }]));
  assert.throws(() => measurePages(root), MissingStats);

  // Wiring: layer 1 runs after every production build, the baseline covers the pages, and the GitHub jobs are in place
  const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.scripts.postbuild, "node scripts/speed-guard/verify-page-weight.mjs", "package.json postbuild must run layer 1");
  const baseline = JSON.parse(readFileSync(path.join(here, "page-weight-baseline.json"), "utf8"));
  assert.ok(Object.keys(baseline).length > 0 && Object.values(baseline).every(kb => Number.isFinite(kb)), "the baseline must hold the measured pages");
  const settings = JSON.parse(readFileSync(path.join(project, "speed-guard.config.json"), "utf8"));
  assert.ok(settings.watch.slowMs > 0 && settings.lighthouse.fixedPaths.length > 0);
  for (const route of settings.lighthouse.fixedPaths) {
    const budget = settings.lighthouse.budgetsByPath[route];
    for (const key of ["lcpMs", "ttfbMs", "totalKb", "score"]) {
      assert.ok(Number.isFinite(budget?.[key]) && budget[key] > 0, `Missing ${key} budget for ${route}`);
    }
  }
  for (const [file, line] of [["speed-guard.yml", "run: node scripts/speed-guard/check.mjs"], ["speed-guard-watch.yml", "run: node scripts/speed-guard/watch.mjs"], ["speed-guard-deploy.yml", "run: node scripts/speed-guard/lighthouse.mjs"]]) {
    const workflow = path.join(project, ".github/workflows", file);
    assert.ok(readFileSync(workflow, "utf8").includes(line), `${file} must run its layer`);
  }
  // Guard visits never count in the project's statistics
  const statistics = settings.statistics;
  if (statistics?.visitFile) {
    assert.match(readFileSync(path.join(project, statistics.visitFile), "utf8"), /BrandaSpeedGuard[\s\S]*Chrome-Lighthouse/);
    for (const tracker of statistics.trackers || []) assert.match(readFileSync(path.join(project, tracker), "utf8"), /if \(isSpeedGuardVisit\(\)\)/, `${tracker} must skip guard visits`);
  }
  console.log("Speed guard checks passed: page weight measuring, limits, missing stats, build wiring, GitHub jobs, statistics exclusion");
} finally {
  // This directory is created by this test and holds only its synthetic files
  rmSync(root, { recursive: true, force: true });
}
