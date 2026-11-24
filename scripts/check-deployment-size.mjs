import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, verifyDeploymentSize } from "./verify-deployment-size.mjs";

// Self test of the deployment guard («الحارس») plus checks that it stays wired. Needs no build and no secrets.
// Run before every push, and by .github/workflows/deployment-guard.yml whenever a wiring file changes.

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(here, "..");
const root = mkdtempSync(path.join(tmpdir(), "deployment-guard-"));
const put = (file, contents) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, contents); return file; };
const trace = (name, dependencies) => {
  const file = path.join(root, ".next/server/app", name, "route.js.nft.json");
  put(file, JSON.stringify({ version: 1, files: dependencies.map(dep => path.relative(path.dirname(file), dep).replaceAll("\\", "/")) }));
  return file;
};
try {
  const config = { fixedPublicFiles: ["public/fonts/body.ttf"], imageRoutePrefixes: ["api/logo/"], limits: { routeMb: 1, imageRouteMb: 1, totalMb: 1 } };
  const chunk = put(path.join(root, ".next/server/chunks/page.js"), "export const value = 1;");
  const font = put(path.join(root, "public/fonts/body.ttf"), "font");
  const logo = put(path.join(root, "public/logos/brand.png"), "image");
  const video = put(path.join(root, "public/guides/lesson.mp4"), "video");
  const page = trace("dashboard", [chunk, font]);
  trace("api/logo/[slug]", [chunk, font, logo]);
  const before = readFileSync(page, "utf8");
  assert.equal(verifyDeploymentSize(root, config).problems, 0);
  assert.equal(readFileSync(page, "utf8"), before, "The guard never rewrites a trace");

  // The original fault: a route carrying public files it never reads
  trace("dashboard", [chunk, font, logo, video]);
  assert.throws(() => verifyDeploymentSize(root, config), /dashboard\/route packs 2 public files/);
  trace("dashboard", [chunk, font]);
  trace("api/logo/[slug]", [chunk, font, logo, video]);
  assert.throws(() => verifyDeploymentSize(root, config), /api\/logo\/\[slug\]\/route packs 1 public files/);
  trace("api/logo/[slug]", [chunk, font, logo]);

  // Size limits per route and for the whole deployment
  const heavy = put(path.join(root, ".next/server/chunks/heavy.js"), Buffer.alloc(1024 * 1024 + 1));
  trace("reports", [heavy]);
  assert.throws(() => verifyDeploymentSize(root, config), /reports\/route is 1 MB, over its 1 MB limit/);
  assert.throws(() => verifyDeploymentSize(root, { ...config, limits: { routeMb: 5, imageRouteMb: 5, totalMb: 1 } }), /All routes together/);
  put(path.join(root, ".next/server/app/broken/route.js.nft.json"), JSON.stringify({ version: 2, files: [] }));
  assert.throws(() => verifyDeploymentSize(root, config), /Unsupported file trace/);

  // Wiring 1: the production build script ends with the guard
  const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
  assert.match(pkg.scripts?.build || "", /&& node scripts\/verify-deployment-size\.mjs$/, "package.json build must end with the guard");
  // Wiring 2, independent: the host runs the guard again, so an old package.json copied over this one cannot silence it
  const vercelFile = path.join(project, "vercel.json");
  assert.match(JSON.parse(readFileSync(vercelFile, "utf8")).buildCommand || "", /&& node scripts\/verify-deployment-size\.mjs$/, "vercel.json buildCommand must end with the guard");
  // The tracing fix: public stays out of every function, and fixed files are included back
  const nextConfig = ["next.config.ts", "next.config.mjs", "next.config.js"].map(name => path.join(project, name)).find(existsSync);
  if (nextConfig) {
    const text = readFileSync(nextConfig, "utf8");
    assert.match(text, /outputFileTracingExcludes[\s\S]*"\.\/public\/\*\*\/\*"/, "next.config must exclude ./public/**/* from every function");
    for (const file of loadConfig(project).fixedPublicFiles) assert.ok(text.includes(`"./${file}"`), `${file} must be in outputFileTracingIncludes`);
  }
  // The sparse checkout includes the workflow so a missing GitHub check also fails locally.
  const workflow = path.join(project, ".github/workflows/deployment-guard.yml");
  assert.ok(readFileSync(workflow, "utf8").includes("run: node scripts/check-deployment-size.mjs"), "The GitHub check must run this test");
  console.log("Deployment guard checks passed: stray public files, route and total limits, read-only guard, build wiring");
} finally {
  // This directory is created by this test and holds only its synthetic files
  rmSync(root, { recursive: true, force: true });
}
