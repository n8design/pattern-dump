# @pattern-dump/config

Loads and types pattern-dump.config.ts / .json.

Resolves the project config (TypeScript wins over JSON) and defines `PatternDumpConfig` and `defineConfig`, which the published package re-exports.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `PatternDumpConfig`, `defineConfig`, the styles, themes, assets and shell config types |
