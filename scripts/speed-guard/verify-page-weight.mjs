import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// حارس السرعة, layer 1: runs after the production build (postbuild) and stops it when a page's first load
// JavaScript, compressed as browsers receive it, grows far beyond its measured size. It reads the build output only
// and changes nothing in the platform. `--update` rewrites the baseline: run it only when the user accepts the
// measured growth, and write the reason in the commit message. Never delete the guard to ship a release.

const here = path.dirname(fileURLToPath(import.meta.url));
const KB = 1024;
export const BASELINE_FILE = path.join(here, "page-weight-baseline.json");

export function loadConfig(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, "speed-guard.config.json"), "utf8")).pageWeight;
}

/** The build did not leave the stats this layer reads (a newer Next.js may move them). The release is not blocked for it */
export class MissingStats extends Error {}

/** Compressed first load JavaScript of every page, in KB, from the stats Next.js writes during the build */
export function measurePages(root = process.cwd()) {
  const file = path.join(root, ".next/diagnostics/route-bundle-stats.json");
  if (!existsSync(file)) throw new MissingStats("route-bundle-stats.json is missing");
  let stats;
  try {
    stats = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new MissingStats("route-bundle-stats.json could not be read");
  }
  if (!Array.isArray(stats) || !stats.length) throw new MissingStats("route-bundle-stats.json holds no pages");
  const sizes = new Map();
  const size = chunk => {
    const absolute = path.resolve(root, chunk.replaceAll("\\", "/"));
    if (!existsSync(absolute)) throw new MissingStats("A first-load chunk is missing");
    if (!sizes.has(absolute)) sizes.set(absolute, gzipSync(readFileSync(absolute)).length);
    return sizes.get(absolute);
  };
  const pages = {};
  for (const entry of stats) {
    if (typeof entry.route !== "string" || !Array.isArray(entry.firstLoadChunkPaths)) throw new MissingStats("route-bundle-stats.json has a format this guard does not know");
    pages[entry.route] = Math.round(entry.firstLoadChunkPaths.reduce((sum, chunk) => sum + size(chunk), 0) / KB);
  }
  return pages;
}

const isPrivate = (route, config) => config.privatePrefixes.some(prefix => route === prefix || route.startsWith(`${prefix}/`));
export const limitFor = (route, baseline, config) => {
  if (baseline[route] === undefined) return isPrivate(route, config) ? config.newRouteKb : config.newPublicRouteKb;
  return Math.round(baseline[route] + Math.max(baseline[route] * config.growthPercent / 100, config.growthMinKb));
};

export function verifyPageWeight(pages, baseline, config) {
  const problems = [];
  for (const [route, kb] of Object.entries(pages)) {
    const limit = limitFor(route, baseline, config);
    if (kb > limit) problems.push(`${route} loads ${kb} KB of JavaScript, over its ${limit} KB limit${baseline[route] === undefined ? " for a new page" : ` (measured ${baseline[route]} KB)`}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pages = measurePages();
    if (process.argv.includes("--update")) {
      writeFileSync(BASELINE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
      console.log(`[speed-guard] baseline written for ${Object.keys(pages).length} pages`);
      process.exit(0);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    const problems = verifyPageWeight(pages, baseline, loadConfig());
    const largest = Object.entries(pages).sort((a, b) => b[1] - a[1])[0];
    if (problems.length) {
      console.error([
        `[speed-guard] ${problems.length} page(s) grew too heavy, the build is stopped and production keeps its current version`,
        ...problems.slice(0, 12).map(problem => `  - ${problem}`),
        problems.length > 12 ? `  - and ${problems.length - 12} more` : "",
        "How to fix: find what the page newly sends to the browser (a large library imported in a client component, server code pulled into the client)",
        "and load it lazily or keep it on the server. Update the baseline only when the user accepts the measured growth",
      ].filter(Boolean).join("\n"));
      process.exit(1);
    }
    console.log(`[speed-guard] ${JSON.stringify({ pages: Object.keys(pages).length, largestKb: largest[1], largestPage: largest[0], problems: 0 })}`);
  } catch (error) {
    if (error instanceof MissingStats) {
      console.warn(`[speed-guard] WARNING layer 1 skipped: ${error.message}. The release goes on; update this guard to read the new build stats`);
      process.exit(0);
    }
    console.error(`[speed-guard] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
