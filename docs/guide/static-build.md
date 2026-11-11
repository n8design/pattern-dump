# Static build — `pd build`

`pd build` writes the Pattern Dump workbench as **plain files** that any static host can serve: GitHub
Pages, Netlify, a CDN, nginx, an internal file share behind a web server. Node is needed only to build;
nothing runs on the server afterwards.

Use it to publish a design system for people who should browse it without installing anything.

---

## Quick start

```bash
npx pd build                      # writes ./dist, to be served at a domain root
cd dist && python3 -m http.server 8080
# open http://localhost:8080/
```

Serve the folder over HTTP. Opening `index.html` from disk (`file://`) does not work: the pages load
their data with `fetch`, which browsers block for local files.

---

## What you get

Everything the live workbench (`pd dev`) shows, frozen at build time:

| Area | In the static build |
|---|---|
| Nav Rail | Full tree, search, **Show private**, **Hide packages**, theme and accessibility pickers |
| Stage | Every component and every variant, viewport sizes, the variants gallery, folder galleries |
| Themes | Previews are built with the **default theme**; every other theme still switches in the browser |
| Inspector | Docs, Relationships, **Audit** (labelled "Snapshot from …"; can be [left out](#leaving-the-audit-out)) |
| Console | Source (Handlebars, data, schema), rendered HTML, Diagnostics (including the rendered a11y check, which runs in the browser) |
| Links | Deep links and page reloads work on every host — each route has its own `index.html` |

What is **not** there, because there is no server:

- **Live reload.** The status bar at the bottom of the Nav Rail reads *Static build · \<date\>* instead of
  *Connected*. Rebuild to update.
- **Live audit.** The Audit tab shows the result from build time, not the current state.

---

## Options

Every option can be given on the command line or as a project default in `pattern-dump.config.ts`.
The command line wins.

| Command line | Config | Default | What it does |
|---|---|---|---|
| `--out <dir>` | `build.outDir` | `outDir`, then `dist` | Output folder, relative to the project root. **Emptied before each build.** |
| `--base <path>` | `build.basePath` | `/` | Where the site will be hosted: `/` at a domain root, or a subpath such as `/docs/htwoo/` |
| `--no-audit` / `--audit` | `build.audit` | `true` | Include the corpus audit |
| `--root <path>` | — | current folder | Build another project |
| `--config <path>` | — | `pattern-dump.config.ts` in the root | Use a config file outside the root |

```ts
// pattern-dump.config.ts
export default defineConfig({
  // …
  build: { outDir: "site", basePath: "/docs/htwoo/", audit: false },
});
```

### Hosting under a subpath

Build with the same subpath the site will be served under, including the surrounding slashes:

```bash
npx pd build --base /docs/htwoo/
```

Every link, stylesheet, script and data file inside the build then points under `/docs/htwoo/`. A
build made for one base path does not work under another — rebuild when the address changes.

A project with a storefront whose workbench is on the storefront's own host (`storefront.workbenchUrl` a
path such as `/workbench/`, [storefront.md](storefront.md#building)) must build the workbench for that
path; another base path is an error. The build's note about copying the workbench's `robots.txt` rule then
doesn't appear: the storefront's own `robots.txt` carries it.

### Leaving the audit out

```bash
npx pd build --no-audit
```

The corpus audit is then **not run at all**, no audit file is written, and the
site has **no Audit tab**. Visitors who last had the Audit tab open land on Docs. Per-component
diagnostics in the Console are unaffected.

With `build: { audit: false }` as the project default, `npx pd build --audit` includes it for a single
build.

---

## Hosting

The output is ordinary static files. Two things matter on every host:

1. **Serve the folder at the base path you built for.**
2. **Serve `index.html` for a folder request** (`/docs/htwoo/atoms/button/` → `…/atoms/button/index.html`).
   Every static host does this by default.

No rewrite rules are needed, and none should send unknown paths to the shell.

### GitHub Pages

Publish the build folder (for example with a GitHub Action that runs `npx pd build` and uploads the
folder). A repository site lives under `/<repository>/`, so build with that base:

```bash
npx pd build --base /my-design-system/
```

The build includes an empty `.nojekyll` file. Keep it: without it GitHub Pages runs Jekyll, which drops
every folder starting with `_` — including `_pd/`, where the workbench itself lives.

### Netlify, Vercel, Cloudflare Pages

Set the build command to `npx pd build` and the publish directory to `dist` (or your `--out`). Sites
on their own domain use the default base `/`.

### nginx

```nginx
location /docs/htwoo/ {
    alias /var/www/htwoo-site/;
    try_files $uri $uri/ =404;
}
```

Build with `--base /docs/htwoo/`.

### A quick local server

```bash
cd dist && python3 -m http.server 8080          # built for /
```

For a subpath build, serve the folder under that subpath. The Pattern Dump repository has a tiny file
server for exactly this:

```bash
node apps/dev-ui/e2e/static-server.mjs --dir dist --base /docs/htwoo/ --port 8080
# open http://localhost:8080/docs/htwoo/
```

---

## Build output

```
dist/
  index.html                          shell pages — one per route
  atoms/index.html                    a folder gallery
  atoms/button/index.html             a component
  atoms/button/variants/index.html    the variants gallery
  api/tree.json  themes.json  config.json  version.json  audit.json
  api/component/<id>/index.json       component details (default variant)
  api/component/<id>/~<variant>.json  … per variant
  api/overview/<folder>/index.json    folder galleries
  preview/<id>/index.html             preview documents (default theme baked in)
  preview/<id>/~<variant>.html
  source/<id>/rendered.html           highlighted rendered HTML (and data.html, per variant)
  _pd/                                the workbench (main.js, main.css), component and theme CSS, scripts
  assets/                             the project's asset folders, as served by pd dev
  .nojekyll
```

When the build finishes it prints a summary:

```
[pd build] 259 components → 1668 files, 19.7 MB in 55080 ms
[pd build] /path/to/dist  (served from /docs/htwoo/)
[pd build]   not built: 500 /source/atoms/loading/shimmer-theming-support/rendered: Render error: …
```

**"not built"** lines list components that fail to render — they are findings about the design
system, not build errors. The build still succeeds, and the static site shows those components the
same way `pd dev` does. Fix the template and rebuild.

---

## Using pattern packages

A project that uses [pattern packages](pattern-packages.md) (for example hTWOo
next to your own patterns) builds exactly the same way. The packages' components, styles, themes and
assets are all included, and **Hide packages** works in the static site.

---

## With a storefront

A project with a [storefront](storefront.md) gets a second folder from the same build,
`storefront.outDir`, with one page per markdown file and its own copy of everything those pages use. The
workbench snapshot is written exactly as it would be without one. Deploy each folder to its own host:

```
[pd build] 8 components → 69 files, 1.0 MB in 983 ms
[pd build] /path/to/dist  (served from /)
[pd build] storefront: 4 pages → 14 files in /path/to/site  (served from /)
[pd build]   note: guides/setup.md: heading "Main" is #main-1, because the layout uses id="main"
```

The storefront is always served from the root of its host. Unlike a component that fails to render in the
workbench, a problem on a storefront page fails the build, and then neither folder is written.

**"note"** lines are about pages that were built as they are: nothing is left out for them. A heading's
anchor that the layout already uses as an id (`## Main` against `<main id="main">`) gets the next free
suffix, `main-1`, and the note says so; `pd dev` prints the same line.

---

## How it works

`pd build` starts the dev server internally — without live reload or a file watcher — requests every
route the workbench uses, and saves each response as a file. Two adjustments are made, and only these:

- **Base path.** Root-relative Pattern Dump URLs inside HTML, CSS and JSON gain the base path.
- **Shell pages.** Each route gets a copy of the workbench page that says it is running from a static
  build (`window.__pd`), so it reads the saved files instead of the server's routes.

Because every file comes from the same code `pd dev` serves, the static site cannot show anything
different from the live workbench at the time of the build.

How a live URL maps to a file (for example `/api/component/atoms/button?variant=ghost` →
`api/component/atoms/button/~ghost.json`) is defined once, as `staticPathFor` in
`@pattern-dump/contracts`, and used by both the build and the workbench.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Blank page, errors about `fetch` or CORS | The build was opened from disk. Serve the folder over HTTP. |
| Page loads without styling; `_pd/…` returns 404 | Built for a different base path than it is served from — rebuild with `--base` matching the address. On GitHub Pages, check that `.nojekyll` was published. |
| A preview shows a second workbench inside it | The host rewrites missing files to `index.html` (a "single-page app" setting), so a component that failed to render gets the workbench page as its preview. Turn the rewrite off; every route already has its own page. |
| The site shows old content | Rebuild. The site is a snapshot; nothing updates on its own. |
| `pd build: --out … overlaps …` | The output folder would overwrite folders Pattern Dump reads. Choose a separate folder such as `dist`. |
| `pd build: storefront.workbenchUrl is /workbench/, so the workbench must be built for /workbench/` | The workbench is linked at that path on the storefront's host. Set `build.basePath` (or `--base`) to the same path. |
| `[pd] Error: unknown command "build"` | The installed Pattern Dump predates `pd build` — update the `pattern-dump` dependency. |
| Build is slow on a large design system | Most time goes into per-component checks. `--no-audit` skips the corpus audit; the rest scales with the number of components and variants (about 55 s for hTWOo's 259 components). |
