# @pattern-dump/discovery

Finds components on disk and gives each one its identity.

Walks the patterns folders (the project's and pattern packages'), builds the discovery map, derives ids and handles, and quarantines handle collisions. Nothing else in Pattern Dump reconstructs a component's file path.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `buildDiscoveryMap`, `collapseComponentId`, `deriveHandle` |
