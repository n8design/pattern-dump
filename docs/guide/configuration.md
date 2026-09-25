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
  is global.

```ts
documentBase: ["00-base", "03-organisms/hero"],
```

### themes

| Option | Type | Description |
|---|---|---|
| `themes.dir` | string | Folder of `<name>.theme.scss` files |
| `themes.default` | string | The theme previews start with |
| `themes.switch` | `"attribute"` (default) or `"stylesheet"` | How themes switch; see [themes.md](themes.md#switching) |
| `themes.swatch.slots` | string[] | Custom properties shown as colour swatches in the theme picker. Default: `["--bodyBackground", "--themePrimary", "--accent"]` |

### assets

| Option | Type | Description |
|---|---|---|
| `assets.strategy` | `"central"` | Optional. Assets live in their own folder, the only layout supported so far |
| `assets.dir` | string or string[] | Served at `/assets/`. With several folders, each is served under its folder name (`/assets/images/…`). References that start with a folder's name, relative (`../../images/x.svg`) or root-absolute (`/images/x.svg`), are rewritten to `/assets/images/x.svg` in markup and in `url()` in your compiled CSS. If two folders share a name (a project's `images` and a package's `images`), the first one listed wins and the other is not served; `pd dev` warns about it and `pd build` leaves it out. Your own folders come before packages' |
| `assets.css` | string[] | Stylesheets linked into every preview before the component styles: a path relative to the assets folder, or a full URL such as a web-font stylesheet |

### Scripts

| Option | Type | Description |
|---|---|---|
| `scriptsDir` | string | Folder of behaviour scripts (`<id>.ts`), loaded with `requireScript` ([authoring.md](authoring.md#behaviour-scripts)) |
| `globalScripts` | string[] | Scripts loaded into every preview: an id from `scriptsDir`, or a full URL. They load after the markup and before a component's own scripts |

### Data and helpers

| Option | Type | Description |
|---|---|---|
| `dataDir` | string | Every `*.json` in this folder is merged into one global data object, beneath each component's own data. Read once at startup: restart `pd dev` after changing it |
| `helpers` | string | A Handlebars helper module or a folder of them. A module either exports a function that receives `Handlebars` and registers helpers (the PatternLab form), or exports named functions. Read once at startup |

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
| `packages` | array | Pattern packages from `node_modules` used next to your own patterns: a package name, or `{ name, exclude }` to hide some of its templates (globs relative to its patterns folder). See [pattern-packages.md](pattern-packages.md) |
| `exclude` | string[] | Globs, relative to `patternsDir`, of your own templates to leave out |

### build

Defaults for `pd build`; the command line overrides each. See [static-build.md](static-build.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `build.outDir` | string | `outDir`, then `dist` | Output folder, relative to the root. Emptied before each build |
| `build.basePath` | string | `/` | Where the site will be hosted, such as `/docs/` |
| `build.audit` | boolean | `true` | Include the corpus audit and the Audit tab |

## When changes take effect

`pd dev` picks up edits to components, docs, styles, themes and scripts while it runs. Restart it after
changing `pattern-dump.config.ts`, anything in `dataDir` or `helpers`, or an installed pattern package.
