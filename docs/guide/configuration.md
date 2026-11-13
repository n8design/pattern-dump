# Configuration

Pattern Dump reads `pattern-dump.config.ts` from the project root, or `pattern-dump.config.json` if there
is no TypeScript file. `--config <path>` uses a file elsewhere.

**Every path in the config resolves against the project root**: the folder `pd` runs in, or `--root`.
Not against the config file's location, even when `--config` points outside the root.

The config is checked when it is loaded. A missing required option, an unknown option or a value of the
wrong type stops `pd` with a list of every problem, and a likely typo gets a suggestion:

```
[pd] Error: pattern-dump.config.json: invalid config
  - missing required "styles" (found "style" — did you mean "styles"?)
```

```ts
import { defineConfig } from "pattern-dump";

export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./dist",

  styles: { strategy: "parallel", dir: "./src/styles" },
  documentBase: ["base"],

  themes: {
    dir: "./themes",
    default: "light",
    switch: "attribute",
    swatch: { slots: ["--color-surface", "--color-primary", "--color-text"] },
  },

  assets: { strategy: "central", dir: "./assets" },

  scriptsDir: "./src/scripts",
  // globalScripts: ["<id>"],

  // packages: ["@acme/design-system"],

  shell: {
    brand: { title: "My Design System" },
  },
});
```

`defineConfig` only adds type checking; it returns the object unchanged.

## Reference

### Required

