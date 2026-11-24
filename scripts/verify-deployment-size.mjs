import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The deployment guard («الحارس»). Runs at the end of the production build and stops it when a server function
// carries files it never reads or passes its size limit, so production keeps its current version.
// It reads the Next.js route traces only and changes nothing. Settings live in deployment-guard.config.json.
// Origin: on Branda (2026-11-21) one variable path packed the whole public folder into 123 functions and builds
// grew from 1 to 23 minutes. Never remove, disable or bypass this guard, and never raise a limit to ship a release.

const MB = 1024 * 1024;
const IMAGE = /\.(?:png|jpe?g|webp|gif|avif|svg|ico)$/i;
const slash = value => value.replaceAll("\\", "/");

export const DEFAULTS = {
  // Files that server code reads from public by a fixed path. Add one only together with the code that reads it
  fixedPublicFiles: [],
  // Route prefixes (as they appear under .next/server/app or pages, such as "api/logo/") allowed to carry public images
  imageRoutePrefixes: [],
  // Write the measured numbers next to any change: limits are measured size plus a margin, never a way to ship
  limits: { routeMb: 140, imageRouteMb: 230, totalMb: 12000 },
};

export function loadConfig(root = process.cwd()) {
  const file = path.join(root, "deployment-guard.config.json");
  const own = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return { ...DEFAULTS, ...own, limits: { ...DEFAULTS.limits, ...(own.limits || {}) } };
}

function walk(directory, keep) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file, keep);
    return entry.isFile() && keep(entry.name) ? [file] : [];
  });
}

export function verifyDeploymentSize(root = process.cwd(), config = loadConfig(root)) {
  const bases = [".next/server/app", ".next/server/pages"].map(dir => path.join(root, dir)).filter(dir => existsSync(dir));
  if (!bases.length) throw new Error("Production route traces are missing, run the production build first");
  const traces = bases.flatMap(base => walk(base, name => name.endsWith(".nft.json")).map(file => ({ base, file })));
  if (!traces.length) throw new Error("No production route traces found");
  const fixed = new Set(config.fixedPublicFiles);
  const sizes = new Map();
  const size = file => {
    if (!sizes.has(file)) sizes.set(file, existsSync(file) ? statSync(file).size : 0);
    return sizes.get(file);
  };
  const problems = [];
  let total = 0;
  let largest = { route: "", bytes: 0 };

  for (const { base, file: trace } of traces) {
    const route = slash(path.relative(base, trace)).replace(/\.js\.nft\.json$/, "");
    const content = JSON.parse(readFileSync(trace, "utf8"));
    if (content.version !== 1 || !Array.isArray(content.files)) throw new Error(`Unsupported file trace: ${trace}`);
    const imageRoute = config.imageRoutePrefixes.some(prefix => route.startsWith(prefix));
    const stray = [];
    let bytes = 0;
    let strayBytes = 0;
    for (const value of content.files) {
      const absolute = path.resolve(path.dirname(trace), value);
      const relative = slash(path.relative(root, absolute));
      bytes += size(absolute);
      if (!relative.startsWith("public/")) continue;
      if (fixed.has(relative) || (imageRoute && IMAGE.test(relative))) continue;
      stray.push(relative);
      strayBytes += size(absolute);
    }
    total += bytes;
    if (bytes > largest.bytes) largest = { route, bytes };
    if (stray.length) problems.push(`${route} packs ${stray.length} public files (${Math.round(strayBytes / MB)} MB) it never reads, for example ${stray.slice(0, 3).join(", ")}`);
    const limit = imageRoute ? config.limits.imageRouteMb : config.limits.routeMb;
    if (bytes > limit * MB) problems.push(`${route} is ${Math.round(bytes / MB)} MB, over its ${limit} MB limit`);
  }
  if (total > config.limits.totalMb * MB) problems.push(`All routes together are ${Math.round(total / MB)} MB, over the ${config.limits.totalMb} MB limit`);

  const result = { routes: traces.length, totalMb: Math.round(total / MB), largestMb: Math.round(largest.bytes / MB), largestRoute: largest.route, problems: problems.length };
  if (problems.length) {
    throw new Error([
      `[deployment-size] ${problems.length} problem(s), the build is stopped and production keeps its current version`,
      ...problems.slice(0, 12).map(problem => `  - ${problem}`),
      problems.length > 12 ? `  - and ${problems.length - 12} more` : "",
      "How to fix: keep large media out of public (host videos in storage and link them), never read public through a variable path in server code,",
      "and list a file read by a fixed path in deployment-guard.config.json and in the outputFileTracingIncludes of next.config",
    ].filter(Boolean).join("\n"));
  }
  console.log(`[deployment-size] ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyDeploymentSize(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
