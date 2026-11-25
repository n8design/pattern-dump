# Configuration

Pattern Dump reads `pattern-dump.config.ts` from the project root, or `pattern-dump.config.json` if there
is no TypeScript file. `--config <path>` uses a file elsewhere.

**Every path in the config resolves against the project root**: the folder `pd` runs in, or `--root`.
Not against the config file's location, even when `--config` points outside the root.

The config is checked when it is loaded. A missing required option, an unknown option or a value of the
wrong type stops `pd` with a list of every problem, and a likely typo gets a suggestion:

```
[pd] Error: pattern-dump.config.json: invalid config
  - missing required "outDir" (found "outdir": did you mean "outDir"?)
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
| `outDir` | string | Default output folder, used by `pd build` when neither `--out` nor `build.outDir` is given |

### Source folders

All three are optional. A site whose components, skin and styles all come from [pattern packages](pattern-packages.md)
names none of them, and the folders don't have to exist. A project that is a pattern package itself (its
`package.json` has a `patternDump` field) takes every folder its config leaves out from there, and a folder named in
both must be the same ([pattern-packages.md](pattern-packages.md#making-a-package)).

| Option | Type | Default | Description |
|---|---|---|---|
| `sourceDir` | string | `./src` | The project's source folder |
| `patternsDir` | string | `<sourceDir>/patterns` | Where components live. Every `.hbs` below it is a component ([authoring.md](authoring.md#components)) |
| `styles` | object | `{ dir: "<sourceDir>/styles" }` | See [styles](#styles) |

### styles

| Option | Type | Description |
|---|---|---|
| `styles.strategy` | `"parallel"` | Optional. Styles live in a separate tree mirroring the patterns, the only layout supported so far |
| `styles.dir` | string | The SCSS tree |
| `styles.entry` | string or string[] | Compile only these files (relative to `styles.dir`). Without it, every `.scss` not starting with `_` is compiled. Name one design-system bundle here rather than several overlapping ones |

### documentBase

`string[]`, relative to `styles.dir`. Turns on the shared base layer, which is linked into every
preview beneath the component styles. Without it, no base layer is linked, unless a pattern package used with its
styles names a `styles.documentBase` of its own, which turns the layer on too.

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
| `themes.swatch.slots` | string[] | Custom properties shown as colour swatches for your own themes in the theme picker (a package's themes show the default ones). Default: `["--bodyBackground", "--themePrimary", "--accent"]` |

### assets

| Option | Type | Description |
|---|---|---|
| `assets.strategy` | `"central"` | Optional. Assets live in their own folder, the only layout supported so far |
| `assets.dir` | string or string[] | Served at `/assets/`. With several folders, each is served under its folder name (`/assets/images/…`). References that start with a folder's name, relative (`../../images/x.svg`) or root-absolute (`/images/x.svg`), are rewritten to `/assets/images/x.svg` in markup and in `url()` in your compiled CSS. If two folders share a name (a project's `images` and a package's `images`), the first one listed wins and the other is not served; `pd dev` warns about it and `pd build` leaves it out. Your own folders come before packages' |
| `assets.symbols.currentColor` | string | The colour token `currentColor` becomes in a symbol image's standalone file (`/_pd/symbols/<name>.svg`), which has no text colour around it. Default `"--color-text"`. It must be declared in the document base layer |
| `assets.css` | string[] | Stylesheets linked into every preview before the component styles: a path relative to the assets folder, or a full URL such as a web-font stylesheet |

### images

How the site's images are encoded as WebP variants ([Site: Images](storefront.md#images)).

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
| `shell.brand.title` | string | Title at the top of the Nav Rail, and the browser tab's title (with the component or folder in front on its route: "Button · My Design System", "Atoms · My Design System"), in `pd dev` and in a `pd build` snapshot. Default: "Pattern Dump" |
| `shell.brand.logo` | string or `{ light, dark }` | Image shown instead of the title; `{ light, dark }` switches with the colour scheme |
| `shell.brand.logoAlt` | string | Alternative text for the logo |
| `shell.brand.href` | string | Makes the brand a link |

### Pattern packages

| Option | Type | Description |
|---|---|---|
| `packages` | array | Pattern packages from `node_modules` used next to your own patterns: a package name, or `{ name, exclude, styles }`: `exclude` hides some of its templates (globs relative to its patterns folder), `styles: false` leaves out its stylesheets. See [pattern-packages.md](pattern-packages.md) |
| `exclude` | string[] | Globs, relative to `patternsDir`, of your own templates to leave out |

### build

Defaults for `pd build`; the command line overrides each, except `build.workbench`, which has no flag. See
[static-build.md](static-build.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `build.outDir` | string | `outDir`, then `dist` | Output folder, relative to the root. Replaced as a whole once a build has passed every check; a build that stops leaves it as it was |
| `build.basePath` | string | `/` | Where the site will be hosted, such as `/docs/` |
| `build.audit` | boolean | `true` | Include the corpus audit and the Audit tab |
| `build.workbench` | boolean | `true` | `false` writes the site only: for a site whose components come from a style guide package that publishes its own workbench, at `site.workbenchUrl`. `outDir` and the base path are then not used, and there must be a site |

### site

A website of real HTML pages, written from markdown, beside the workbench. Before 0.8.0 this object was called
`storefront`, and `site.globals` was `storefront.site`. The old names still load until 1.0, with a warning for each key
(`storefront.pagesDir is now site.pagesDir`, `storefront.site is now site.globals`); setting both `site` and
`storefront` is a config problem. Rename them when you next edit the config. `pd dev` serves it on its own
host and the workbench on `pd.localhost`, both from `/`; `pd build` writes it to its own folder. A page
renders with the layout `layouts/<name>` from your patterns (`layout:` in its frontmatter, `page` when
it has none). `site.pagesDir`, `patternsDir` and `site.outDir` must be three separate folders:
none of them is another, and none is inside another. Pages, frontmatter, skins and building are described
in [storefront.md](storefront.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `site.pagesDir` | string | required | Folder of the pages, relative to the root. `index.md` is `/`, `guides/setup.md` is `/guides/setup/` |
| `site.outDir` | string | required | Where `pd build` writes the site, relative to the root. Its own folder, apart from the workbench snapshot |
| `site.host` | string | `live.localhost` | The host name `pd dev` serves the site on. A bare name, with no scheme, port or path |
| `site.workbenchUrl` | string | (none; `pd build` of a project with a site needs it, with `build.workbench: false` too) | Where the built workbench will be hosted: an absolute http(s) URL with no query or fragment, such as `https://workbench.example.com/`, or a path such as `/workbench/` for a workbench on the site's own host (see [storefront.md](storefront.md#building)). A trailing slash is added if it has none. Links from site pages to the workbench start with it. Used by `pd build` only: in `pd dev` they always go to `http://pd.localhost:<port>` |
| `site.head` | string | (none) | A Handlebars file of the site's, such as `./head.hbs`, rendered with `site` into every page's head after the skin's `partials/head` ([storefront.md](storefront.md#skins)) |
| `site.url` | string | (none) | The site's address, such as `https://example.com/`: an absolute http(s) URL with no query or fragment (loaded with one trailing slash). It may have a path, such as `https://example.github.io/project/`: the site is then published under it, in `pd dev` too ([storefront.md](storefront.md#publishing-under-a-path)). With it, pages get canonical URLs, Open Graph and JSON-LD, and `pd build` writes `sitemap.xml`; without it, those are left out ([storefront.md](storefront.md#search-engines-and-link-previews)) |
| `site.lang` | string | `en` | The language of every page, for `<html lang>`: a language tag such as `de-AT` |
| `site.index` | boolean | `true` | `false` keeps the whole site out of search engines, for a staging site: every page `noindex`, `robots.txt` disallows everything, no sitemap |
| `site.image` | string | (none) | The link-preview image of every page that names none: a PNG, JPEG, GIF or WebP file in the assets, such as `/assets/images/share.png` |
| `site.socialImages` | object | (none) | `{ component: "components/social-image" }`: each page without an `image` of its own gets a link-preview image rendered from that component, at 1200 x 630 with the page's title. Off when absent ([storefront.md](storefront.md#social-images)) |
| `site.images` | object | (none) | The site's own `quality` and `effort` for its images, over `images` (above) |
| `site.categories` | object | (none) | The categories a page's `categories:` may name, by key (lowercase letters, digits and hyphens): `{ guides: { label: "Guides", description: "…", aliases: ["how-to"] } }`. `label` is required; `aliases` are old keys kept after a rename. Independent of the folders, so a page changes category without changing its URL ([storefront.md](storefront.md#categories)) |
| `site.tags` | object | (none) | The tags a page's `tags:` may name, declared as categories are: `{ css: { label: "CSS", aliases: ["styles"] } }`. Without it any tag works, labelled with its key ([storefront.md](storefront.md#tags)) |
| `site.tagPages` | boolean or object | on when the skin has `layouts/tag` | A page per tag at `/tags/<key>/` and an index at `/tags/`. `false`: off; `true` or `{ path, title }`: on, and a missing layout is a problem ([storefront.md](storefront.md#tag-and-category-pages)) |
| `site.categoryPages` | boolean or object | on when the skin has `layouts/category` | The same for categories, at `/categories/` |
| `site.search` | boolean | on when the project has Pagefind | Search: `pd build` indexes every page's own content with Pagefind into `_pd/search/`. `true`: a build without Pagefind stops; `false`: off ([storefront.md](storefront.md#search)) |
| `site.llms` | boolean | `true` (`false` with `index: false`) | `pd build` writes `llms.txt` at the site's root: the site's title and description and each page's title, link and teaser, by collection ([storefront.md](storefront.md#search-engines-and-link-previews)). `false`: none |
| `site.checks.classes` | `"warning"`, `"error"` or `"off"` | `"warning"` | The class check: a class on a page that no component or style of the style guide defines is listed in the report, stops the build, or isn't checked ([storefront.md](storefront.md#the-class-check)) |
| `site.checks.allowClasses` | list of strings | `[]` | Classes a page may carry anyway: names, or a prefix ending in `*` (`"chart-*"`) |
| `site.checks.allowProperties` | list of strings | `[]` | Custom properties JavaScript sets, which the skin's `var()` may read with no definition in CSS: names, or a prefix ending in `*` (`"--chart-*"`). Any other `var()` without a fallback and without a definition stops the build ([storefront.md](storefront.md#custom-properties-nothing-defines)) |
| `site.globals` | object | (none) | Values every page shares, such as the site's title or footer line. Every layout gets them as `site`, and a page cannot set them. Their keys and types are what the `site` property of `partials/base`'s schema declares, and they are checked against it. One key is Pattern Dump's: `navigations`, named lists of links ([storefront.md](storefront.md#declared-navigations)) |

## When changes take effect

`pd dev` picks up edits to components, docs, styles, themes, scripts, global data, assets and helper modules
while it runs, in the project and in linked pattern packages. Restart it after changing
`pattern-dump.config.ts`, a file a helper module imports, or an installed pattern package. When a data or
helper file fails to load, the last good version stays in use, and the problem is shown in the terminal and
on the open pages until the file is fixed. The full list is in
[pattern-packages.md](pattern-packages.md#what-reloads-and-what-needs-a-restart).
