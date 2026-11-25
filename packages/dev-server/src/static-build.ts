// `pd build` — the static snapshot.
//
// Starts the dev server headless (no watcher, no live reload), requests every route the shell uses,
// and writes each response to the file `staticPathFor` names. Every byte therefore comes from the
// exact route code `pd dev` serves — there is no second renderer to drift from the first.
//
// Two adjustments are made to what the server returned, and only these:
//   - base path: root-relative PD URLs (/_pd/, /api/, /preview/, /source/, /assets/) inside HTML,
//     CSS and JSON gain the base path, so the snapshot can live under a subpath. A preview document
//     is included — its <link>/<script>/url() references are root-relative too.
//   - the shell: one shell page per route, carrying the static ShellRuntime instead of a port.

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createImageCache } from "@pattern-dump/build";
import { sameHostWorkbenchPath, type PatternDumpConfig, SKIPPABLE_CHECKS, type SkippableCheck } from "@pattern-dump/config";
import {
  componentUrl, dataSourceUrl, normalizeBasePath, overviewUrl, PD_ROUTE_PREFIX, PD_ROUTES, previewUrl, renderedSourceUrl,
  staticPathFor, themeCssUrl,
  type ComponentDetailResponse, type ComponentTree, type ShellRuntime, type StorefrontPagesResponse, type ThemeSummary, type TreeNode,
} from "@pattern-dump/contracts";
import { startDevServer } from "./index.js";
import { buildShellHtml } from "./http-utils.js";
import { imageCacheDir, socialCacheDir } from "./image-route.js";
import { socialDir } from "./storefront/social-images.js";
import { loadPatternPackages } from "./packages.js";
import { resolveServerConfig, shadowedAssetRoots } from "./server-config.js";
import { createSnapshotWriter } from "./snapshot-writer.js";
import { readPages, todayOf, type ScheduledPage } from "./storefront/pages.js";
import { isPageImageUrl } from "./storefront/page-images.js";
import { crawlStorefront, hostTransport } from "./storefront/crawl.js";
import { checkLinks, linkedWorkbenchRoutes } from "./storefront/links.js";
import { checkPageBasics } from "./storefront/page-basics.js";
import { BrowserUnavailableError, launchChromium, loadProjectPlaywright, runBrowserChecks, VIEWPORTS, type PlaywrightModule, type PwBrowser } from "./storefront/browser-checks.js";
import { CARD_CHROMIUM_ARGS, renderCards } from "./storefront/social-render.js";
import { PageCheckError, runPagesA11y, type PageA11yFinding } from "@pattern-dump/a11y";
import { llmsTxt, workbenchRobotsTxt } from "./storefront/site-files.js";
import { checkClasses } from "./storefront/class-check.js";
import { checkProperties } from "./storefront/property-check.js";
import { withNoindex } from "./storefront/base-path.js";
import { changedInputs, stampInputs } from "./input-stamps.js";
import { buildSearchIndex, SEARCH_PATH, searchPagefind, type PagefindModule, type SearchRecord } from "./storefront/search.js";

export interface StaticBuildOptions {
  /** Absolute output directory. Replaced as a whole once every check has passed; a build that stops leaves it as it was. */
  outDir: string;
  /** Where the snapshot will be hosted: "/" or "/sub/path/". */
  basePath?: string;
  /** The pattern-dump version recorded in the snapshot. */
  pdVersion: string;
  /** Include the corpus audit (default: config.build.audit, then true). When false it is not run. */
  audit?: boolean;
  /** A fixed build time. Every time stamp in the snapshot — the shell's `builtAt`, the audit's
   *  `generatedAt`, the server's `startedAt` — then comes from it, so two builds of an unchanged
   *  project are byte-identical. Default: real time. */
  now?: Date;
  log?: (line: string) => void;
  /** `pd build --browser`: also check the storefront's pages in Chromium (browser-checks.ts), with the project's
   *  own Playwright. */
  browser?: boolean;
  /** Where `browser` gets Playwright from. Default: the project's own (loadProjectPlaywright). */
  loadPlaywright?: (root: string) => Promise<PlaywrightModule>;
  /** Where search gets Pagefind from. Default: the project's own (loadProjectPagefind); undefined for none. */
  loadPagefind?: (root: string) => Promise<PagefindModule | undefined>;
  /** How many worker threads check the storefront's pages for accessibility (@pattern-dump/a11y runPagesA11y);
   *  1 checks them in this thread. Default: defaultCheckWorkers(), the cores less one, at most 8, within memory. */
  checkWorkers?: number;
  /** Checks to leave out (SKIPPABLE_CHECKS in @pattern-dump/config). Default: config.build.skipChecks, else none.
   *  The report lists them (`skippedChecks`). */
  skipChecks?: readonly string[];
}

/** Not a test's watcher barrier (`.__testOnly_barrier`, which tests and the settle hook write into watched
 *  folders, asset folders among them): those never reach the build's output. */
const notABarrier = (path: string): boolean => basename(path) !== ".__testOnly_barrier";
/** A helpers path is a folder of modules or one module file; a missing one is named as a file. */
const isFolder = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };

