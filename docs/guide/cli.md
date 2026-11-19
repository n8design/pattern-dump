# Command line: `pd`

```
pd <command> [options]
```

Run it through npm scripts (`npm run dev`) or `npx pd` inside a project. `pd help` prints the built-in help.

## Global or local

`pd` is installed per project: `pd init` adds `pattern-dump` as a development dependency, and the
project's `pattern-dump.config.ts` imports `defineConfig` from it.

You can also install `pd` globally (`npm install --global pattern-dump`) to create projects with
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
a TypeScript setup, and optional starter components. In a terminal it asks for each choice not given as a flag;
without one (in CI, or with input piped in) it takes every default without asking, as with `--yes`.

| Option | Description |
|---|---|
| `--name <name>` | Package name. Default: the folder name; a generic one (`styleguide`, `site`, `docs` and the like) is scoped by its parent folder, `@<parent>/<folder>` |
| `--brand <title>` | Title shown in the Nav Rail; with `--site`, the site's title. Default: the name, or the parent folder's name for a scoped one |
| `--no-examples` | Structure, config and themes only, without starter components |
| `--with-site` | Also a website: two pages, a small skin, a component of its own and a GitHub Pages workflow ([storefront.md](storefront.md#quick-start)). Default: no |
| `--search` / `--no-search` | With a website: Pagefind as a devDependency, pinned, so `pd build` writes the search index. Default: yes |
| `--system-theme` / `--no-system-theme` | With a website: the default theme `system`, which follows the viewer's light or dark setting, and the skin's pages with it. Default: yes |
| `--site <package or folder>` | A content-only website on an existing style guide instead of a design system ([getting-started.md](getting-started.md#a-content-only-website)) |
| `--workbench-url <url>` | With `--site`: where the style guide's workbench is published, a full address or a path on the site's host. Default: `/workbench/` |
| `--no-install` | Skip `npm install` |
| `--git` / `--no-git` | Run `git init`. Default: yes, unless already inside a repository |
| `--pd-source <src>` | Where to install Pattern Dump from: a `.tgz` file or an npm spec |
| `-y`, `--yes` | Accept every default without asking |

In a folder that already has a `package.json`, `pd init` adds to it: existing files are never
overwritten, an existing script name gets a `pd:` variant instead, and existing `pattern-dump` and
`typescript` versions are kept. It refuses a folder that already has a Pattern Dump config.

It adds these scripts: `dev` (`pd dev`), `audit` (`pd audit`), `typecheck` (`tsc --noEmit`) and
`build:scripts` (`tsc`), and with `--with-site` also `build` (`pd build`); with `--site`, `dev` and `build` only.
`pattern-dump` and Pagefind are pinned to exact versions (`npm install --save-dev --save-exact pattern-dump@<version>`
moves the pin), and `allowScripts` allows the install scripts of esbuild and `@parcel/watcher`, Pattern Dump's own
dependencies; a denial the project already has (`false`) is kept.

With `--with-site`, the skin (`src/patterns/layouts/`, `src/patterns/partials/` and their styles) is written
as a whole or not at all: if one of its files is already there, `pd init` leaves the skin out and says so,
so it is never mixed with a skin the project has. When Pattern Dump is installed from a local `.tgz`, it
warns that the GitHub Pages workflow can't install it (`npm ci` runs on GitHub's machines).

---

## `pd dev`

Starts the workbench with live reload.

| Option | Description |
|---|---|
| `--port <n>` | HTTP port. Default `4000`, or the `PD_PORT` environment variable |
| `--ws-port <n>` | Live-reload WebSocket port. Default: the HTTP port + 1, or `PD_WS_PORT` |

If a port is taken, `pd dev` says which one and exits, with the command to try: another `--port`, or, when the
live-reload port you chose with `--ws-port` (or `PD_WS_PORT`) is the taken one, another `--ws-port`.

Restart `pd dev` after changing the config, a file a helper module imports (only the module itself
reloads), or an installed pattern package. Everything else reloads while it runs, global data and helpers
included; if a data or helper file fails to load, the last good version stays in use and the problem is
shown.

---

## `pd audit`

Renders every component once, with its own data, and reports defects across the whole design system:

- render errors;
- data and schema checks (`UNFILLED_REQUIRED`, `SHAPE_MISMATCH`, `DATA_INVALID`, `SCHEMA_INVALID`, `HELPER_SHADOW`);
- HTML validation;
- structural accessibility checks (axe-core rules that don't need layout or colour).

Variants are not part of the audit: each variant is checked on its own page in the workbench (the Console's
**Diagnostics** tab), and `pd build` checks every variant it writes. A component left out of the tree by a handle
collision is not in the audit either: the collision is named in the terminal, on the Console, and on that
component's Diagnostics tab.

| Option | Description |
|---|---|
| `--format <fmt>` | `md` (default), `text` or `json` |
| `--strict` | Fail on any finding, warnings too |

The report is printed and also written to a file; the last lines give its path and the path of the full
serialized graph. With `--format json`, standard output is only the JSON report and the status lines go
to standard error, so it can be piped:

```bash
npx pd audit --format json | jq '.totals'
```

Results are cached per component and reused when nothing changed, or when nothing a component includes
changed.

`pd audit` fails (exit code `1`) when it finds an error, so a CI step that runs it stops there. (`pd build` does
not fail on component findings, its own audit's included; it fails on its storefront and schema checks.) Warnings alone leave it at `0`; with `--strict`, any finding fails it. The
last line says why it failed:

```
[pd audit] failed: 2 errors found (warnings alone don't fail it; --strict makes them fail it too).
```

The workbench's **Audit** tab shows the same results. Rendered-page accessibility checks that need layout
(such as colour contrast) run in the browser, in the Console's **Diagnostics** tab.

---

## `pd build`

Writes a static snapshot of the workbench: plain files for any static host.

| Option | Description |
|---|---|
| `--out <dir>` | Output folder, relative to the root. Default: `build.outDir`, `outDir`, then `dist`. Replaced as a whole once every check has passed; a build that stops leaves it as it was |
| `--base <path>` | Where it will be hosted: `/` or a subpath such as `/docs/`. Default: `build.basePath`, then `/` (a project made with `pd init --with-site` sets `/workbench/`) |
| `--browser` | Also check the storefront's pages in Chromium: contrast and the other accessibility rules that need a rendered page, and each image's variant against its box ([storefront.md](storefront.md#checks-in-a-browser-pd-build---browser)). Needs the project's own Playwright |
| `--no-audit` / `--audit` | Leave the corpus audit out (it is not run, and there is no Audit tab), or force it in. Default: `build.audit` |
| `--check-workers <n>` | Threads that check the storefront's pages for accessibility. Default: the cores less one, at most 8, within a quarter of the memory; `1` checks them in one thread. The findings are the same with any number |
| `--skip-checks=a11y,html` | Leave checks out, for a quick local build: `a11y`, the accessibility of the storefront's pages; `html`, the components' markup against HTML's content model. The build's last line says what was not checked. Default: `build.skipChecks`, else every check runs; `--skip-checks=` runs every check |

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
pd help
```

Prints the usage summary: every command and option.