| Option | Type | Description |
|---|---|---|
| `sourceDir` | string | The project's source folder |
| `patternsDir` | string | Where components live. Every `.hbs` below it is a component ([authoring.md](authoring.md#components)) |
| `outDir` | string | Default output folder, used by `pd build` when neither `--out` nor `build.outDir` is given |
| `styles` | object | See [styles](#styles) |

### styles

| Option | Type | Description |
|---|---|---|
| `styles.strategy` | `"parallel"` | Optional. Styles live in a separate tree mirroring the patterns, the only layout supported so far |
| `styles.dir` | string | The SCSS tree |
| `styles.entry` | string or string[] | Compile only these files (relative to `styles.dir`). Without it, every `.scss` not starting with `_` is compiled. Name one design-system bundle here rather than several overlapping ones |

### documentBase

`string[]`, relative to `styles.dir`. Turns on the shared base layer, which is linked into every
preview beneath the component styles. Without it, no base layer is linked.

- **Listed files and folders always go into the base layer**, even a file that would otherwise belong
  to a component. List `00-base` for resets and `:root` defaults, a component's file when its rules
  are needed on every page (a `body` rule in a hero, say), or `"."` to make the whole styles tree
  global, as PatternLab's single stylesheet was.
- **Rules no component owns join it too**, listed or not: shared partials whose rules no single
  component owns stay available on every preview.
- **`pd dev` checks the list at startup.** An entry that matches no file is a warning, usually a typo.
  One line reports the rules that are in the base layer without being listed, so you can see what
  is global, and `BASE-LAYER.generated.md` in Pattern Dump's scratch folder (the path is in that
  line) lists every such file with its rule count.

```ts
documentBase: ["00-base", "03-organisms/hero"],
```

### themes

| Option | Type | Description |
|---|---|---|
| `themes.dir` | string | Optional. Folder of your own `<name>.theme.scss` files. Leave it out to use only the themes your pattern packages provide |
| `themes.default` | string | The theme previews start with: one of yours or a package's. `pd dev` warns when it matches no theme |
| `themes.switch` | `"attribute"` (default) or `"stylesheet"` | How themes switch; see [themes.md](themes.md#switching) |
| `themes.swatch.slots` | string[] | Custom properties shown as colour swatches in the theme picker. Default: `["--bodyBackground", "--themePrimary", "--accent"]` |

### assets

| Option | Type | Description |
|---|---|---|
| `assets.strategy` | `"central"` | Optional. Assets live in their own folder, the only layout supported so far |
| `assets.dir` | string or string[] | Served at `/assets/`. With several folders, each is served under its folder name (`/assets/images/…`). References that start with a folder's name, relative (`../../images/x.svg`) or root-absolute (`/images/x.svg`), are rewritten to `/assets/images/x.svg` in markup and in `url()` in your compiled CSS. If two folders share a name (a project's `images` and a package's `images`), the first one listed wins and the other is not served; `pd dev` warns about it and `pd build` leaves it out. Your own folders come before packages' |
| `assets.css` | string[] | Stylesheets linked into every preview before the component styles: a path relative to the assets folder, or a full URL such as a web-font stylesheet |

### images

How the storefront's images are encoded as WebP variants ([Storefront: Images](storefront.md#images)).

| Option | Type | Default | Description |
|---|---|---|---|
| `images.quality` | number | `75` | WebP quality, a whole number from 1 to 100 |
| `images.effort` | number | `4` | Encoding effort, a whole number from 0 (fastest) to 6 (smallest files) |

### Scripts

| Option | Type | Description |
|---|---|---|
| `scriptsDir` | string | Folder of behaviour scripts (`<id>.ts`), loaded with `requireScript` ([authoring.md](authoring.md#behaviour-scripts)) |
| `globalScripts` | string[] | Scripts loaded into every preview: an id from `scriptsDir`, or a full URL. They load after the markup and before a component's own scripts |

### Data and helpers

| Option | Type | Description |
|---|---|---|
| `dataDir` | string | Every `*.json` in this folder is merged into one global data object, beneath each component's own data. Reloaded while `pd dev` runs |
| `helpers` | string | A Handlebars helper module or a folder of them. A module either exports a function that receives `Handlebars` and registers helpers (the PatternLab form), or exports named functions. A changed helper module reloads while `pd dev` runs; a change to a file it imports asks for a restart |

### Workbench

| Option | Type | Description |
|---|---|---|
| `overviews` | boolean | Folder gallery pages. Default `true`; a folder's `index.md` can turn off its own with `overview: false` |
| `shell.brand.title` | string | Title at the top of the Nav Rail. Default: "Pattern Dump" |
| `shell.brand.logo` | string or `{ light, dark }` | Image shown instead of the title; `{ light, dark }` switches with the colour scheme |
| `shell.brand.logoAlt` | string | Alternative text for the logo |
| `shell.brand.href` | string | Makes the brand a link |

### Pattern packages

| Option | Type | Description |
|---|---|---|
| `packages` | array | Pattern packages from `node_modules` used next to your own patterns: a package name, or `{ name, exclude, styles }`: `exclude` hides some of its templates (globs relative to its patterns folder), `styles: false` leaves out its stylesheets. See [pattern-packages.md](pattern-packages.md) |
| `exclude` | string[] | Globs, relative to `patternsDir`, of your own templates to leave out |

### build

Defaults for `pd build`; the command line overrides each. See [static-build.md](static-build.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `build.outDir` | string | `outDir`, then `dist` | Output folder, relative to the root. Emptied before each build |
| `build.basePath` | string | `/` | Where the site will be hosted, such as `/docs/` |
| `build.audit` | boolean | `true` | Include the corpus audit and the Audit tab |

### storefront

A website of real HTML pages, written from markdown, beside the workbench. `pd dev` serves it on its own
host and the workbench on `pd.localhost`, both from `/`; `pd build` writes it to its own folder. A page
renders with the layout `layouts/<name>` from your patterns (`layout:` in its frontmatter, `page` when
it has none). `storefront.pagesDir`, `patternsDir` and `storefront.outDir` must be three separate folders:
none of them is another, and none is inside another. Pages, frontmatter, skins and building are described
in [storefront.md](storefront.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `storefront.pagesDir` | string | required | Folder of the pages, relative to the root. `index.md` is `/`, `guides/setup.md` is `/guides/setup/` |
| `storefront.outDir` | string | required | Where `pd build` writes the storefront, relative to the root. Its own folder, apart from the workbench snapshot |
| `storefront.host` | string | `live.localhost` | The host name `pd dev` serves the storefront on. A bare name, with no scheme, port or path |
| `storefront.workbenchUrl` | string | — | Where the built workbench will be hosted: an absolute http(s) URL with no query or fragment, such as `https://workbench.example.com/`, or a path such as `/workbench/` for a workbench on the storefront's own host (see [storefront.md](storefront.md#building)). A trailing slash is added if it has none. Links from storefront pages to the workbench start with it. Used by `pd build` only: in `pd dev` they always go to `http://pd.localhost:<port>` |
| `storefront.url` | string | — | The site's address, such as `https://example.com/`: an absolute http(s) URL with no path, query or fragment (loaded with one trailing slash). With it, pages get canonical URLs, Open Graph and JSON-LD, and `pd build` writes `sitemap.xml`; without it, those are left out ([storefront.md](storefront.md#search-engines-and-link-previews)) |
| `storefront.lang` | string | `en` | The language of every page, for `<html lang>`: a language tag such as `de-AT` |
| `storefront.index` | boolean | `true` | `false` keeps the whole site out of search engines, for a staging site: every page `noindex`, `robots.txt` disallows everything, no sitemap |
| `storefront.image` | string | — | The link-preview image of every page that names none: a PNG, JPEG, GIF or WebP file in the assets, such as `/assets/images/share.png` |
| `storefront.images` | object | — | The site's own `quality` and `effort` for its images, over `images` (above) |
| `storefront.site` | object | — | Values every page shares, such as the site's title or footer line. Every layout gets them as `site`, and a page cannot set them. Their keys and types are what the `site` property of `partials/base`'s schema declares, and they are checked against it. One key is Pattern Dump's: `navigations`, named lists of links ([storefront.md](storefront.md#declared-navigations)) |

## When changes take effect

`pd dev` picks up edits to components, docs, styles, themes, scripts, global data, assets and helper modules
while it runs, in the project and in linked pattern packages. Restart it after changing
`pattern-dump.config.ts`, a file a helper module imports, or an installed pattern package. When a data or
helper file fails to load, the last good version stays in use, and the problem is shown in the terminal and
on the open pages until the file is fixed. The full list is in
[pattern-packages.md](pattern-packages.md#what-reloads-and-what-needs-a-restart).
