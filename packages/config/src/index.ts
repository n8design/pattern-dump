// @pattern-dump/config
// Load and validate pattern-dump.config (.ts/.json, TS wins). Shared config types.
import type { ShellBrandConfig, SwatchSlots, ThemeSwitch } from "@pattern-dump/contracts";
export type { ShellBrandConfig, SwatchSlots, ThemeSwitch };
export { ConfigError, configProblems, sameHostWorkbenchPath, suggest, validateConfig } from "./validate.js";

export interface AssetsConfig {
  /** Where assets live. Only 'central' (the default: one assets dir, served at /assets/) is supported
   *  so far; 'component-relative' is reserved, and the config check rejects it as not supported yet. */
  strategy?: "central" | "component-relative";
  /**
   * Asset directory (relative to project root), served at /assets/. Accepts an ARRAY of roots —
   * hTWOo needs `src/images` AND `src/fonts`. Each root is addressable by its basename under
   * /assets/ (`/assets/images/x` → `<src/images>/x`); a single root also mirrors 1:1
   * (`/assets/y` → `<dir>/y`). Relative refs in rendered markup (`../../images/icons.svg`) are
   * normalized to `/assets/…` by matching a root basename — depth-independent.
   */
  dir?: string | string[];
  /** Stylesheets to link in every preview document, before component CSS: a path relative to the
   *  assets dir, or a full URL (e.g. a web-font stylesheet), which is linked as it is. */
  css?: string[];
}

export interface StylesConfig {
  /** Where styles live. Only 'parallel' (the default: a separate tree mirroring the patterns) is
   *  supported so far; 'co-located' is reserved, and the config check rejects it as not supported yet. */
  strategy?: "parallel" | "co-located";
  /** Source tree root; also the home for global/base/theme styles. */
  dir: string;
  /**
   * SCSS entry point(s) to compile for `classOwnerIndex` + CSS bucketing, relative to `dir`.
   * When set, ONLY these are compiled (one map per entry, first-writer-wins across them).
   * When absent, every non-underscore `.scss` under `dir` is compiled (the glob default).
   *
   * A single design-system bundle (e.g. `htwoo.scss`) is the intended shape: attribution is
   * source-map-mediated, so one bundle compile attributes every rule to its authoring partial.
   * Pointing at a tree with several overlapping bundles (e.g. `htwoo.scss` + `htwoo.min.scss` +
   * `style.scss`) compiles the same partials into multiple bundles and yields ambiguous, not
   * merely noisy, attribution — name the one design-system entry here.
   */
  entry?: string | string[];
}

export interface ThemesConfig {
  /** Directory of the project's own theme files (custom-property value-sets). Leave it out to use
   *  only the themes pattern packages provide, with `default` naming one of them. */
  dir?: string;
  /** Default theme name applied via data-theme on the preview body: a project theme or a package's. */
  default: string;
  /** Switch wiring: attribute toggle (default) or per-theme stylesheet swap. */
  switch?: ThemeSwitch;
  /** Swatch configuration for the left-rail theme picker. */
  swatch?: {
    /**
     * Ordered CSS custom-property names sampled per theme for the swatch strip.
     * Defaults to ['--bodyBackground', '--themePrimary', '--accent'].
     * Per-theme swatchSlots override is deferred.
     */
    slots: SwatchSlots;
  };
}

export interface ShellConfig {
  /** Brand slot rendered at the top of the left rail. */
  brand?: ShellBrandConfig;
}

/**
 * A Pattern Dump project config.
 *
 * RESOLUTION BASE — the one rule: every directory path in this config (`patternsDir`,
 * `styles.dir`, `themes.dir`, `assets.dir`, `scriptsDir`, `helpers`, …) resolves against the
 * **project root** (the `--root` dir), NOT against this file's location and NOT against the
 * invoking `cwd`. This holds even when the file is supplied via `--config` from outside the
 * root — which is what lets PD open a read-only project it does not own.
 */
/**
 * A pattern package named in the config: the npm name, or the name plus options.
 * - `exclude`: extra globs of the package's templates to hide.
 * - `styles: false`: leave the package's stylesheets out (its templates, data, themes, scripts and
 *   assets are still used), e.g. when the project compiles that CSS itself. A package reached only
 *   as another package's peer can be named here just to carry this option.
 */
