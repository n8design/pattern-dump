// @pattern-dump/config
// Load and validate pattern-dump.config (.ts/.json, TS wins). Shared config types.
import type { ShellBrandConfig, SwatchSlots, ThemeSwitch } from "@pattern-dump/contracts";
export type { ShellBrandConfig, SwatchSlots, ThemeSwitch };
export { ConfigError, configProblems, validateConfig } from "./validate.js";

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
  /** Directory of theme files (custom-property value-sets). */
  dir: string;
  /** Default theme name applied via data-theme on the preview body. */
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
/** A pattern package named in the config: the npm name, or the name plus extra excludes. */
export type PackageReference = string | { name: string; exclude?: string[] };

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
   * closure + base + active theme). Names the base-origin path(s) — e.g.
   * ['base/reset', 'base/root', 'base/font.base'] — relative to `styles.dir`.
   *
   * When present and non-empty, PD links the compiled base layer (`/_pd/base.css`, the
   * origin-unattributed shared rules — resets, `:root`, `@font-face`, and family-level classes
   * with no single owning component) into every preview, BENEATH the component closure so it
   * never overrides it. Absent → not linked (current behaviour; a project whose classes all
   * attribute to components needs no shared layer). The `__base__` layer must still carry no
   * MIS-attributed rules — anything with a genuine owner attributes to that owner.
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
}

export function defineConfig(config: PatternDumpConfig): PatternDumpConfig {
  return config;
}
