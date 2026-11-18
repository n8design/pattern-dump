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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createImageCache } from "@pattern-dump/build";
import { sameHostWorkbenchPath, type PatternDumpConfig, SKIPPABLE_CHECKS, type SkippableCheck } from "@pattern-dump/config";
import {
  componentUrl, dataSourceUrl, normalizeBasePath, overviewUrl, PD_ROUTES, previewUrl, renderedSourceUrl,
  staticPathFor, themeCssUrl,
  type ComponentDetailResponse, type ComponentTree, type ShellRuntime, type StorefrontPagesResponse, type ThemeSummary, type TreeNode,
} from "@pattern-dump/contracts";
import { startDevServer } from "./index.js";
import { buildShellHtml } from "./http-utils.js";
import { imageCacheDir } from "./image-route.js";
import { loadPatternPackages } from "./packages.js";
import { resolveServerConfig, shadowedAssetRoots } from "./server-config.js";
import { createSnapshotWriter } from "./snapshot-writer.js";
import { readPages, todayOf, type ScheduledPage } from "./storefront/pages.js";
import { crawlStorefront, hostTransport } from "./storefront/crawl.js";
import { checkLinks, linkedWorkbenchRoutes } from "./storefront/links.js";
import { checkPageBasics } from "./storefront/page-basics.js";
import { loadProjectPlaywright, runBrowserChecks, VIEWPORTS, type PlaywrightModule } from "./storefront/browser-checks.js";
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
    throw new Error("pd build: build.workbench is false and the project has no storefront, so there is nothing to build");
  }

  // The output folder is emptied first, so it must not be — or contain — anything PD reads.
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
  };
  const project = resolve(root);
  if (buildWorkbench && inside(project, outDir)) throw new Error(`pd build: --out ${outDir} would contain the project itself: choose a folder inside or beside it, like ./dist`);
  for (const source of buildWorkbench ? [cfg.patternsDir, cfg.stylesDir, ...cfg.themeDirs, ...cfg.assetRoots] : []) {
    if (inside(outDir, source) || inside(source, outDir)) {
      throw new Error(`pd build: --out ${outDir} overlaps ${source}, which Pattern Dump reads: choose another folder`);
    }
  }
  // The storefront's own output root: the same rules, and apart from the workbench's.
  const storefront = cfg.storefront;
  if (storefront) {
    const sfOut = storefront.outDir;
    if (inside(project, sfOut)) throw new Error(`pd build: storefront.outDir ${sfOut} would contain the project itself: choose a folder inside or beside it`);
    for (const source of [cfg.patternsDir, cfg.stylesDir, storefront.pagesDir, ...cfg.themeDirs, ...cfg.assetRoots]) {
      if (inside(sfOut, source) || inside(source, sfOut)) {
        throw new Error(`pd build: storefront.outDir ${sfOut} overlaps ${source}, which Pattern Dump reads: choose another folder`);
      }
    }
    if (buildWorkbench && (inside(sfOut, outDir) || inside(outDir, sfOut))) {
      throw new Error(`pd build: storefront.outDir ${sfOut} and --out ${outDir} overlap: the storefront and the workbench each need a folder of their own`);
    }
    if (!storefront.workbenchUrl) {
      throw new Error("pd build: storefront.workbenchUrl is required to build the storefront: its pages link into the workbench at that address");
    }
    // A workbench published on the storefront's own host is linked at its path, so it must be built for that
    // path: the base path this build uses (--base, else build.basePath, else /). A workbench another build writes
    // (build.workbench: false) is that build's to place.
    const sameHost = sameHostWorkbenchPath(storefront);
    if (buildWorkbench && sameHost !== undefined && sameHost !== basePath) {
      throw new Error(`pd build: storefront.workbenchUrl is ${storefront.workbenchUrl}, so the workbench must be built for ${sameHost} `
        + `(build.basePath or --base); it is being built for ${basePath}`);
    }
  }

  // Every file the build reads, as it is now (input-stamps.ts). Compared before each write: a file saved while the
  // build runs stops it, naming the file, instead of output that is part old, part new.
  const inputs = [
    ...cfg.patternRoots.map(r => r.dir), ...cfg.styleRoots.map(r => r.dir), ...cfg.dataDirs, ...cfg.helperPaths,
    ...cfg.scriptsDirs, ...cfg.themeDirs, ...cfg.assetRoots,
    ...(storefront ? [storefront.pagesDir, ...(storefront.head ? [storefront.head] : [])] : []),
  ];
  const outputs = [...(buildWorkbench ? [outDir] : []), ...(storefront ? [storefront.outDir] : [])];
  // Each part is written into a folder of its own beside its output, and put in place only once every check has
  // passed: a build that stops leaves both outputs as they were.
  const wbStage = staged(outDir);
  const sfStage = storefront ? staged(storefront.outDir) : undefined;
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
  const playwright = opts.browser && storefront ? await (opts.loadPlaywright ?? loadProjectPlaywright)(project) : undefined;
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
    port: 0, live: false, now, today, pagesOnce: true, ...(skipped.has("html") ? { validateHtml: false } : {}),
    ...(storefront?.workbenchUrl ? { storefrontWorkbenchUrl: storefront.workbenchUrl } : {}),
    onStorefrontNote: note => { storefrontNotes.add(note); },
    ...(pagefind ? { onSearchRecord: (r: SearchRecord) => { searchRecords.set(r.route, r); } } : {}),
  });
  log("… server ready");
  if (skipped.has("html")) log("… HTML validation skipped (skipChecks: html)");

  // A component schema that isn't JSON would turn that component's checks off: no build, with or without a site.
  const brokenSchemas = await server.schemaProblems();
  if (brokenSchemas.length) {
    await server.close();
    throw new Error(`pd build: a component schema isn't valid JSON, so nothing was written:\n${brokenSchemas.map(p => `  - ${p}`).join("\n")}`);
  }

  // The storefront, crawled before anything is written: a problem anywhere stops the build with both
  // output roots as they were.
  // A site published under a path is asked for under it, as a browser asks: everything is checked as it is served.
  const sfBase = storefront?.basePath ?? "/";
  const sfGet = storefront ? hostTransport(server.port, storefront.host, sfBase) : null;
  // The crawler files: robots.txt at a host's root (a site under a path has none: crawlers would never read it);
  // the sitemap when the site has an address and is indexed.
  const sfFiles: string[] = storefront ? [...(sfBase === "/" ? [PD_ROUTES.robots] : []), PD_ROUTES.notFound,
    ...(storefront.url !== undefined && storefront.index ? [PD_ROUTES.sitemap] : [])] : [];
  const sfCrawl = sfGet ? await crawlStorefront(sfGet, sfFiles, sfBase) : null;
  if (sfCrawl && sfCrawl.problems.length) {
    await server.close();
    throw new Error(`pd build: the storefront has problems, so nothing was written:\n${sfCrawl.problems.map(p => `  - ${p}`).join("\n")}`);
  }
  if (sfCrawl) log(`… storefront checked: ${sfCrawl.urls.length} files`);
  // The search index, from the pages the crawl served, in memory: checked in Chromium with --browser, written with the
  // site.
  const searchFiles = pagefind && sfCrawl
    ? await buildSearchIndex([...searchRecords.values()], pagefind, sfBase).catch(async (e: unknown) => { await server.close(); throw e; })
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
      await server.close();
      throw new Error(`pd build: the storefront has broken links, so nothing was written:\n${links.problems.map(p => `  - ${p}`).join("\n")}`);
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
      await server.close();
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
        await fail("the storefront uses classes outside the design system (storefront.checks.classes is \"error\")", classes);
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
      .catch(async (e: unknown) => {
        await server.close();
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
      await server.close();
      throw new Error(`pd build: the storefront has accessibility problems, so nothing was written:\n${errors.map(e => `  - ${e}`).join("\n")}`);
    }
    // --browser: the rules that need a rendered page, and the images against their boxes (browser-checks.ts).
    let imageWarnings: string[] | undefined;
    const browserWarnings: string[] = [];
    if (playwright) {
      const checked = await runBrowserChecks({ pages, get: sfGet, playwright, basePath: sfBase, ...(searchFiles ? { search: { files: searchFiles, word: searchWord([...searchRecords.values()]) } } : {}) }).catch(async (e: unknown) => { await server.close(); throw e; });
      if (checked.errors.length) {
        await server.close();
        throw new Error(`pd build: the storefront has problems in a browser, so nothing was written:\n${checked.errors.map(e => `  - ${e}`).join("\n")}`);
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

  await assertUnchanged("nothing was written").catch(async (e: unknown) => { await server.close(); throw e; });
  if (buildWorkbench) {
    await rm(wbStage, { recursive: true, force: true });
    await mkdir(wbStage, { recursive: true });
  }
  const report: StaticBuildReport = { outDir, basePath, files: 0, bytes: 0, components: 0, warnings: [], notes: [], borrowedStyles: 0, ms: 0,
    ...(buildWorkbench ? {} : { workbench: false as const }) };
  if (opts.browser && !storefront) report.notes.push("--browser checks a storefront's pages in Chromium, and this project has no storefront: nothing was checked");
  const { capture, store } = createSnapshotWriter({ outDir: wbStage, basePath, origin, report });

  /** Every /_pd/ stylesheet and script a document references. */
  const referenced = (html: string): string[] =>
    [...html.matchAll(/(?:href|src)="(\/_pd\/(?:components|themes|scripts)\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));

  try {
    // ---- 1 to 6: the workbench, unless another build writes it (build.workbench: false) ----
    if (buildWorkbench) {
      // ---- 1. Fixed resources ----
      for (const url of [PD_ROUTES.mainJs, PD_ROUTES.mainCss, PD_ROUTES.shikiCss, PD_ROUTES.baseCss,
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
            const { document } = JSON.parse(detailText) as ComponentDetailResponse;
            // Under a base path the robots.txt rule for /preview/ is never read, so each preview says noindex itself.
            await store(previewUrl(id, variant), basePath === "/" ? document : withNoindex(document));
            for (const ref of referenced(document)) await capture(ref);
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
      if (sf.failures.length) {
        throw new Error(`pd build: the storefront changed while it was being written:\n${sf.failures.map(f => `  - ${f}`).join("\n")}`);
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
        const llms = llmsTxt(model, { title: siteTitle, siteUrl: storefront.url });
        const bytes = Buffer.from(llms.text, "utf8");
        await writeFile(join(sfOut, "llms.txt"), bytes);
        counts.files++;
        counts.bytes += bytes.byteLength;
        report.llms = { pages: llms.pages };
      }
      const stubs = new Set((await (await sfGet(PD_ROUTES.pages)).json() as StorefrontPagesResponse).pages.flatMap(p => p.redirectFrom ?? []));
      const pages = sfCrawl.urls.filter(u => !/^\/(?:_pd|assets|preview)\//.test(u) && !sfFiles.includes(u) && !stubs.has(u)).length;
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
        report.notes.push("storefront.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, "
          + "and there is no sitemap: set storefront.url to the site's address, such as \"https://example.com/\"");
      }
      report.notes.push(...storefrontNotes, ...externalNotes);
      if (linkSummary) report.links = linkSummary;
      if (classSummary) report.classes = classSummary;
      if (a11ySummary) report.accessibility = a11ySummary;
      if (imageSummary) report.images = imageSummary;
      const { drafts, scheduled } = model;
      if (drafts.length) report.drafts = drafts;
      if (model.draftsByDefaults.length) {
        const by = new Map<string, number>();
        for (const d of model.draftsByDefaults) by.set(d.from, (by.get(d.from) ?? 0) + 1);
        report.draftsByDefaults = [...by].sort(([a], [b]) => a < b ? -1 : 1).map(([from, pages]) => ({ from, pages }));
      }
      if (scheduled.length) report.scheduled = scheduled;
      log(`… storefront: ${pages} pages, ${counts.files} files`);
    }

    if (storefront) await assertUnchanged("nothing was written");

    // Every check has passed: each part takes its output's place.
    if (buildWorkbench) await putInPlace(wbStage, outDir);
    if (storefront && sfStage) await putInPlace(sfStage, storefront.outDir);

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

    // Deliberately no 404.html shell: every route has its own index.html, and a host that served the
    // shell for a missing preview would boot a second workbench inside the preview iframe.
  } finally {
    await server.close();
    // A build that stopped leaves nothing of its own beside the outputs.
    await rm(wbStage, { recursive: true, force: true });
    if (sfStage) await rm(sfStage, { recursive: true, force: true });
  }

  if (skipped.size) report.skippedChecks = SKIPPABLE_CHECKS.filter(c => skipped.has(c));
  report.ms = Math.round(performance.now() - started);
  return report;
}

/** The folder a build writes an output into before it takes the output's place: beside it, so on the same
 *  filesystem, and hidden. */
function staged(output: string): string {
  return join(dirname(output), `.${basename(output)}.pd-build-${process.pid}`);
}

/** Put a finished folder in an output's place: the earlier output is moved aside, then removed. */
async function putInPlace(stage: string, output: string): Promise<void> {
  const aside = `${stage}.earlier`;
  await rm(aside, { recursive: true, force: true });
  const had = await rename(output, aside).then(() => true, (e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return false;
    throw e;
  });
  await rename(stage, output);
  if (had) await rm(aside, { recursive: true, force: true });
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
