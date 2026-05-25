// ESLint v9 flat config.
// Goal: catch real issues without micromanaging style — Prettier owns formatting.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "specs/",
      "src/tools/generated/",
      ".remember/",
      "docs/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Type safety
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Async hygiene
      "@typescript-eslint/no-floating-promises": "off", // requires type-aware linting; off for speed
      "no-async-promise-executor": "error",
      "no-await-in-loop": "off", // sequential awaits are legitimate (token refresh, retry)

      // Modern JS
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],

      // Allow common patterns in this codebase
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Tests can be more permissive — stub objects often need `any`
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // Scripts (refresh-spec / generate / refresh-snapshot) are short utilities
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