export interface StaticBuildReport {
  outDir: string;
  basePath: string;
  files: number;
  bytes: number;
  components: number;
  /** Requests that did not return 200: a component that fails to render, a missing asset. They are not
   *  written, and do not fail the build. */
  warnings: string[];
  /** Notes about what was built, one line each: a storefront heading whose anchor was suffixed because the
   *  layout has that id. Nothing is left out for them. */
  notes: string[];
  /** Stylesheets linked by a borrowed class: the (component, owner) pairs, each a STYLE_BORROWED on its component. */
  borrowedStyles: number;
  /** false when the workbench was not built (build.workbench: false): outDir, basePath, files and components then
   *  say nothing about it. Absent when it was. */
  workbench?: false;
  /** The storefront's own output root, when the project has a storefront. */
  storefront?: { outDir: string; basePath: string; pages: number; files: number; bytes: number };
  /** The storefront's link check: the site pages read, the references checked, the other hosts listed in the notes. */
  links?: { pages: number; references: number; external: number };
  /** The storefront's accessibility check (axe in jsdom, and one <main> and one <h1> per page): the site pages read,
   *  and one line per rule that only warns, with its pages. An error stops the build instead. */
  accessibility?: { pages: number; warnings: string[]; browser?: boolean };
  /** The checks this build left out (skipChecks), in SKIPPABLE_CHECKS order. Absent when every check ran. */
  skippedChecks?: SkippableCheck[];
  /** The storefront's search index (search.ts), written to its _pd/search/: the pages in it, and its files. Absent
   *  when the site has no search. */
  search?: { pages: number; files: number; bytes: number };
  /** The class check (storefront.checks.classes): with "warning", one line per class a page carries that the style
   *  guide doesn't define; with "error" a class stops the build, so `warnings` is empty. Absent with "off". */
  classes?: { severity: "warning" | "error"; warnings: string[] };
  /** llms.txt, at the site's root: how many pages it lists. Absent when none is written (storefront.llms). */
  llms?: { pages: number };
  /** The site's feeds (site.feeds): how many files. Absent when it has none. */
  feeds?: { files: number };
  /** The site's social images (social-images.ts): the pages with a card, and where each card came from (rendered by
   *  this build, the cache, the committed folder). `missing`: one line per page whose card is missing or stale and
   *  couldn't be rendered (no Playwright, or no Chromium); each such page takes the site's image, `siteImage` says
   *  whether there is one. Absent without site.socialImages. */
  socialImages?: { pages: number; rendered: number; cached: number; committed: number; missing: string[]; siteImage: boolean };
  /** `--browser`: one line per image whose chosen variant doesn't fit the box it is laid out in. */
  images?: { warnings: string[] };
  /** The storefront's drafts left out of the build (a draft, and each page under a draft folder's index.md), by
   *  their path in the pages folder. Absent when there are none. */
  drafts?: string[];
  /** Of the drafts, how many took `draft` from a folder's childDefaults, by that index.md, sorted by it. */
  draftsByDefaults?: { from: string; pages: number }[];
  /** The storefront's pages held back until a later day (a page dated after the build's day, and each page under a
   *  scheduled folder's index.md), each with the first day it is built. Absent when there are none. */
  scheduled?: ScheduledPage[];
  ms: number;
}

/** A word --browser searches for: the longest word of the first indexed page's title (by route) that has one of three
 *  letters or more, so it finds that page. */
export function searchWord(records: readonly SearchRecord[]): string {
  for (const r of [...records].sort((a, b) => a.route < b.route ? -1 : 1)) {
    const words = r.title.match(/\p{L}{3,}/gu);
    if (words) return [...words].sort((a, b) => b.length - a.length)[0]!;
  }
  return "search";
}

export async function buildStaticSite(
  config: PatternDumpConfig,
  root: string,
  opts: StaticBuildOptions,
): Promise<StaticBuildReport> {
  const watch: InputWatch = {};
  try {
    return await buildOnce(config, root, opts, watch);
  } catch (e) {
    // A build that fails after an input changed may have failed because of the change (a page removed while
    // the checks ran, say): the change is what to report, with what the build said.
    if (!watch.changed || (e instanceof InputsChangedError)) throw e;
    const changed = await watch.changed();
    if (!changed.length) throw e;
    throw new InputsChangedError(`the build stopped (it said: ${e instanceof Error ? e.message.split("\n")[0]!.replace(/:$/, "") : String(e)})`, changed, e);
  }
}

/** What buildOnce has looked at: the inputs that differ from the build's start, once it has taken its stamps. */
interface InputWatch { changed?: () => Promise<string[]> }

/** The project changed while it was being built. */
export class InputsChangedError extends Error {
  override readonly name = "InputsChangedError";
  constructor(written: string, changed: readonly string[], cause?: unknown) {
    const shownMax = 20;
    const list = changed.slice(0, shownMax).map(c => `  - ${c}`)
      .concat(changed.length > shownMax ? [`  - and ${changed.length - shownMax} more`] : []);
    super(`pd build: the project changed while it was being built, so ${written}. Run pd build again once the files `
      + `are saved:\n${list.join("\n")}`, cause === undefined ? undefined : { cause });
  }
}

