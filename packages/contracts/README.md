# @pattern-dump/contracts

The seams between Pattern Dump's packages: shared types, the dev-server ↔ workbench protocol and a few pure helpers.

Every package builds against these types instead of reaching into another package's internals.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** nothing

| Entry point | What it holds |
|---|---|
| `src/index.ts` | component model, render input and output, pattern-package manifest, theme and brand shapes |
| `src/dev-protocol.ts` | every dev-server route and response, the HMR messages (`PD_PROTOCOL_VERSION`), URL builders, `staticPathFor`, the audit rollup |
