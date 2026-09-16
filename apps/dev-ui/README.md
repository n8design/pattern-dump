# @pattern-dump/dev-ui

The Pattern Dump workbench: the browser app with the Nav Rail, Stage, Inspector and Console.

**Internal package.** Its built bundle (`dist/main.js`, `dist/main.css`) ships inside the published
`pattern-dump` package and is served by the dev server. See the [architecture](../../docs/development/architecture.md)
and the [styling guide](../../docs/development/styling.md).

**Depends on:** `@pattern-dump/contracts` (types only). It talks to the dev server over HTTP and the
live-reload WebSocket and never imports another package; ESLint enforces this.

| Folder | What it holds |
|---|---|
| `src/core/` | Session state, DOM references, the view-state store, the static-build runtime |
| `src/rail/`, `src/stage/`, `src/inspector/`, `src/dock/` | The four regions; each imports `core/` only |
| `src/app/` | Navigation, routing, live reload and bootstrap: the only layer that connects regions |
| `src/styles/` | The shell's SCSS, by layer |
| `e2e/` | The Playwright suite (`npm run e2e` from the repository root) |
