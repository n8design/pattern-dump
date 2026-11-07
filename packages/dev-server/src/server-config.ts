// Resolved server configuration — every path and flag derived from PatternDumpConfig, once.
//
// PURE: path resolution and flag defaulting only, no I/O and no await. That is what makes it
// separable from the subsystem init that follows it in startDevServer (highlighter, renderer,
// hotreloader, sass tracker), which does have I/O and produces live objects.
//
// Everything is resolved against `cwd` — the ONE resolution base. PD reads foreign design systems
// whose config paths are relative to their own root, not to PD's, and `--root` may differ from
// `--config`; resolving in one place is what keeps that straight.

import { basename, join, resolve } from "node:path";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { PD_HOSTS, type ThemeSwitch } from "@pattern-dump/contracts";
import type { PatternRoot } from "@pattern-dump/discovery";
import type { ResolvedPackage } from "./packages.js";

/** One SCSS tree to attribute and bucket: the project's `styles.dir`, or a package's. */
export interface StyleRoot {
  readonly dir: string;
  /** Compile only these entries (absolute); absent → every non-partial file under `dir`. */
  readonly entries: string[] | undefined;
  /** Package name; absent for the project. */
  readonly source?: string;
  /** documentBase: paths (relative to `dir`) whose rules always go into the base layer. */
  readonly base?: readonly string[];
}

export interface ResolvedConfig {
  readonly port: number;
  readonly wsPort: number;
  readonly cwd: string;
  readonly config: PatternDumpConfig;

  /** Pattern packages in use, in precedence order (named first, then their peers). */
  readonly packages: ResolvedPackage[];
  /** Every patterns folder: the project's first, then each package's. Discovery reads all of them. */
  readonly patternRoots: PatternRoot[];
  /** The same folders as plain paths, for folder `index.md` lookups (project first). */
  readonly patternDirs: string[];
  /** Every SCSS tree: the project's first, then each package's. */
  readonly styleRoots: StyleRoot[];
  /** Global data folders, packages first so the project's data overrides theirs. */
  readonly dataDirs: string[];
  /** Helper modules or folders, packages first so a project helper can replace a package's. */
  readonly helperPaths: string[];
  /** Behaviour script folders, searched in order (project first). */
  readonly scriptsDirs: string[];

  /** The PROJECT's own patterns folder — what the watcher and `pd export` work on. */
  readonly patternsDir: string;
  /** The PROJECT's own styles folder. */
  readonly stylesDir: string;
  /** When set, compile only these SCSS entries for the class-owner index; when absent,
   *  buildAllStyleData falls back to the non-underscore glob. */
  readonly stylesEntries: string[] | undefined;
  /** Every theme folder, project first. */
  readonly themeDirs: string[];
  /** The first theme folder (the project's when it declares themes); null when no source has themes. */
  readonly themesDir: string | null;
  readonly defaultTheme: string | undefined;

  /** Asset roots, each addressable by basename under /assets/; the first also mirrors 1:1. */
  readonly assetRoots: string[];
  readonly assetRootNames: string[];
  /** The first asset root, for single-root consumers. */
  readonly assetsDir: string | null;
  readonly assetsCss: string[];

  readonly scriptsDir: string | null;
  /** Bare ids/URLs loaded into every preview (the project behaviour layer). */
  readonly globalScripts: string[];
  /** Prepend globalScripts to a component's own requireScripts, deduped, so they load first. */
  withGlobalScripts(own: string[] | undefined): string[];

  /** The storefront, when the project has one: its folders resolved against the root, and the host
   *  `pd dev` serves it on. null without a `storefront` block — every host then serves the workbench. */
  readonly storefront: {
    readonly pagesDir: string;
    readonly outDir: string;
    readonly host: string;
    readonly site: Record<string, unknown> | undefined;
    readonly workbenchUrl: string | undefined;
  } | null;

  readonly overviewsEnabled: boolean;
  /** Inject the compiled base layer (/_pd/base.css) beneath every preview's closure. Only when
   *  documentBase is declared and non-empty — absent means not linked. */
  readonly documentBaseEnabled: boolean;
  /** 'stylesheet' links ONLY the active theme (correct for bare-`:root` theme sets like hTWOo's,
   *  which collide when all are linked); 'attribute' (default) links all and toggles [data-theme]. */
  readonly themeSwitch: ThemeSwitch;
  /** Swatch properties for the PROJECT's themes (config.themes.swatch.slots). */
  readonly swatchSlots: string[];
  /** Swatch properties for a pattern package's themes, which the project config does not describe. */
  readonly packageSwatchSlots: string[];
}

/**
 * Asset roots hidden by an earlier root with the same folder name. `/assets/<name>/…` is served from
 * the FIRST root called `<name>` (the project's come first), so a later one is never reachable, not
 * even for files only it has. `pd dev` warns about these, and `pd build` leaves them out.
 */
export function shadowedAssetRoots(assetRoots: readonly string[]): { root: string; by: string }[] {
  const first = new Map<string, string>();
  const shadowed: { root: string; by: string }[] = [];
  for (const root of assetRoots) {
    const by = first.get(basename(root));
    if (by === undefined) first.set(basename(root), root);
    else if (by !== root) shadowed.push({ root, by });
  }
  return shadowed;
}

