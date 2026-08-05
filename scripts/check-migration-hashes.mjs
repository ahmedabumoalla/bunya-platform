import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const manifest = JSON.parse(await readFile("scripts/migration-hashes.json", "utf8"));
const files = (await readdir("supabase/migrations")).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
assert.deepEqual(files, Object.keys(manifest), "migration set changed; add only a new forward migration and update the manifest intentionally");
for (const file of files) {
  const bytes = await readFile(`supabase/migrations/${file}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, manifest[file], `${file} changed after its historical hash was recorded`);
}
console.log(`Migration hash guard passed: ${files.length} immutable migration hashes verified.`);
