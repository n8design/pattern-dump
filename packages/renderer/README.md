# @pattern-dump/renderer

Renders components: Handlebars templates, the data cascade, helpers and syntax highlighting.

Merges global, component and variant data, renders templates with the built-in and project helpers, runs HTML and schema checks on the result, and highlights source with Shiki.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`, `discovery`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `createRenderer`, `deepMerge`, `highlight`, the built-in helpers |
