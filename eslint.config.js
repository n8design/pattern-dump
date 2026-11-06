// ESLint 9 flat config — the single config for the whole workspace.
//
// One root config is enough: every package's script is `eslint src` run with `cwd` set to that
// package directory, and ESLint 9 walks up to the nearest config. Adding per-package configs
// would duplicate this for no gain.
//
// Non-type-aware on purpose. `tseslint.configs.recommended` covers the rules this codebase
// actually needs without requiring a resolvable TS project per package. Type-aware linting
// (`projectService`) is a separate, larger decision — it needs tsconfig plumbing and surfaces a
// much wider rule set.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, vendored trees, and the dogfooding corpus are not ours to lint.
    // test-bench/ is a fixture design system; bench/ and .htwoo-src/ are foreign or generated.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "test-bench/**",
      "**/*.generated.*",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // `no-unused-vars` is handled by the TS-aware rule; the base rule double-reports on types.
    // Allow the leading-underscore convention for deliberately unused bindings.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // Node-run files: the workspace is ESM everywhere, but these execute in Node rather than the
    // browser, so they need Node globals (console, URL, process) declared.
    files: ["**/*.mjs", "**/scripts/**/*.{ts,mjs}", "*.config.{js,ts}", "**/vitest.config.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    // The dev-ui bundle runs in the browser.
    files: ["apps/dev-ui/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    // Package sources run in Node.
    files: ["packages/*/src/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    // axe-core ships CJS; these two sites are deliberate ESM->CJS interop, not an oversight.
    // Scoped override rather than two inline disables, so the reason lives in one place.
    files: ["packages/a11y/src/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  {
    // Playwright specs run in a browser context via page.evaluate, where DOM globals are typed
    // loosely at the boundary. Kept as a narrow allowance rather than weakening the rule globally.
    files: ["apps/dev-ui/e2e/**/*.ts", "storefront-bench/e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },

  // ─── Dependency direction ──────────────────────────────────────────────────
  //
  // CONTRIBUTING.md calls dependency direction a hard rule, but nothing enforced it. tsconfig.base.json
  // aliases every @pattern-dump/* to that package's src/index.ts, so an illegal import resolves
  // and typechecks happily; there was no @nx/enforce-module-boundaries, no depConstraints and no
  // no-restricted-imports anywhere. The law was upheld by review alone.
  //
  // dev-ui complies today. This makes it stay that way.
  {
    files: ["apps/dev-ui/src/**/*.ts", "apps/dev-ui/e2e/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            // docs/development/architecture.md (dev-ui row): "Build-time dependency: contracts only (types); never
            // imports dev-server internals." Runtime contact is HTTP + the HMR socket.
            group: [
              "@pattern-dump/a11y", "@pattern-dump/build", "@pattern-dump/cli",
              "@pattern-dump/config", "@pattern-dump/core", "@pattern-dump/dev-server",
              "@pattern-dump/discovery", "@pattern-dump/hotreloader", "@pattern-dump/renderer",
            ],
            message:
              "dev-ui's only build-time dependency is @pattern-dump/contracts. It talks to the " +
              "dev-server at runtime over HTTP/socket, never by import (docs/development/architecture.md, dev-ui row).",
          },
          {
            // A relative path out of the app is the same violation wearing a disguise.
            group: ["**/packages/*/src/**", "../../../packages/**"],
            message: "Reaching into another package's source by relative path bypasses the seam.",
          },
        ],
      }],
    },
  },

  // ─── UI region boundaries ──────────────────────────────────────────────────
  //
  // Inert until the region directories exist; deliberately landed FIRST so the invariant is
  // mechanical from the first region module rather than a comment someone later contradicts.
  //
  // Regions may import core/ and shared leaves, never each other. The graph would otherwise cycle
  // immediately: navigation calls setActiveTreeItem (rail) while the tree's click handler calls
  // navigate. That stays acyclic only because the wiring lives in one place — so wiring.ts owns
  // every cross-region edge, and regions stay leaves.
  ...["rail", "inspector", "dock", "stage"].map((region) => ({
    files: [`apps/dev-ui/src/${region}/**/*.ts`],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["rail", "inspector", "dock", "stage"]
              .filter((other) => other !== region)
              .flatMap((other) => [`../${other}/*`, `../${other}/**`]),
            message:
              "A UI region must not import another region. Regions import core/ only; " +
              "app/ owns every cross-region edge.",
          },
          {
            group: ["../app/*", "../app/**"],
            message:
              "A region must not import app/. app/ orchestrates the regions; if a region imported it " +
              "back, the graph would cycle through the orchestrator.",
          },
        ],
      }],
    },
  })),

  // ─── Layering: core -> regions -> app ──────────────────────────────────────
  //
  // Three layers, and the direction only runs one way:
  //   core/     the substrate: shared state (session), DOM refs, the store, pure helpers.
  //             Imports NOTHING outside core/. This is the invariant that makes it safe for every
  //             region to depend on it.
  //   regions   rail/ inspector/ dock/ stage/ — import core/ only (rule above).
  //   app/      the orchestrators: navigation, routing, HMR, wiring, bootstrap. Genuinely need to
  //             call into several regions at once (applyComponent alone touches four), so they
  //             cannot live in core/ without dissolving core's leaf property.
  //
  // Nothing but main.ts imports app/.
  {
    files: ["apps/dev-ui/src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["rail", "inspector", "dock", "stage", "app"].flatMap((d) => [`../${d}/*`, `../${d}/**`]),
          message:
            "core/ is the leaf substrate every region depends on. It must not import a region or " +
            "app/, or those dependencies stop being one-directional.",
        }],
      }],
    },
  },
);
