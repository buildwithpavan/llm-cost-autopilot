import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";

const vendorSdkPaths = [
  { name: "openai", message: "Vendor SDKs are only allowed inside packages/providers/src/openai/*." },
  { name: "@anthropic-ai/sdk", message: "Vendor SDKs are only allowed inside packages/providers/src/anthropic/*." },
];

const noVendorEverywhere = ["error", { paths: vendorSdkPaths }];

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/*.cjs", "**/*.mjs"] },
  js.configs.recommended,
  {
    files: ["packages/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: "module" },
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        NodeJS: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        fetch: "readonly",
        RequestInit: "readonly",
        BodyInit: "readonly",
        URLSearchParams: "readonly",
        structuredClone: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin, import: importPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
    },
  },
  {
    files: [
      "packages/core/**/*.ts",
      "packages/persistence/**/*.ts",
      "packages/api/**/*.ts",
      "packages/cli/**/*.ts",
    ],
    rules: { "no-restricted-imports": noVendorEverywhere },
  },
  {
    files: ["packages/providers/src/openai/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "@anthropic-ai/sdk", message: "Only the anthropic adapter may import @anthropic-ai/sdk." }] },
      ],
    },
  },
  {
    files: ["packages/providers/src/anthropic/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "openai", message: "Only the openai adapter may import openai." }] },
      ],
    },
  },
  {
    files: [
      "packages/providers/src/abstraction/**/*.ts",
      "packages/providers/src/contract-tests/**/*.ts",
      "packages/providers/src/mock/**/*.ts",
      "packages/providers/src/registry.ts",
      "packages/providers/src/index.ts",
    ],
    rules: { "no-restricted-imports": noVendorEverywhere },
  },
  {
    files: ["packages/**/test/**/*.ts", "packages/**/bench/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": "off",
    },
  },
];