async function buildOnce(
  config: PatternDumpConfig,
  root: string,
  opts: StaticBuildOptions,
  watch: InputWatch,
): Promise<StaticBuildReport> {
  const started = performance.now();
  const logLine = opts.log ?? (() => {});
  const log = (line: string): void => logLine(`${line} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
  const basePath = normalizeBasePath(opts.basePath ?? config.build?.basePath);
  const includeAudit = opts.audit ?? config.build?.audit ?? true;
  // build.workbench: false: a site whose workbench is published by another build (its style guide's) writes the
  // storefront only; outDir and the base path are not used.
  const buildWorkbench = config.build?.workbench ?? true;
  const outDir = resolve(opts.outDir);
  const cfg = resolveServerConfig(config, root, {}, loadPatternPackages(config.packages, root));
  if (!buildWorkbench && !cfg.storefront) {
    throw new Error("pd build: build.workbench is false and the project has no site, so there is nothing to build");
  }

  // The output folder is emptied first, so it must not be — or contain — anything PD reads.
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
  };
  const project = resolve(root);
  const storefront = cfg.storefront;
  // Every file the build reads, named by kind: the output folders must stay clear of each, and the input stamps
  // (input-stamps.ts) watch the same list, so the two can't drift.
  const reads: Array<{ kind: string; path: string }> = [
    ...cfg.patternRoots.map(r => ({ kind: "the patterns folder", path: r.dir })),
    ...cfg.styleRoots.map(r => ({ kind: "the styles folder", path: r.dir })),
    ...cfg.dataDirs.map(path => ({ kind: "the data folder", path })),
    ...cfg.helperPaths.map(path => ({ kind: isFolder(path) ? "the helpers folder" : "the helpers file", path })),
    ...cfg.scriptsDirs.map(path => ({ kind: "the scripts folder", path })),
    ...cfg.themeDirs.map(path => ({ kind: "the theme folder", path })),
    ...cfg.assetRoots.map(path => ({ kind: "the asset folder", path })),
    ...(storefront ? [{ kind: "the pages folder", path: storefront.pagesDir }] : []),
    ...(storefront?.head ? [{ kind: "the site's head file", path: storefront.head }] : []),
    // The cards pd social committed: read for a page whose card has their hash (social-images.ts).
    ...(storefront?.socialImages ? [{ kind: "the social images folder", path: socialDir(storefront.pagesDir) }] : []),
  ];
  /** Refuses an output root that is, holds, or sits inside anything the build reads. */
  const clearOfInputs = (name: string, out: string): void => {
    for (const { kind, path } of reads) {
      if (inside(out, path) || inside(path, out)) {
        throw new Error(`pd build: ${name} ${out} overlaps ${kind} ${path}, which Pattern Dump reads: choose another folder`);
      }
    }
  };
  if (buildWorkbench) {
    if (inside(project, outDir)) throw new Error(`pd build: --out ${outDir} would contain the project itself: choose a folder inside or beside it, like ./dist`);
    clearOfInputs("--out", outDir);
  }
  // The storefront's own output root: the same rules, and apart from the workbench's.
  if (storefront) {
    const sfOut = storefront.outDir;
    if (inside(project, sfOut)) throw new Error(`pd build: site.outDir ${sfOut} would contain the project itself: choose a folder inside or beside it`);
    clearOfInputs("site.outDir", sfOut);
    if (buildWorkbench && (inside(sfOut, outDir) || inside(outDir, sfOut))) {
      throw new Error(`pd build: site.outDir ${sfOut} and --out ${outDir} overlap: the site and the workbench each need a folder of their own`);
    }
    if (!storefront.workbenchUrl) {
      throw new Error("pd build: site.workbenchUrl is required to build the site: its pages link into the workbench at that address");
    }
    // A workbench published on the storefront's own host is linked at its path, so it must be built for that
    // path: the base path this build uses (--base, else build.basePath, else /). A workbench another build writes
    // (build.workbench: false) is that build's to place.
    const sameHost = sameHostWorkbenchPath(storefront);
    if (buildWorkbench && sameHost !== undefined && sameHost !== basePath) {
      throw new Error(`pd build: site.workbenchUrl is ${storefront.workbenchUrl}, so the workbench must be built for ${sameHost} `
        + `(build.basePath or --base); it is being built for ${basePath}`);
    }
  }

  // Every file the build reads, as it is now (input-stamps.ts). Compared before each write: a file saved while the
  // build runs stops it, naming the file, instead of output that is part old, part new.
  const inputs = reads.map(r => r.path);
  const outputs = [...(buildWorkbench ? [outDir] : []), ...(storefront ? [storefront.outDir] : [])];
  // Each part is written into a folder of its own beside its output, and put in place only once every check has
  // passed: a build that stops leaves both outputs as they were.
  const wbStage = staged(outDir);
  const sfStage = storefront ? staged(storefront.outDir) : undefined;
  for (const output of outputs) await clearLeftovers(output);
  const startStamps = await stampInputs(inputs, [...outputs, wbStage, ...(sfStage ? [sfStage] : [])]);
  watch.changed = async () => changedInputs(startStamps, await stampInputs(inputs, [...outputs, wbStage, ...(sfStage ? [sfStage] : [])]), project);
  /** Stops the build when an input changed since it started; `written` says what is on disk by then. */
  const assertUnchanged = async (written: string): Promise<void> => {
    const changed = await watch.changed!();
    if (changed.length) throw new InputsChangedError(written, changed);
  };

  // The checks this build leaves out (skipChecks, else build.skipChecks): none unless named. `html` renders without
  // html-validate (RendererOptions.validateHtml), so the workbench and the audit carry no HTML findings. --browser checks
  // accessibility in Chromium, so it can't be asked for with the accessibility check skipped.
  const asked = opts.skipChecks ?? config.build?.skipChecks ?? [];
  const unknown = asked.filter(c => !(SKIPPABLE_CHECKS as readonly string[]).includes(c));
  if (unknown.length) {
    throw new Error(`pd build: ${unknown.map(c => `"${c}"`).join(", ")} is not a check pd build can skip; it can skip ${SKIPPABLE_CHECKS.map(c => `"${c}"`).join(", ")}`);
  }
  const skipped = new Set(asked as readonly SkippableCheck[]);
  if (skipped.has("a11y") && opts.browser) {
    throw new Error("pd build: --browser checks the pages' accessibility in Chromium, so it can't be combined with skipping the accessibility check (--skip-checks=a11y or build.skipChecks)");
  }

  // --browser: the project's Playwright, loaded before anything is built, so a missing one stops the build at once.
  const loadPlaywright = opts.loadPlaywright ?? loadProjectPlaywright;
  const playwright = opts.browser && storefront ? await loadPlaywright(project) : undefined;
  // Social images are rendered with it too, and without --browser when the project has it: none is no stop then.
  const cardPlaywright = playwright ?? (storefront?.socialImages
    ? await loadPlaywright(project).catch((e: unknown) => { if (e instanceof BrowserUnavailableError) return undefined; throw e; })
    : undefined);
  /** Why a card can't be rendered, in the words of the warning for each page that lacks one. */
  let noRender = "Playwright isn't installed: run pd social, or install Playwright";
  // Search: the project's Pagefind, also before anything is built, so a missing one the site asks for stops at once.
  const pagefind = storefront ? await searchPagefind(storefront.search, project, opts.loadPagefind) : undefined;
  /** What each page gives the index, by route, as the crawl serves it. */
  const searchRecords = new Map<string, SearchRecord>();

  const fixed = opts.now;
  const now = fixed ? (): Date => new Date(fixed.getTime()) : (): Date => new Date();
  // The build's day, once: every page is held back or built against the same one, even past midnight.
  const today = todayOf(now());
  // A storefront page's notes, once each however often the page is fetched: the report's notes.
  const storefrontNotes = new Set<string>();
  const server = await startDevServer(config, root, {
    // The version is part of every social image's hash, so pd dev and pd build name a card alike.
    port: 0, live: false, now, today, pagesOnce: true, version: opts.pdVersion, ...(skipped.has("html") ? { validateHtml: false } : {}),
    ...(storefront?.workbenchUrl ? { storefrontWorkbenchUrl: storefront.workbenchUrl } : {}),
    onStorefrontNote: note => { storefrontNotes.add(note); },
    ...(pagefind ? { onSearchRecord: (r: SearchRecord) => { searchRecords.set(r.route, r); } } : {}),
  });
  /** Chromium, once launched (launchChromium): open until the build ends, closed in the finally below. */
  let browser: PwBrowser | undefined;
  // From here on a failure anywhere closes the server and the browser, and removes the stage folders (finally, below).
  try {
    log("… server ready");
    if (skipped.has("html")) log("… HTML validation skipped (skipChecks: html)");

    // A component schema that isn't JSON would turn that component's checks off: no build, with or without a site.
    const brokenSchemas = await server.schemaProblems();
    if (brokenSchemas.length) {
      throw new Error(`pd build: a component schema isn't valid JSON, so nothing was written:\n${brokenSchemas.map(p => `  - ${p}`).join("\n")}`);
    }

    // Symbol images: each one's standalone file (/_pd/symbols/<stem>.svg), read before anything is written. A source
    // that can't be used, or that uses a token the base layer lacks, stops the build; each is written into every output.
    const symbols = await server.symbols();
    const symbolFiles = new Map<string, string>();
    const symbolProblems = [...symbols.problems];
    for (const stem of symbols.stems) {
      const url = `${PD_ROUTE_PREFIX.symbols}${stem}.svg`;
      const res = await fetch(`http://127.0.0.1:${server.port}${url}`);
      if (res.status === 200) symbolFiles.set(url, await res.text());
      else symbolProblems.push(await res.text());
    }
    if (symbolProblems.length) {
      throw new Error(`pd build: a symbol image can't be used, so nothing was written:\n${symbolProblems.map(p => `  - ${p}`).join("\n")}`);
    }

    // The storefront, crawled before anything is written: a problem anywhere stops the build with both
    // output roots as they were.
    // A site published under a path is asked for under it, as a browser asks: everything is checked as it is served.
    const sfBase = storefront?.basePath ?? "/";
    const sfGet = storefront ? hostTransport(server.port, storefront.host, sfBase) : null;

    // Social images, before the crawl (social-images.ts, social-render.ts): each page's head asked for once, so the
    // server works out its card; the ones whose bytes are nowhere yet rendered in Chromium into the cache. The crawl's
    // heads then name each card, and the crawl writes it. A card with a problem stops the build here.
    let socialSummary: StaticBuildReport["socialImages"];
    if (storefront?.socialImages && sfGet) {
      const listed = await sfGet(PD_ROUTES.pages);
      if (listed.status === 200) {
        for (const p of (await listed.json() as StorefrontPagesResponse).pages) await sfGet(p.route);
      }
      const cards = server.socialCards();
      const cacheDir = socialCacheDir(cfg.cwd);
      const missing = cards.filter(c => c.file === undefined);
      let rendered = 0;
      if (missing.length && cardPlaywright) {
        // A Chromium that won't start is a stop only with --browser, which needs it anyway.
        browser ??= await launchChromium(cardPlaywright, opts.browser ? "pd build --browser" : "pd build", CARD_CHROMIUM_ARGS)
          .catch(async (e: unknown) => {
            if (opts.browser || !(e instanceof BrowserUnavailableError)) throw e;
            // Its first line, as launchChromium names it: "pd build couldn't start Chromium (<reason>): ...".
            const reason = /couldn't start Chromium \((.*)\): /.exec(e.message)?.[1] ?? e.message;
            noRender = `Chromium didn't start (${reason}): run pd social, or npx playwright install chromium`;
            return undefined;
          });
      }
      if (missing.length && browser) {
        const made = await renderCards(missing, { browser, get: sfGet });
        if (made.problems.length) {
          throw new Error(`pd build: the site's social images have problems, so nothing was written:\n${made.problems.map(p => `  - ${p}`).join("\n")}`);
        }
        const cache = createImageCache(cacheDir, "png");
        for (const [hash, png] of made.images) await cache.write(hash, png);
        rendered = missing.filter(c => made.images.has(c.hash)).length;
        log(`… social images: ${made.images.size} rendered in Chromium`);
      }
      const inCache = cards.filter(c => c.file?.startsWith(cacheDir)).length;
      // D1: a card that is nowhere and couldn't be rendered. The build goes on; the page's head takes the site's image
      // (it names a card only when its bytes are there), and the build says so, page by page.
      // With a browser every missing card was rendered (or the build stopped); without one, each is still missing.
      const missingLines = browser ? [] : missing.map(c => `${c.page}: no social image: its card is missing or stale and ${noRender}`);
      socialSummary = { pages: cards.length, rendered, cached: inCache, committed: cards.filter(c => c.file !== undefined).length - inCache,
        missing: missingLines, siteImage: storefront.image !== undefined };
    }
    // The crawler files: robots.txt at a host's root (a site under a path has none: crawlers would never read it);
    // the sitemap when the site has an address and is indexed.
    const sfFiles: string[] = storefront ? [...(sfBase === "/" ? [PD_ROUTES.robots] : []), PD_ROUTES.notFound,
      ...(storefront.url !== undefined && storefront.index ? [PD_ROUTES.sitemap] : [])] : [];
    const sfCrawl = sfGet ? await crawlStorefront(sfGet, sfFiles, sfBase) : null;
    if (sfCrawl && sfCrawl.problems.length) {
      throw new Error(`pd build: the site has problems, so nothing was written:\n${sfCrawl.problems.map(p => `  - ${p}`).join("\n")}`);
    }
    if (sfCrawl) log(`… site checked: ${sfCrawl.urls.length} files`);
    // The search index, from the pages the crawl served, in memory: checked in Chromium with --browser, written with the
    // site.
    const searchFiles = pagefind && sfCrawl
      ? await buildSearchIndex([...searchRecords.values()], pagefind, sfBase)
      : undefined;
    if (searchFiles) log(`… search index: ${searchRecords.size} pages`);
    const origin = `http://127.0.0.1:${server.port}`;

    // The link check (links.ts), also before anything is written: every reference on every site page (its pages and
    // its 404 page; not the previews and redirect stubs it writes) resolves to what this build writes, a link into the
    // workbench to a component and variant the workbench snapshot has. Other hosts are listed in the notes.
    let linkSummary: StaticBuildReport["links"];
    let classSummary: StaticBuildReport["classes"];
    let pageModel: Awaited<ReturnType<typeof readPages>> | undefined;
    let a11ySummary: StaticBuildReport["accessibility"];
    let imageSummary: StaticBuildReport["images"];
    const externalNotes: string[] = [];
    if (storefront && sfGet && sfCrawl) {
      const { pages: list } = await (await sfGet(PD_ROUTES.pages)).json() as StorefrontPagesResponse;
      const pages = [...list.map(p => p.route), PD_ROUTES.notFound];
      const wbUrl = storefront.workbenchUrl!.endsWith("/") ? storefront.workbenchUrl! : `${storefront.workbenchUrl!}/`;
      const tree = await (await fetch(`${origin}${PD_ROUTES.tree}`)).json() as ComponentTree;
      const routes = new Set<string>([""]);
      const walk = (nodes: TreeNode[]): void => nodes.forEach(n => { routes.add(n.path); walk(n.children ?? []); });
      walk(tree.roots);
      const variants = new Map<string, string[]>();
      for (const route of linkedWorkbenchRoutes(sfCrawl.documents, pages, wbUrl)) {
        if (!routes.has(route)) continue;
        const res = await fetch(`${origin}${componentUrl(route)}`);
        if (res.status !== 200) continue;
        const names = (await res.json() as ComponentDetailResponse).variants.map(v => v.name);
        variants.set(route, names);
        if (names.length) routes.add(`${route}/variants`);
      }
      const links = checkLinks({
        // The crawl records a stamped reference with its ?v=; what is written, and what a link names, is the path.
        built: new Set(sfCrawl.urls.map(u => u.split("?")[0]!)), documents: sfCrawl.documents, pages,
        ...(storefront.url !== undefined ? { siteUrl: storefront.url.endsWith("/") ? storefront.url : `${storefront.url}/` } : {}),
        basePath: sfBase,
        workbench: { url: wbUrl, routes, variants },
      });
      if (links.problems.length) {
        throw new Error(`pd build: the site has broken links, so nothing was written:\n${links.problems.map(p => `  - ${p}`).join("\n")}`);
      }
      for (const [url, on] of links.external) externalNotes.push(`an external link, not checked: ${url} (on ${on.join(", ")})`);
      linkSummary = { pages: pages.length, references: links.references, external: links.external.size };
      log(`… links checked: ${links.references} references on ${pages.length} pages`);

      // The style checks, also before anything is written (class-check.ts, property-check.ts): every class a site page
      // carries is defined by the style guide (a warning unless storefront.checks.classes says otherwise), and every
      // var() the skin's own styles read without a fallback has a definition somewhere (an error).
      pageModel = await readPages(storefront.pagesDir, {
        drafts: "leave-out", scheduled: "leave-out", today, categories: storefront.categories, tags: storefront.tags,
      });
      const guide = await server.styleGuide();
      const stylesheets = [...guide.stylesheets, ...sfCrawl.stylesheets.values()];
      const fail = async (what: string, lines: string[]): Promise<never> => {
        throw new Error(`pd build: ${what}, so nothing was written:\n${lines.map(l => `  - ${l}`).join("\n")}`);
      };
      const properties = checkProperties({
        sources: await styleSources(cfg.stylesDir, project), stylesheets, documents: [...sfCrawl.documents.values()],
        allow: storefront.checks.allowProperties,
      });
      if (properties.length) await fail("the skin reads custom properties nothing defines", properties);
      if (storefront.checks.classes !== "off") {
        const model = pageModel;
        const checkPages = await Promise.all(pages.flatMap(route => {
          const html = sfCrawl.documents.get(route);
          if (html === undefined) return [];
          const f = route === PD_ROUTES.notFound ? model.notFound : model.files.get(route);
          return [(async () => ({ route, html, ...(f ? { file: { path: f.path, text: await readFile(f.file, "utf8") } } : {}) }))()];
        }));
        const classes = checkClasses({ pages: checkPages, stylesheets, templates: guide.templates, allow: storefront.checks.allowClasses });
        if (storefront.checks.classes === "error" && classes.length) {
          await fail("the site uses classes outside the design system (site.checks.classes is \"error\")", classes);
        }
        classSummary = { severity: storefront.checks.classes, warnings: storefront.checks.classes === "warning" ? classes : [] };
      }
      log(`… styles checked against the style guide`);

      // Accessibility (step 6b), also before anything is written: one main landmark and one <h1> per site page, and
      // axe's rules that jsdom decides (@pattern-dump/a11y). A critical or serious WCAG finding, and a page without
      // exactly one main and one <h1>, stop the build; the rest are warnings in the report, grouped by rule.
      // `skipChecks: ["a11y"]` leaves all of it out (the report says so); --browser, which checks in Chromium, refused it.
      const errors: string[] = [];
      const warned = new Map<string, { finding: PageA11yFinding; pages: string[]; elements: number }>();
      // axe runs on worker threads (runPagesA11y); its findings come back in the pages' order, so the report is the
      // same however the work was spread.
      const checked = skipped.has("a11y") ? [] : pages.filter(page => sfCrawl.documents.has(page));
      const htmlOf = (page: string): string => sfCrawl.documents.get(page)!;
      const axeFindings = await runPagesA11y(checked.map(htmlOf), opts.checkWorkers !== undefined ? { workers: opts.checkWorkers } : {})
        .catch((e: unknown) => {
          throw e instanceof PageCheckError ? new Error(`pd build: the accessibility check of ${checked[e.index]} failed: ${e.message}`) : e;
        });
      for (const [k, page] of checked.entries()) {
        const html = htmlOf(page);
        for (const p of checkPageBasics(html)) errors.push(`${page}: ${p}`);
        for (const f of axeFindings[k]!) {
          const where = f.nodes.map(n => n.target).join(", ");
          if (f.severity === "error") {
            errors.push(`${page}: ${f.ruleId} (${f.impact}): ${f.help}, on ${where} (${f.helpUrl})`);
            continue;
          }
          const w = warned.get(f.ruleId) ?? { finding: f, pages: [], elements: 0 };
          w.pages.push(page);
          w.elements += f.nodes.length;
          warned.set(f.ruleId, w);
        }
      }
      if (errors.length) {
        throw new Error(`pd build: the site has accessibility problems, so nothing was written:\n${errors.map(e => `  - ${e}`).join("\n")}`);
      }
      // --browser: the rules that need a rendered page, and the images against their boxes (browser-checks.ts).
      let imageWarnings: string[] | undefined;
      const browserWarnings: string[] = [];
      if (playwright) {
        browser ??= await launchChromium(playwright, "pd build --browser", storefront.socialImages ? CARD_CHROMIUM_ARGS : undefined);
        const checked = await runBrowserChecks({ pages, get: sfGet, browser, basePath: sfBase, ...(searchFiles ? { search: { files: searchFiles, word: searchWord([...searchRecords.values()]) } } : {}) });
        if (checked.errors.length) {
          throw new Error(`pd build: the site has problems in a browser, so nothing was written:\n${checked.errors.map(e => `  - ${e}`).join("\n")}`);
        }
        browserWarnings.push(...checked.a11yWarnings);
        imageWarnings = checked.images;
        log(`… checked in Chromium at ${VIEWPORTS.map(v => `${v.name} @${v.dpr}x`).join(" and ")}`);
      }
      imageSummary = imageWarnings ? { warnings: imageWarnings } : undefined;
      if (skipped.has("a11y")) {
        log(`… accessibility check skipped (skipChecks: a11y)`);
      } else {
        a11ySummary = {
          pages: pages.length, ...(playwright ? { browser: true } : {}),
          warnings: [...[...warned.values()].map(w => `${w.finding.ruleId} (${w.finding.impact}): ${w.finding.help}, ${w.elements} `
            + `element${w.elements === 1 ? "" : "s"} on ${w.pages.join(", ")} (${w.finding.helpUrl})`), ...browserWarnings],
        };
        log(`… accessibility checked on ${pages.length} pages`);
      }
    }

    await assertUnchanged("nothing was written");
    if (buildWorkbench) {
      await rm(wbStage, { recursive: true, force: true });
      await mkdir(wbStage, { recursive: true });
    }
    const report: StaticBuildReport = { outDir, basePath, files: 0, bytes: 0, components: 0, warnings: [], notes: [], borrowedStyles: 0, ms: 0,
      ...(buildWorkbench ? {} : { workbench: false as const }) };
    report.warnings.push(...symbols.warnings);
    report.notes.push(...symbols.infos);
    if (opts.browser && !storefront) report.notes.push("--browser checks a site's pages in Chromium, and this project has no site: nothing was checked");
    const { capture, store } = createSnapshotWriter({ outDir: wbStage, basePath, origin, report });

    /** Every /_pd/ stylesheet, script and image variant a document references: a variant in a src or as any
     *  candidate of a srcset ({{pd-image}}), as the site's crawl reads them. */
    const referenced = (html: string): string[] => [
      ...[...html.matchAll(/(?:href|src)="(\/_pd\/(?:components|themes|scripts|images)\/[^"]+)"/g)].map(m => m[1]),
      ...[...html.matchAll(/srcset="([^"]+)"/g)].flatMap(m => m[1].split(",").map(c => c.trim().split(/\s+/)[0] ?? ""))
        .filter(u => u.startsWith(PD_ROUTE_PREFIX.images)),
    ].map(u => u.replace(/&amp;/g, "&"));

    // ---- 1 to 6: the workbench, unless another build writes it (build.workbench: false) ----
    if (buildWorkbench) {
      // ---- 1. Fixed resources ----
      for (const url of [PD_ROUTES.mainJs, PD_ROUTES.mainCss, PD_ROUTES.shikiCss, PD_ROUTES.codeCss, PD_ROUTES.baseCss,
        PD_ROUTES.axeCore, PD_ROUTES.ruleTiers, PD_ROUTES.config, PD_ROUTES.version]) {
        await capture(url);
      }
      const tree = JSON.parse((await capture(PD_ROUTES.tree))!) as ComponentTree;
      const themes = JSON.parse((await capture(PD_ROUTES.themes))!) as ThemeSummary[];
      for (const t of themes) await capture(themeCssUrl(t.name));
      log(`… ${themes.length} themes`);

      // ---- 2. Components, their variants, previews and source views ----
      const components: string[] = [];
      const folders: string[] = [];
      const walk = (nodes: TreeNode[]): void => nodes.forEach(n => {
        if (n.kind === "component") components.push(n.path);
        if (n.children?.length) folders.push(n.path);
        walk(n.children ?? []);
      });
      walk(tree.roots);
      report.components = components.length;
      const routes = new Set<string>(["/"]);

      for (const id of components) {
        routes.add(`/${id}`);
        const baseText = await capture(componentUrl(id));
        if (!baseText) continue;
        const base = JSON.parse(baseText) as ComponentDetailResponse;
        report.borrowedStyles += base.diagnostics.filter(d => d.kind === "STYLE_BORROWED").length;
        if (base.variants.length) routes.add(`/${id}/variants`);
        for (const variant of [undefined, ...base.variants.map(v => v.name)]) {
          const detailText = variant ? await capture(componentUrl(id, variant)) : baseText;
          if (detailText) {
            // The detail response carries the complete preview document — byte-identical to what
            // /preview/:id serves for the default theme — so write it rather than render it twice.
            const { document, doc } = JSON.parse(detailText) as ComponentDetailResponse;
            // Under a base path the robots.txt rule for /preview/ is never read, so each preview says noindex itself.
            await store(previewUrl(id, variant), basePath === "/" ? document : withNoindex(document));
            // And what the docs tab's embedded examples reference: they render inline in the detail response.
            for (const ref of new Set([...referenced(document), ...referenced(doc ?? "")])) await capture(ref);
          }
          await capture(renderedSourceUrl(id, variant), { optional: true });
          await capture(dataSourceUrl(id, variant), { optional: true });
        }
      }

      log(`… ${components.length} components with their variants, previews and source views`);

      // ---- 3. Folder overviews ----
      for (const path of folders) {
        routes.add(`/${path}`);
        await capture(overviewUrl(path), { optional: true });
      }

      log(`… ${folders.length} folder overviews`);

      // ---- 4. The corpus audit, as of now — unless left out, in which case it never runs (the audit
      // route computes on request, so not requesting it is enough) ----
      if (includeAudit) {
        await capture(PD_ROUTES.audit);
        log("… corpus audit");
      } else {
        log("… corpus audit left out (build.audit: false / --no-audit)");
      }

      // The project graph, unless the config leaves it out (build.graph: false): what pd graph --json prints.
      if (config.build?.graph !== false) {
        await capture(PD_ROUTES.graph);
        log("… project graph");
      } else {
        log("… project graph left out (build.graph: false)");
      }

      // ---- 5. Assets, copied as served: /assets/<root name>/…, and the single-root mirror. A root
      // hidden by an earlier one of the same name is never served by `pd dev`, so it is left out here
      // too rather than copied over (or under) the root that wins. ----
      const shadowed = new Map(shadowedAssetRoots(cfg.assetRoots).map(s => [s.root, s.by]));
      for (const [i, rootDir] of cfg.assetRoots.entries()) {
        const by = shadowed.get(rootDir);
        if (by !== undefined) {
          report.warnings.push(`assets: ${relative(root, rootDir)} is hidden by ${relative(root, by) || "."}, which has the same folder name; left out`);
          continue;
        }
        const exists = await stat(rootDir).then(s => s.isDirectory(), () => false);
        if (!exists) continue;
        await cp(rootDir, join(wbStage, "assets", cfg.assetRootNames[i]), { recursive: true, filter: notABarrier });
        if (cfg.assetRoots.length === 1) await cp(rootDir, join(wbStage, "assets"), { recursive: true, force: false, filter: notABarrier });
      }

      // Each symbol image's standalone file.
      for (const [url, svg] of symbolFiles) await store(url, svg);

      // ---- 6. One shell page per route ----
      const runtime: ShellRuntime = {
        mode: "static", basePath, builtAt: now().toISOString(), pdVersion: opts.pdVersion,
        ...(includeAudit ? {} : { audit: false }),
      };
      // Through the writer like every other file: the base path is applied there, once, and a route whose
      // file is already written (by a capture) is not written over. That only happens when a pattern folder
      // shares its name with one of PD's own URL prefixes; the route then has no page, so it is reported.
      const shell = buildShellHtml(runtime, config.shell?.brand);
      for (const route of routes) {
        const holder = await store(route, shell);
        if (holder !== null) {
          report.warnings.push(`shell page for route ${route} not written: ${staticPathFor(route)} already holds the server's response to ${holder}`);
        }
      }
      // GitHub Pages runs Jekyll unless told otherwise, and Jekyll drops every folder starting with "_"
      // — which would silently remove _pd/ (the shell, its CSS, every theme and component stylesheet).
      await writeFile(join(wbStage, ".nojekyll"), "");
      report.files++;
      // Crawlers: the workbench is searchable, its previews are not.
      await writeFile(join(wbStage, "robots.txt"), workbenchRobotsTxt(basePath));
      report.files++;
      // Unless the storefront's own robots.txt, at this host's root, already keeps these previews out: a
      // workbench published on the storefront's host at this base path (with index: false, it keeps out everything),
      // when the storefront itself is at the host's root and so has a robots.txt.
      if (basePath !== "/" && (sameHostWorkbenchPath(storefront ?? undefined) !== basePath || sfBase !== "/")) {
        report.notes.push(`robots.txt is written to the workbench's root, but crawlers read it only at a host's root: `
          + `with the base path ${basePath}, each preview carries a robots noindex tag instead; where you can, also add `
          + `its rule (Disallow: ${basePath}preview/) to the robots.txt the host serves at /`);
      }

      await assertUnchanged("nothing was written");
    }

    // ---- 7. The storefront, into its own root, through its own writer ----
    if (storefront && sfStage && sfGet && sfCrawl) {
      const sfOut = sfStage;
      await rm(sfOut, { recursive: true, force: true });
      await mkdir(sfOut, { recursive: true });
      const counts = { files: 0, bytes: 0, warnings: [] as string[] };
      const sf = createSnapshotWriter({ outDir: sfOut, basePath: "/", origin: "", report: counts, fetch: sfGet });
      // In the crawl's order, so the first URL of a file still writes it. A document or stylesheet is written as the
      // crawl read it: every check above read that text, and asking again would assemble every page a second time.
      // What the crawl did not keep (scripts, images, fonts, robots.txt, the sitemap) is asked for again.
      for (const url of sfCrawl.urls) {
        const text = sfCrawl.documents.get(url) ?? sfCrawl.stylesheets.get(url);
        if (text !== undefined) await sf.store(url, text);
        else await sf.capture(url, { fatal: true });
      }
      for (const [url, svg] of symbolFiles) await sf.store(url, svg);
      if (sf.failures.length) {
        throw new Error(`pd build: the site changed while it was being written:\n${sf.failures.map(f => `  - ${f}`).join("\n")}`);
      }
      await writeFile(join(sfOut, ".nojekyll"), "");
      counts.files++;
      if (searchFiles) {
        let bytes = 0;
        for (const [path, content] of searchFiles) {
          const file = join(sfOut, ...SEARCH_PATH.split("/").filter(Boolean), ...path.split("/"));
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, content);
          bytes += content.byteLength;
        }
        counts.files += searchFiles.size;
        counts.bytes += bytes;
        report.search = { pages: searchRecords.size, files: searchFiles.size, bytes };
      }
      // The pages as this build has them (no draft, no scheduled page): llms.txt, and the report's drafts and scheduled.
      const model = pageModel!;
      if (storefront.llms) {
        const siteTitle = typeof storefront.site?.["title"] === "string" ? storefront.site["title"] : undefined;
        const feeds = ((await (await sfGet!(PD_ROUTES.pages)).json()) as StorefrontPagesResponse).feeds ?? [];
        const llms = llmsTxt(model, { title: siteTitle, siteUrl: storefront.url, feeds });
        const bytes = Buffer.from(llms.text, "utf8");
        await writeFile(join(sfOut, "llms.txt"), bytes);
        counts.files++;
        counts.bytes += bytes.byteLength;
        report.llms = { pages: llms.pages };
      }
      const listed = await (await sfGet(PD_ROUTES.pages)).json() as StorefrontPagesResponse;
      const stubs = new Set(listed.pages.flatMap(p => p.redirectFrom ?? []));
      const feeds = new Set((listed.feeds ?? []).map(f => f.address));
      const pages = sfCrawl.urls.filter(u => !/^\/(?:_pd|assets|preview)\//.test(u) && !isPageImageUrl(u.split("?")[0]!) && !sfFiles.includes(u) && !stubs.has(u) && !feeds.has(u)).length;
      if (feeds.size) report.feeds = { files: feeds.size };
      report.storefront = { outDir: storefront.outDir, basePath: sfBase, pages, files: counts.files, bytes: counts.bytes };
      if (sfBase !== "/") {
        // What the site's robots.txt would have said, for the host's own, if its owner can add to it.
        const wbPath = sameHostWorkbenchPath(storefront);
        const rules = storefront.index
          ? [`Disallow: ${sfBase}preview/`, ...(wbPath !== undefined ? [`Disallow: ${wbPath}preview/`] : []),
            ...(storefront.url !== undefined ? [`Sitemap: ${storefront.url}sitemap.xml`] : [])]
          : [`Disallow: ${sfBase}`];
        report.notes.push(`robots.txt is not written: the site is published under ${sfBase}, and crawlers read robots.txt only at a `
          + `host's root. Where you can, add to the host's own robots.txt: ${rules.join("; ")}`);
      }
      if (storefront.url === undefined) {
        report.notes.push("site.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, "
          + `and there is no sitemap${storefront.feeds ? " and no feed" : ""}: set site.url to the site's address, such as "https://example.com/"`);
      } else if (storefront.feeds && !storefront.index) {
        report.notes.push("site.feeds is set, and the site has index: false, so it has no feeds: a site kept out of search engines has none");
      }
      report.notes.push(...storefrontNotes, ...externalNotes);
      if (linkSummary) report.links = linkSummary;
      if (classSummary) report.classes = classSummary;
      if (a11ySummary) report.accessibility = a11ySummary;
      if (imageSummary) report.images = imageSummary;
      if (socialSummary) report.socialImages = socialSummary;
      const { drafts, scheduled } = model;
      if (drafts.length) report.drafts = drafts;
      if (model.draftsByDefaults.length) {
        const by = new Map<string, number>();
        for (const d of model.draftsByDefaults) by.set(d.from, (by.get(d.from) ?? 0) + 1);
        report.draftsByDefaults = [...by].sort(([a], [b]) => a < b ? -1 : 1).map(([from, pages]) => ({ from, pages }));
      }
      if (scheduled.length) report.scheduled = scheduled;
      log(`… site: ${pages} pages, ${counts.files} files`);
    }

    if (storefront) await assertUnchanged("nothing was written");

    // Every check has passed: each part takes its output's place. The workbench first: when the storefront then can't,
    // the two are out of step, and the build says so.
    if (buildWorkbench) await putInPlace(wbStage, outDir);
    if (storefront && sfStage) {
      await putInPlace(sfStage, storefront.outDir).catch((e: unknown) => {
        if (!buildWorkbench) throw e;
        throw new Error(`pd build: the workbench in ${outDir} is this build's, but the site could not take its place in `
          + `${storefront.outDir}: the two are out of step. The site in it is the earlier one; run pd build again.\n`
          + `  ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      });
    }

    // ---- 8. The image cache keeps what this build used: the variants written to either root ----
    const used = new Set<string>();
    for (const root of outputs) {
      const files = await readdir(join(root, "_pd", "images"), { recursive: true }).catch(() => [] as string[]);
      for (const f of files) {
        const m = /\.([0-9a-f]{10})\.[1-9][0-9]*\.webp$/.exec(String(f));
        if (m) used.add(m[1]!);
      }
    }
    await createImageCache(imageCacheDir(cfg.cwd)).sweep(used);
    // And the social image cache, the cards written to the site (/_pd/social/<route>/card.<hash>.png).
    if (storefront?.socialImages) {
      const cards = await readdir(join(storefront.outDir, "_pd", "social"), { recursive: true }).catch(() => [] as string[]);
      const keep = new Set(cards.map(f => /(?:^|[\\/])card\.([0-9a-f]{10})\.png$/.exec(String(f))?.[1]).filter((h): h is string => h !== undefined));
      await createImageCache(socialCacheDir(cfg.cwd), "png").sweep(keep);
    }

    // Deliberately no 404.html shell: every route has its own index.html, and a host that served the
    // shell for a missing preview would boot a second workbench inside the preview iframe.

    if (skipped.size) report.skippedChecks = SKIPPABLE_CHECKS.filter(c => skipped.has(c));
    report.ms = Math.round(performance.now() - started);
    return report;
  } finally {
    await browser?.close();
    await server.close();
    // A build that stopped leaves nothing of its own beside the outputs.
    await rm(wbStage, { recursive: true, force: true });
    if (sfStage) await rm(sfStage, { recursive: true, force: true });
  }
}

/** The folder a build writes an output into before it takes the output's place: beside it, so on the same
 *  filesystem, and hidden. Named with the build's process, so a later build can tell a killed one's leftovers. */
function staged(output: string): string {
  return join(dirname(output), `.${basename(output)}.pd-build-${process.pid}`);
}

/** Put a finished folder in an output's place: the earlier output is moved aside, then removed. When the finished
 *  one can't take its place, the earlier one is put back, so the output is never missing. */
async function putInPlace(stage: string, output: string): Promise<void> {
  const aside = `${stage}.earlier`;
  await rm(aside, { recursive: true, force: true });
  const had = await rename(output, aside).then(() => true, (e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return false;
    throw e;
  });
  try {
    await rename(stage, output);
  } catch (e) {
    if (had) await rename(aside, output).catch(() => {});
    throw e;
  }
  if (had) await rm(aside, { recursive: true, force: true });
}

/** True while a process with this id runs (one of another user's counts: it can't be signalled, but it exists). */
function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Remove what killed builds left beside an output: every `.<out>.pd-build-<pid>` folder whose process no longer
 *  runs. An earlier output such a build had moved aside (`….earlier`) and not replaced is put back first. */
async function clearLeftovers(output: string): Promise<void> {
  const dir = dirname(output);
  const prefix = `.${basename(output)}.pd-build-`;
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter(n => n.startsWith(prefix)).sort().reverse()) {
    const m = /^(\d+)(\.earlier)?$/.exec(name.slice(prefix.length));
    if (!m || running(Number(m[1]))) continue;
    const path = join(dir, name);
    if (m[2] && !(await stat(output).then(() => true, () => false))) await rename(path, output);
    else await rm(path, { recursive: true, force: true });
  }
}

/** The project's own style sources (SCSS and CSS) under `stylesDir`, each by its path from the project's root. */
async function styleSources(stylesDir: string, project: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(?:scss|css)$/.test(e.name)) out.push({ path: relative(project, p).split(sep).join("/"), text: await readFile(p, "utf8") });
    }
  };
  await walk(stylesDir);
  return out;
}
