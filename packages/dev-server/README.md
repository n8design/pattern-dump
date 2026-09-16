# @pattern-dump/dev-server

The integrator: the dev server, the corpus audit, the static build and export.

Serves the workbench, preview documents and the data API; watches the project and pushes live updates; builds the derived graphs (composition, style, style modules, diagnostics); and hosts the audit engine, `pd build` and `pd export`.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `a11y`, `build`, `config`, `contracts`, `discovery`, `hotreloader`, `renderer`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `startDevServer`, `runDiagnosticsAudit` |
| `src/routes.ts` | every HTTP route |
| `src/watch.ts` | file watching and HMR broadcasts |
| `src/preview-document.ts` | how a preview document is composed |
| `src/static-build.ts` | `pd build` |
| `src/export.ts` | `pd export` |