export type PackageReference = string | { name: string; exclude?: string[]; styles?: boolean };

export interface PatternDumpConfig {
  sourceDir: string;
  patternsDir: string;
  outDir: string;
  styles: StylesConfig;
  themes?: ThemesConfig;
  /** Asset directory configuration. Served at /assets/. */
  assets?: AssetsConfig;
  /** Path to the scripts directory (relative to project root). requireScript bare ids resolve here. */
  scriptsDir?: string;
  /**
   * Project-level behaviour scripts loaded into EVERY preview (e.g. hTWOo's src/ts dialog, nav,
   * pivot, …). requireScript is per-component and cannot express "load these for every preview".
   * Each entry is a bare id resolved from `scriptsDir` (root-relative — the single resolution base)
   * or an absolute URL. Injected after markup, before the component's own requireScripts. Absent →
   * none (current behaviour).
   */
  globalScripts?: string[];
  /**
   * Path to a project-level data directory (relative to the project root, the single resolution
   * base). Every `*.json` in it is deep-merged into one global context, applied BENEATH component
   * data: global → component defaults → variant → live. Component data always wins. Absent → no
   * global tier (current behaviour). Loaded once at startup — a config'd context merge, not a
   * pipeline; a `_data` edit needs a restart.
   */
  dataDir?: string;
  /**
   * Path to project Handlebars helpers — a directory of helper modules or a single module file,
   * relative to the project root (the single resolution base). Each module is either a registrar
   * (`module.exports = (Handlebars) => {…}`, the PatternLab/hTWOo shape) or a map of named functions.
   * Loaded once at startup; the renderer invokes them per render. Absent → core helpers only.
   */
  helpers?: string;
  /**
   * The always-injected document-base layer (M5-CSS-EXTERNAL §2.2: a preview links
   * closure + base + active theme). Names file or folder paths — e.g.
   * ['base/reset', 'base/root', 'base/font.base'] — relative to `styles.dir`; `"."` is the whole tree.
   *
   * When present and non-empty, PD links the compiled base layer (`/_pd/base.css`) into every
   * preview, BENEATH the component closure so it never overrides it. The layer holds:
   *  - every rule from a LISTED path, even one whose file belongs to a component (a component's
   *    `body` rule needed on every page, or a whole PatternLab stylesheet with `"."`);
   *  - the origin-unattributed rules — `:root`, `@font-face`, family-level classes with no single
   *    owning component — listed or not, so shared partials stay available.
   * Entries that match no file are reported at startup. Absent → not linked (a project whose classes
   * all attribute to components needs no shared layer). Class ownership is unchanged by listing: a
   * class still belongs to the component whose file authored it.
   */
  documentBase?: string[];
  /**
   * Global master switch for folder overview pages. Default: true.
   * A folder's index.md can set `overview: false` to suppress just that one folder.
   */
  overviews?: boolean;
  /** Shell chrome configuration (brand slot, future: shell tokens). */
  shell?: ShellConfig;
  /**
   * Pattern packages installed in this project, used ALONGSIDE its own patterns. Each package
   * describes itself with a `patternDump` field in its package.json (see PackageManifest); peer
   * dependencies that have one are followed. The project's own component wins when both define the
   * same handle. `{ name, exclude }` hides some of a package's templates (globs relative to its
   * patterns folder).
   */
  packages?: PackageReference[];
  /** Globs (relative to `patternsDir`) of the project's own templates to leave undiscovered. */
  exclude?: string[];
  /**
   * `pd build` — the static snapshot. `outDir` (relative to the root) defaults to the top-level
   * `outDir`; `basePath` is where the snapshot will be hosted ("/" at a domain root, "/docs/" under a
   * subpath) and defaults to "/". `audit: false` leaves the corpus audit out — it is not run, and the
   * static site has no Audit tab. All three can be overridden on the command line.
   */
  build?: { outDir?: string; basePath?: string; audit?: boolean };
  /** How responsive image variants are encoded (WebP). Defaults: quality 75, effort 4. A site can override
   *  either in `storefront.images`. */
  images?: ImageSettings;
  /** The storefront: a website of real HTML pages, written from markdown, beside the workbench. */
  storefront?: StorefrontConfig;
}

