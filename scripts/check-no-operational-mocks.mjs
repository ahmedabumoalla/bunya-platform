import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.cwd(), "src");
const allowedPreferenceStorage = new Set([
  "components/ThemeToggle.tsx",
  "components/PwaInstallPrompt.tsx",
  "components/admin/AdminShell.tsx",
  "components/customer/CustomerShell.tsx",
  "components/provider/ProviderShell.tsx",
  "components/contractor/ContractorShell.tsx",
]);
const operationalMockImport = /(?:from\s+["'][^"']*|import\s*\(["'][^"']*)(?:mock|fixture|seed|admin-(?:data|storage|adapters)|customer-(?:data|storage)|provider-(?:data|storage)|contractor-(?:data|storage)|driver-storage|project-request-(?:data|storage)|sourcing-(?:data|storage|engine)|bunya-(?:data|contractors))/i;
const demoCollection = /\b(?:mock|fake|fixture|seed)(?:Data|Items|Records|Collection|Products|Services|Notifications|Portfolio|Settlements)?\b/i;
const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name))) await inspect(path);
  }
}

async function inspect(path) {
  const name = relative(root, path).replaceAll("\\", "/");
  const source = await readFile(path, "utf8");
  if ((source.includes("localStorage") || source.includes("sessionStorage")) && !allowedPreferenceStorage.has(name)) {
    failures.push(`${name}: operational browser storage is forbidden`);
  }
  if (operationalMockImport.test(source)) failures.push(`${name}: imports a retired mock/data-storage module`);
  if (name.startsWith("app/") && demoCollection.test(source)) failures.push(`${name}: contains a demo/mock collection marker`);
}

await walk(root);
if (failures.length) {
  console.error("Operational mock/localStorage guard failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Operational mock/localStorage guard passed.");
