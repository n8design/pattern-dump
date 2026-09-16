# @pattern-dump/core

Command orchestration for the CLI.

Loads the config and runs each command: `runDev`, `runAudit`, `runBuild`, `runExport`.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `config`, `dev-server`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `loadConfig` and the `run*` functions |
