# @pattern-dump/build

Build core: Sass and esbuild compilation, file watching and the SCSS dependency graph.

Compiles component and theme SCSS (with source maps for class ownership), compiles behaviour scripts with esbuild, and tracks which SCSS files depend on which.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `compileSassFile`, `compileScriptFile`, `createSassDependencyTracker` |