const DEFAULT_SWATCH_SLOTS = ["--bodyBackground", "--themePrimary", "--accent"];

export function resolveServerConfig(
  config: PatternDumpConfig,
  cwd: string,
  opts: { port?: number; wsPort?: number } = {},
  packages: ResolvedPackage[] = [],
): ResolvedConfig {
  const port   = opts.port   ?? Number(process.env["PD_PORT"]    ?? 4000);
  const wsPort = opts.wsPort ?? Number(process.env["PD_WS_PORT"] ?? (port + 1));

  const patternsDir   = resolve(cwd, config.patternsDir);
  const stylesDir     = resolve(cwd, config.styles.dir);
  const stylesEntries = config.styles.entry
    ? (Array.isArray(config.styles.entry) ? config.styles.entry : [config.styles.entry])
        .map(e => resolve(stylesDir, e))
    : undefined;

  const inPackage = (p: ResolvedPackage, rel: string): string => join(p.dir, rel);
  const asList = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];

  const patternRoots: PatternRoot[] = [
    { dir: patternsDir, ...(config.exclude?.length ? { exclude: config.exclude } : {}) },
    ...packages.filter(p => p.manifest.patterns).map(p => ({
      dir: inPackage(p, p.manifest.patterns!), source: p.name, ...(p.exclude.length ? { exclude: p.exclude } : {}),
    })),
  ];
  const styleRoots: StyleRoot[] = [
    { dir: stylesDir, entries: stylesEntries, base: config.documentBase },
    ...packages.filter(p => p.manifest.styles && p.styles).map(p => {
      const dir = inPackage(p, p.manifest.styles!.dir);
      const entries = asList(p.manifest.styles!.entry).map(e => resolve(dir, e));
      return { dir, entries: entries.length ? entries : undefined, source: p.name, base: p.manifest.styles!.documentBase };
    }),
  ];

  // Themes from every source — the project's folder first, so its theme wins a name clash. Components
  // built on a package need that package's themes even when the project adds its own.
  const themePackages = packages.filter(p => p.manifest.themes);
  const themeDirs = [
    ...(config.themes?.dir ? [resolve(cwd, config.themes.dir)] : []),
    ...themePackages.map(p => inPackage(p, p.manifest.themes!.dir)),
  ];
  // 'stylesheet' as soon as any source needs it: its bare `:root` sets collide when all are linked,
  // while [data-theme]-scoped sets work in either mode.
  const switches = [config.themes?.switch, ...themePackages.map(p => p.manifest.themes!.switch)];
  const themeSwitch: ThemeSwitch = switches.includes("stylesheet") ? "stylesheet" : "attribute";

  const assetRoots = [
    ...asList(config.assets?.dir).map(d => resolve(cwd, d)),
    ...packages.flatMap(p => (p.manifest.assets ?? []).map(a => inPackage(p, a))),
  ];

  const globalScripts = [...new Set([
    ...packages.flatMap(p => p.manifest.globalScripts ?? []),
    ...(config.globalScripts ?? []),
  ])];
  const scriptsDirs = [
    ...(config.scriptsDir ? [resolve(cwd, config.scriptsDir)] : []),
    ...packages.filter(p => p.manifest.scripts).map(p => inPackage(p, p.manifest.scripts!)),
  ];
  const documentBaseEnabled = (Array.isArray(config.documentBase) && config.documentBase.length > 0)
    || packages.some(p => p.styles && (p.manifest.styles?.documentBase?.length ?? 0) > 0);

  return {
    port, wsPort, cwd, config,
    packages,
    patternRoots,
    patternDirs: patternRoots.map(r => r.dir),
    styleRoots,
    dataDirs: [
      ...packages.filter(p => p.manifest.data).map(p => inPackage(p, p.manifest.data!)),
      ...(config.dataDir ? [resolve(cwd, config.dataDir)] : []),
    ],
    helperPaths: [
      ...packages.filter(p => p.manifest.helpers).map(p => inPackage(p, p.manifest.helpers!)),
      ...(config.helpers ? [resolve(cwd, config.helpers)] : []),
    ],
    scriptsDirs,
    patternsDir,
    stylesDir,
    stylesEntries,
    themeDirs,
    themesDir: themeDirs[0] ?? null,
    defaultTheme: config.themes?.default ?? themePackages[0]?.manifest.themes?.default,
    assetRoots,
    assetRootNames: assetRoots.map(r => basename(r)),
    assetsDir:      assetRoots[0] ?? null,
    assetsCss:      config.assets?.css ?? [],
    scriptsDir:     scriptsDirs[0] ?? null,
    globalScripts,
    withGlobalScripts: (own) => [...new Set([...globalScripts, ...(own ?? [])])],
    storefront: config.storefront ? {
      pagesDir: resolve(cwd, config.storefront.pagesDir),
      outDir: resolve(cwd, config.storefront.outDir),
      host: (config.storefront.host ?? PD_HOSTS.storefront).toLowerCase(),
      site: config.storefront.site,
      workbenchUrl: config.storefront.workbenchUrl,
    } : null,
    overviewsEnabled:    config.overviews !== false,
    documentBaseEnabled,
    themeSwitch,
    swatchSlots:         config.themes?.swatch?.slots ?? DEFAULT_SWATCH_SLOTS,
    packageSwatchSlots:  DEFAULT_SWATCH_SLOTS,
  };
}
