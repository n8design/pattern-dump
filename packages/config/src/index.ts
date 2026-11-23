// @pattern-dump/config
// Load and validate pattern-dump.config (.ts/.json, TS wins). Shared config types.
import type { ShellBrandConfig, SwatchSlots, ThemeSwitch } from "@pattern-dump/contracts";
export type { ShellBrandConfig, SwatchSlots, ThemeSwitch };
export { ConfigError, configProblems, configWarnings, legacyKeys, sameHostWorkbenchPath, storefrontBasePath, suggest, validateConfig, withSourceDefaults } from "./validate.js";
export { withOwnManifest } from "./own-manifest.js";

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
  /** Symbol images (one SVG per symbol in an asset root's `symbols/` folder, shown by `![Alt](#stem)` on a site page). */
  symbols?: SymbolsConfig;
}

export interface SymbolsConfig {
  /** The colour token `currentColor` becomes in a symbol's standalone file (`/_pd/symbols/<stem>.svg`), which has no
   *  text colour around it. Read from the document base layer like every token. Default: `"--color-text"`. */
  currentColor?: string;
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
  /** The component the workbench opens on at its root, by id (`layouts/home`, `atoms/button`), in pd dev and in the
   *  static build. One that doesn't exist stops pd dev and pd build at start. Without it, the root opens on nothing. */
  start?: string;
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

/** Checks `pd build` can be told to skip: `a11y`, the site pages' accessibility check (axe, and one main landmark and
 *  one <h1> per page), and `html`, the components' markup checked against HTML's content model (html-validate). Every
 *  check runs unless named. */
export const SKIPPABLE_CHECKS = ["a11y", "html"] as const;
export type SkippableCheck = (typeof SKIPPABLE_CHECKS)[number];

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
   * subpath) and defaults to "/". `audit: false` leaves the corpus audit out: it is not run, and the
   * workbench snapshot has no Audit tab. All three can be overridden on the command line. `skipChecks` names checks the
   * build leaves out (SKIPPABLE_CHECKS), for a quick local build: none by default, and the build report names each
   * one skipped. `--skip-checks` on the command line replaces it. `workbench: false` writes the site only:
   * for a site whose components come from a style guide package that publishes its own workbench, at
   * `site.workbenchUrl` (default: true). `outDir` and `basePath` are then not used. `graph: false` leaves the
   * project graph out of the workbench snapshot (`api/graph.json`, the same JSON as `pd graph --json`), for a project
   * whose structure shouldn't be published; `pd graph` works either way (default: true).
   */
  build?: { outDir?: string; basePath?: string; audit?: boolean; skipChecks?: SkippableCheck[]; workbench?: boolean; graph?: boolean };
  /** How responsive image variants are encoded (WebP). Defaults: quality 75, effort 4. A site can override
   *  either in `site.images`. */
  images?: ImageSettings;
  /**
   * The MCP server (`pd dev`, and `pd mcp` over stdio): `host` is the name it answers on, at pd dev's port. Default:
   * `mcp.localhost`, so its address is `http://mcp.localhost:<port>/`. A name of its own: not the workbench's
   * (`localhost`, `127.0.0.1`, `pd.localhost`) nor the site's. `http://localhost:<port>/mcp` answers too, for a
   * client that doesn't resolve `*.localhost`.
   */
  mcp?: { host?: string };
  /** The storefront: a website of real HTML pages, written from markdown, beside the workbench. */
  storefront?: StorefrontConfig;
}

/** How responsive image variants are encoded. */
export interface ImageSettings {
  /** WebP quality, a whole number from 1 to 100. Default: 75. */
  quality?: number;
  /** WebP effort, 0 (fastest) to 6 (smallest files). Default: 4. */
  effort?: number;
}

/**
 * @deprecated Use SiteConfig. Removed in 1.0. The shape of `storefront`, the old name of `site`: the values every page
 * shares are its `site`, where SiteConfig has `globals`.
 */
