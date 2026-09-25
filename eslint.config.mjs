import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "**/build/**",
    "next-env.d.ts",
    // Generated/native artifacts and local audit tooling are not application source.
    "**/.dart_tool/**",
    "**/.plugin_symlinks/**",
    "**/android/**",
    "**/ios/**",
    "artifacts/**",
    "coverage/**",
    "tmp/**",
    ".tmp-*/**",
    "frontend-ui-standards-skill/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
