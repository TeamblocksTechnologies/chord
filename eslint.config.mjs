import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/.build/**",
    "**/out/**",
    "**/dist/**",
    "**/.svelte-check/**",
    "**/tests/integration/.*/**",
    "artifacts/**",
    "work/**",
    "docs/handoffs/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // These are design choices: caches need not be reactive, and some lists intentionally use index identity.
      "svelte/prefer-svelte-reactivity": "off",
      "svelte/require-each-key": "off",
      // Keep explicit snippet structure and let svelte-check validate compiler suppression comments.
      "svelte/no-useless-children-snippet": "off",
      "svelte/no-unused-svelte-ignore": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.svelte", "packages/ui/src/**", "apps/desktop/src/**/renderer/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ["**/*.svelte"],
    // Assignments to $bindable props are observed by parent components.
    rules: { "no-useless-assignment": "off" },
  },
  prettier,
);