export interface StorefrontConfig {
  /** Folder of the pages, relative to the root. `index.md` is `/`, `guides/setup.md` is `/guides/setup/`.
   *  `pagesDir`, `patternsDir` and `outDir` are three separate folders: none is another, and none is inside
   *  another. */
  pagesDir: string;
  /** Where `pd build` writes the site, relative to the root. Its own folder, apart from the workbench
   *  snapshot, and separate from `pagesDir` and `patternsDir` (see `pagesDir`). */
  outDir: string;
  /** The host name `pd dev` serves the site on. Default: `live.localhost`. */
  host?: string;
  /**
   * Where the built workbench will be hosted: an absolute http(s) URL with no query or fragment, e.g.
   * `https://workbench.example.com/`, or, for a workbench on the site's own host, a path such as
   * `/workbench/` (then built with that base path, and its previews kept out of the site's
   * `robots.txt`; an absolute URL on `url`'s origin counts as the same host too). Loaded with exactly
   * one trailing slash, whether written with one or not; links from site pages to the workbench are
   * this value followed by a path. Used by `pd build` only: in `pd dev` those links always go to
   * `http://pd.localhost:<port>`, the workbench of the same process.
   */
  workbenchUrl?: string;
  /**
   * The site's address, such as `https://example.com/`: an absolute http(s) URL with no query or fragment; loaded
   * with exactly one trailing slash. It may have a path, such as `https://example.github.io/project/`: the site is
   * then published under that path (its base path), and every page, stylesheet, script and image it links is
   * served under it, in `pd dev` too. With it, pages get a canonical URL, Open Graph and JSON-LD, and `pd build`
   * writes a sitemap; without it they are left out, `pd build` says so once, and the site is served from `/`.
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
   * The site's own additions to every page's `<head>`, such as an analytics script or a search engine's verification
   * tag: a Handlebars file relative to the root, such as `./head.hbs`, rendered with `site` (plain Handlebars, without
   * Pattern Dump's helpers) and placed after the skin's `partials/head`. It is checked as `partials/head` is: only
   * `<meta>`, `<link>`, `<script>`, `<style>` and `<noscript>`, and none of the tags Pattern Dump writes itself.
   */
  head?: string;
  /**
   * Values every page of the site shares, such as its title or the line in its footer. Every layout gets
   * them as `site`; a page cannot set them. Which keys there are, and their types, is what the `site`
   * property of `partials/base`'s schema declares: they are checked against it, not inferred.
   *
   * One key is Pattern Dump's: `navigations`, named lists of links (a footer's, a sidebar's), each entry a
   * page, an external link or a group, nested to any depth. Their shape is fixed (SiteNavEntry) and
   * checked by Pattern Dump; the skin's schema only lists the names it uses.
   */
  site?: Record<string, unknown> & { navigations?: Record<string, SiteNavEntry[]> };
  /**
   * The categories a page can be in (its `categories:`), by key: the only values a page may name, so a typo fails the
   * build. Independent of the folders, so a page changes category without changing its URL. A key is lowercase
   * letters, digits and hyphens. `aliases` are the category's old keys: a page that still names one builds, as the
   * category, with a note naming the page so it can be updated.
   */
  categories?: Record<string, SiteCategory>;
  /**
   * The tags a page can have (its `tags:`), by key, declared as categories are. Optional: without it every tag works,
   * labelled with its key. With it, it is the list, so a typo fails the build; an alias is an old key that still builds.
   */
  tags?: Record<string, SiteTag>;
  /**
   * A page per tag (`/tags/<key>/`) and an index of them (`/tags/`), each through the skin's `layouts/tag` and
   * `layouts/tags`. Left out: on when the skin has `layouts/tag`. `false`: off. `true` or an object: on, and a missing
   * layout is a problem. `path`: the URL segment (default `tags`); `title`: the index page's title (default "Tags").
   */
  tagPages?: boolean | SiteTermPages;
  /** A page per category and an index of them, as tagPages (`layouts/category`, `layouts/categories`; default path
   *  `categories`, title "Categories"). */
  categoryPages?: boolean | SiteTermPages;
  /**
   * Search with Pagefind: pd build indexes each page's own content and writes the index to `_pd/search/` in the site.
   * Pagefind is the project's own (`npm install --save-dev pagefind`). Left out: on when the project has Pagefind.
   * `true`: on, and a build without Pagefind stops. `false`: off. The search UI is a component of the skin's.
   */
  search?: boolean;
  /**
   * llms.txt (llmstxt.org): pd build writes one at the site's root, with the site's title and description and each
   * page's title, link and teaser, by collection; the same pages as the sitemap. Left out: on, unless `index` is
   * false. `false`: none.
   */
  llms?: boolean;
  /** pd build's checks of the site against its style guide. */
  checks?: SiteChecks;
}

