# Command line: `pd`

```
pd <command> [options]
```

Run it through npm scripts (`npm run dev`) or `npx pd` inside a project. `pd help [command]` prints the
built-in help.

## Global or local

`pd` is installed per project: `pd init` adds `pattern-dump` as a development dependency, and the
project's `pattern-dump.config.ts` imports `defineConfig` from it.

You can also install `pd` globally (`npm install --global pattern-dump@alpha`) to create projects with
`pd init` from anywhere. Keep two things in mind:

- **A project still needs its local dependency.** The config's `import … from "pattern-dump"` resolves
  from the project's own `node_modules`; without it, `pd dev` and the other commands can't load the
  config.
- **A global `pd` runs its own version.** It does not switch to the version the project depends on, so
  if the two differ, the workbench, checks and static build come from the global one. Inside a project,
  use `npm run dev`, `npm run audit` or `npx pd <command>`, which run the project's version.

Commands that read a project (`dev`, `audit`, `build`, `export`) share two options:

| Option | Description |
|---|---|
| `--root <path>` | The project root. Default: the current folder |
| `--config <path>` | A config file outside the root. Its paths still resolve against `--root` |

A command exits with `0` on success and `1` on an error.

---

## `pd init`

```
pd init [dir]
```

Sets up a Pattern Dump project in `dir` (default: the current folder): config, patterns, styles, themes,
a TypeScript setup, and optional starter components. It asks for each choice unless given as a flag.

| Option | Description |
|---|---|
| `--name <name>` | Package name. Default: the folder name |
| `--brand <title>` | Title shown in the Nav Rail. Default: the name |
| `--no-examples` | Structure, config and themes only, without starter components |
| `--no-install` | Skip `npm install` |
| `--git` / `--no-git` | Run `git init`. Default: yes, unless already inside a repository |
| `--pd-source <src>` | Where to install Pattern Dump from: a `.tgz` file or an npm spec |
| `-y`, `--yes` | Accept every default without asking |

In a folder that already has a `package.json`, `pd init` adds to it: existing files are never
overwritten, an existing script name gets a `pd:` variant instead, and existing `pattern-dump` and
`typescript` versions are kept. It refuses a folder that already has a Pattern Dump config.

It adds these scripts: `dev` (`pd dev`), `audit` (`pd audit`), `typecheck` (`tsc --noEmit`) and
`build:scripts` (`tsc`).

---

## `pd dev`

Starts the workbench with live reload.

| Option | Description |
|---|---|
| `--port <n>` | HTTP port. Default `4000`, or the `PD_PORT` environment variable |
| `--ws-port <n>` | Live-reload WebSocket port. Default: the HTTP port + 1, or `PD_WS_PORT` |

If a port is taken, `pd dev` says which one and exits; pick another with `--port`.

Restart `pd dev` after changing the config, a file a helper module imports (only the module itself
reloads), or an installed pattern package. Everything else reloads while it runs, global data and helpers
included; if a data or helper file fails to load, the last good version stays in use and the problem is
shown.

---

## `pd audit`

Renders every component and variant and reports defects across the whole design system:

- render errors;
- schema checks (`UNFILLED_REQUIRED`, `SHAPE_MISMATCH`);
- HTML validation;
- structural accessibility checks (axe-core rules that don't need layout or colour);
- discovery problems such as handle collisions.

| Option | Description |
|---|---|
| `--format <fmt>` | `md` (default), `text` or `json` |

The report is printed and also written to a file; the last lines give its path and the path of the full
serialized graph. With `--format json`, standard output is only the JSON report and the status lines go
to standard error, so it can be piped:

```bash
npx pd audit --format json | jq '.totals'
```

Results are cached per component and reused when nothing changed. `pd audit` exits with `0` when it ran,
whatever the number of defects.

The workbench's **Audit** tab shows the same results. Rendered-page accessibility checks that need layout
(such as colour contrast) run in the browser, in the Console's **Diagnostics** tab.

---

## `pd build`

Writes a static snapshot of the workbench: plain files for any static host.

| Option | Description |
|---|---|
| `--out <dir>` | Output folder, relative to the root. Default: `build.outDir`, `outDir`, then `dist`. Emptied first |
| `--base <path>` | Where it will be hosted: `/` (default) or a subpath such as `/docs/` |
| `--no-audit` / `--audit` | Leave the corpus audit out (it is not run, and there is no Audit tab), or force it in. Default: `build.audit` |

Full guide: [static-build.md](static-build.md).

---

## `pd export`

Finds families of near-duplicate components (copies that differ only in a modifier class on their root
element) and writes them out in a corrected form: one base template plus a `~variant.json` overlay per
copy, with include sites updated where needed. Values are carried over as they are; nothing is fixed
silently.

| Option | Description |
|---|---|
| `--out <dir>` | Where to write. Must be outside `--root`: the project itself is never changed. Default: a temporary folder |

It prints which families were collapsed, which were skipped and why, and every file written. This is
meant for migrating an existing design system; review the output before copying it back.

---

## `pd help`

```
pd help [command]
```

Prints the usage summary.
