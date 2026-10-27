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
    // сборка фронта для Playwright (NEXT_DIST_DIR)
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // отчёт vitest --coverage
    "coverage/**",
  ]),
]);

export default eslintConfig;