/**
 * The storefront. `pd dev` serves it on its own host (`live.localhost` unless `host` says otherwise),
 * the workbench on `pd.localhost`, both from `/`. `pd build` writes it to its own folder, apart from
 * the workbench snapshot. A page renders with the layout `layouts/<layout>` from the project's patterns.
 */
/** How responsive image variants are encoded. */
export interface ImageSettings {
  /** WebP quality, a whole number from 1 to 100. Default: 75. */
  quality?: number;
  /** WebP effort, 0 (fastest) to 6 (smallest files). Default: 4. */
  effort?: number;
}

export interface StorefrontConfig {
  /** Folder of the pages, relative to the root. `index.md` is `/`, `guides/setup.md` is `/guides/setup/`.
   *  `pagesDir`, `patternsDir` and `outDir` are three separate folders: none is another, and none is inside
   *  another. */
  pagesDir: string;
  /** Where `pd build` writes the storefront, relative to the root. Its own folder, apart from the workbench
   *  snapshot, and separate from `pagesDir` and `patternsDir` (see `pagesDir`). */
  outDir: string;
  /** The host name `pd dev` serves the storefront on. Default: `live.localhost`. */
  host?: string;
  /**
   * Where the built workbench will be hosted: an absolute http(s) URL with no query or fragment, e.g.
   * `https://workbench.example.com/`, or, for a workbench on the storefront's own host, a path such as
   * `/workbench/` (then built with that base path, and its previews kept out of the storefront's
   * `robots.txt`; an absolute URL on `url`'s origin counts as the same host too). Loaded with exactly
   * one trailing slash, whether written with one or not; links from storefront pages to the workbench are
   * this value followed by a path. Used by `pd build` only: in `pd dev` those links always go to
   * `http://pd.localhost:<port>`, the workbench of the same process.
   */
  workbenchUrl?: string;
  /**
   * The site's address, such as `https://example.com/`: an absolute http(s) URL with no path (the storefront
   * is served from the root of its host), no query or fragment; loaded as its origin followed by `/`. With it,
   * pages get a canonical URL, Open Graph and JSON-LD, and `pd build` writes a sitemap; without it they are
   * left out, and `pd build` says so once.
   */
  url?: string;
  /** The language of every page, as `<html lang>` takes it (a BCP 47 tag such as `de-AT`). Default: `en`. */
  lang?: string;
  /**
   * `false` keeps the whole site out of search engines (a staging site): every page gets `noindex`,
   * `robots.txt` disallows everything, and there is no sitemap. Default: `true`.
   */
  index?: boolean;
  /** The image a page shows in link previews when it names none of its own: a raster image in the assets
   *  (PNG, JPEG, GIF or WebP), such as `/assets/images/share.png`. */
  image?: string;
  /** This site's image encoding, over the project's `images`. */
  images?: ImageSettings;
  /**
   * Values every page of the site shares, such as its title or the line in its footer. Every layout gets
   * them as `site`; a page cannot set them. Which keys there are, and their types, is what the `site`
   * property of `partials/base`'s schema declares: they are checked against it, not inferred.
   *
   * One key is Pattern Dump's: `navigations`, named lists of links (a footer's, a sidebar's), each entry a
   * page, an external link or a group, nested to any depth. Their shape is fixed (StorefrontNavEntry) and
   * checked by Pattern Dump; the skin's schema only lists the names it uses.
   */
  site?: Record<string, unknown> & { navigations?: Record<string, StorefrontNavEntry[]> };
}

/**
 * One entry of a declared navigation (`storefront.site.navigations.<name>`):
 * - a page, by its path in the pages folder (`"guides/setup.md"`), labelled with its title unless `label`;
 * - an external link: `href` is `https:`, `http:` or `mailto:`, or a path from the site's root (`/feed.xml`);
 * - a group: a `label` and its `children`, entries of any of the three kinds.
 */
export type StorefrontNavEntry =
  | { page: string; label?: string }
  | { href: string; label: string }
  | { label: string; children: StorefrontNavEntry[] };

export function defineConfig(config: PatternDumpConfig): PatternDumpConfig {
  return config;
}
