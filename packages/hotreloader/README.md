# @pattern-dump/hotreloader

Live-reload core: a WebSocket server and the messages that update the workbench.

Pushes HMR messages (content swaps, stylesheet swaps, tree changes, errors) from the dev server to connected workbenches.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `createHotReloader`: the WebSocket server, `push()` and its `listening` promise |
