# @pattern-dump/cli

The pd command and the published pattern-dump package.

Parses commands, runs `pd init` (with the starter templates in `templates/`), and builds the self-contained distributable with `npm run pack:pd`. The npm page comes from `PACKAGE-README.md`.

**Internal package.** `npm run pack:pd` bundles it, with every other workspace package, into the
published `pattern-dump` package; `@pattern-dump/cli` itself is not published. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `core`, `contracts`, `dev-server`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | the `pd` entry point |
| `src/args.ts` | commands, flags and the help text |
| `src/init/` | `pd init` |
| `src/distribution.ts` | the published package name and version |
| `scripts/pack.mjs` | builds `.pd-pack/pattern-dump-<version>.tgz` |
| `templates/` | what `pd init` writes |