/** site.checks: what pd build checks the site's classes and custom properties against. */
export interface SiteChecks {
  /**
   * A class on a page that no component or style of the style guide defines: `"warning"` (the default) lists it in
   * the report, `"error"` stops the build, `"off"` skips the check.
   */
  classes?: "warning" | "error" | "off";
  /** Classes a page may carry anyway: names, or a prefix ending in `*` (`"chart-*"`). */
  allowClasses?: string[];
  /** Custom properties JavaScript sets, which a skin's var() may read without a definition in CSS: names, or a prefix
   *  ending in `*` (`"--chart-*"`). */
  allowProperties?: string[];
}

/** site.tagPages and site.categoryPages as an object. */
export interface SiteTermPages {
  /** The pages' first URL segment: lowercase letters, digits and hyphens. */
  path?: string;
  /** The index page's title. */
  title?: string;
}

/** A declared tag (`site.tags.<key>`): the same shape as a category. */
export type SiteTag = SiteCategory;

/** A declared category (`site.categories.<key>`). */
export interface SiteCategory {
  label: string;
  description?: string;
  /** Old keys of this category, kept after a rename. */
  aliases?: string[];
}

/**
 * One entry of a declared navigation (`site.globals.navigations.<name>`):
 * - a page, by its path in the pages folder (`"guides/setup.md"`), labelled with its title unless `label`;
 * - an external link: `href` is `https:`, `http:` or `mailto:`, or a path from the site's root (`/feed.xml`);
 * - a group: a `label` and its `children`, entries of any of the three kinds.
 */
export type SiteNavEntry =
  | { page: string; label?: string }
  | { href: string; label: string }
  | { label: string; children: SiteNavEntry[] };

/** @deprecated Use SiteChecks. Removed in 1.0. */
export type StorefrontChecks = SiteChecks;
/** @deprecated Use SiteTermPages. Removed in 1.0. */
export type StorefrontTermPages = SiteTermPages;
/** @deprecated Use SiteTag. Removed in 1.0. */
export type StorefrontTag = SiteTag;
/** @deprecated Use SiteCategory. Removed in 1.0. */
export type StorefrontCategory = SiteCategory;
/** @deprecated Use SiteNavEntry. Removed in 1.0. */
export type StorefrontNavEntry = SiteNavEntry;

/**
 * What a project writes: the config, where `sourceDir`, `patternsDir` and `styles` may be left out (a site whose
 * patterns and styles all come from pattern packages has none of its own). `validateConfig` fills them in
 * (`withSourceDefaults`), so everything that reads a loaded config gets all three.
 */
export type PatternDumpConfigInput = Omit<PatternDumpConfig, "sourceDir" | "patternsDir" | "styles" | "storefront">
  & Partial<Pick<PatternDumpConfig, "sourceDir" | "patternsDir" | "styles">>
  & {
    /** The website: real HTML pages, written from markdown, beside the workbench. */
    site?: SiteConfig;
    /** @deprecated The old name of `site` (before 0.8.0), with `site.globals` as `site`. Still loaded until 1.0,
     *  with a warning per key; both at once is a problem. */
    storefront?: StorefrontConfig;
  };

/** The website as a config writes it (`site`), with the values every page shares as
 *  `globals`. Layouts read them as `site`, as before. */
export type SiteConfig = Omit<StorefrontConfig, "site"> & {
  /** Values every page of the site shares, such as its title or the line in its footer; every layout gets them as
   *  `site`. Checked against the `site` property of `partials/base`'s schema. `navigations` is Pattern Dump's:
   *  named lists of links (SiteNavEntry). */
  globals?: StorefrontConfig["site"];
};

/**
 * Type checking for a config file; the object is returned unchanged. It fills in no defaults: what the config leaves
 * out is left out, so a folder the project's own package.json names (withOwnManifest) is not taken for one the config
 * names too. `validateConfig` fills the defaults, after the manifest's folders are in.
 */
export function defineConfig(config: PatternDumpConfigInput): PatternDumpConfigInput {
  return config;
}
