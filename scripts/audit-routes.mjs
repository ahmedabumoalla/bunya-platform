import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  return nested.flat();
}

const appFiles = (await walk("src/app")).filter((file) => /\.(tsx?|jsx?)$/.test(file));
const pages = appFiles.filter((file) => file.endsWith(`${path.sep}page.tsx`));
assert.ok(pages.length > 0, "no application routes found");
const operationalPattern = /\b(?:localStorage|sessionStorage)\b|(?:from|import\s*\()\s*["'][^"']*(?:mock|fixture)[^"']*["']/i;
for (const file of appFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, operationalPattern, `${file}: operational mock/storage source`);
}
for (const [area, role] of Object.entries({ customer: "customer", merchant: "provider", contractor: "contractor", driver: "driver", admin: "admin" })) {
  const layout = await readFile(`src/app/${area}/layout.tsx`, "utf8");
  assert.ok(layout.includes(`requirePortalRole("${role}")`), `${area}: missing server role guard`);
  assert.ok(layout.includes(`RoleDatabasePortal role="${role}"`), `${area}: missing Supabase portal`);
}
const portal = await readFile("src/components/database/RoleDatabasePortal.tsx", "utf8");
assert.match(portal, /createBrowserClient|createClient|supabase/i, "portal has no Supabase data source");
assert.match(portal, /loading|جار|تحميل/i, "portal has no loading state");
assert.match(portal, /error|خطأ|تعذر/i, "portal has no error state");
assert.match(portal, /empty|لا توجد|لا يوجد/i, "portal has no empty state");
const routeHandlers = appFiles.filter((file) => file.endsWith(`${path.sep}route.ts`));
console.log(`Route audit passed: ${pages.length} pages, ${routeHandlers.length} handlers, 5 guarded role portals; Supabase/loading/empty/error contracts present.`);
