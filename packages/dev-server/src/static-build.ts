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

import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { createImageCache } from "@pattern-dump/build";
import { sameHostWorkbenchPath, type PatternDumpConfig } from "@pattern-dump/config";
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
import { crawlStorefront, hostTransport } from "./storefront/crawl.js";
import { checkLinks, linkedWorkbenchRoutes } from "./storefront/links.js";
import { checkPageBasics } from "./storefront/page-basics.js";
import { runPageA11y, type PageA11yFinding } from "@pattern-dump/a11y";
import { workbenchRobotsTxt } from "./storefront/site-files.js";

export interface StaticBuildOptions {
  /** Absolute output directory. Emptied first. */
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
  /** The storefront's own output root, when the project has a storefront. */
  storefront?: { outDir: string; pages: number; files: number; bytes: number };
  /** The storefront's link check: the site pages read, the references checked, the other hosts listed in the notes. */
  links?: { pages: number; references: number; external: number };
  /** The storefront's accessibility check (axe in jsdom, and one <main> and one <h1> per page): the site pages read,
   *  and one line per rule that only warns, with its pages. An error stops the build instead. */
  accessibility?: { pages: number; warnings: string[] };
  ms: number;
}

export async function buildStaticSite(
  config: PatternDumpConfig,
  root: string,
  opts: StaticBuildOptions,
): Promise<StaticBuildReport> {
  const started = performance.now();
  const logLine = opts.log ?? (() => {});
  const log = (line: string): void => logLine(`${line} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
  const basePath = normalizeBasePath(opts.basePath ?? config.build?.basePath);
  const includeAudit = opts.audit ?? config.build?.audit ?? true;
  const outDir = resolve(opts.outDir);
  const cfg = resolveServerConfig(config, root, {}, loadPatternPackages(config.packages, root));

  // The output folder is emptied first, so it must not be — or contain — anything PD reads.
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
  };
  const project = resolve(root);
  if (inside(project, outDir)) throw new Error(`pd build: --out ${outDir} would contain the project itself — choose a folder inside or beside it, like ./dist`);
  for (const source of [cfg.patternsDir, cfg.stylesDir, ...cfg.themeDirs, ...cfg.assetRoots]) {
    if (inside(outDir, source) || inside(source, outDir)) {
      throw new Error(`pd build: --out ${outDir} overlaps ${source}, which Pattern Dump reads — choose another folder`);
    }
  }
  // The storefront's own output root: the same rules, and apart from the workbench's.
  const storefront = cfg.storefront;
  if (storefront) {
    const sfOut = storefront.outDir;
    if (inside(project, sfOut)) throw new Error(`pd build: storefront.outDir ${sfOut} would contain the project itself — choose a folder inside or beside it`);
    for (const source of [cfg.patternsDir, cfg.stylesDir, storefront.pagesDir, ...cfg.themeDirs, ...cfg.assetRoots]) {
      if (inside(sfOut, source) || inside(source, sfOut)) {
        throw new Error(`pd build: storefront.outDir ${sfOut} overlaps ${source}, which Pattern Dump reads — choose another folder`);
      }
    }
    if (inside(sfOut, outDir) || inside(outDir, sfOut)) {
      throw new Error(`pd build: storefront.outDir ${sfOut} and --out ${outDir} overlap — the storefront and the workbench each need a folder of their own`);
    }
    if (!storefront.workbenchUrl) {
      throw new Error("pd build: storefront.workbenchUrl is required to build the storefront — its pages link into the workbench at that address");
    }
    // A workbench published on the storefront's own host is linked at its path, so it must be built for that
    // path: the base path this build uses (--base, else build.basePath, else /).
    const sameHost = sameHostWorkbenchPath(storefront);
    if (sameHost !== undefined && sameHost !== basePath) {
      throw new Error(`pd build: storefront.workbenchUrl is ${storefront.workbenchUrl}, so the workbench must be built for ${sameHost} `
        + `(build.basePath or --base); it is being built for ${basePath}`);
    }
  }

  const fixed = opts.now;
  const now = fixed ? (): Date => new Date(fixed.getTime()) : (): Date => new Date();
  // A storefront page's notes, once each however often the page is fetched: the report's notes.
  const storefrontNotes = new Set<string>();
  const server = await startDevServer(config, root, {
    port: 0, live: false, now, ...(storefront?.workbenchUrl ? { storefrontWorkbenchUrl: storefront.workbenchUrl } : {}),
    onStorefrontNote: note => { storefrontNotes.add(note); },
  });
  log("… server ready");

  // The storefront, crawled before anything is written: a problem anywhere stops the build with both
  // output roots as they were.
  const sfGet = storefront ? hostTransport(server.port, storefront.host) : null;
  // The crawler files: robots.txt always; the sitemap when the site has an address and is indexed.
  const sfFiles: string[] = storefront ? [PD_ROUTES.robots, PD_ROUTES.notFound, ...(storefront.url !== undefined && storefront.index ? [PD_ROUTES.sitemap] : [])] : [];
  const sfCrawl = sfGet ? await crawlStorefront(sfGet, sfFiles) : null;
  if (sfCrawl && sfCrawl.problems.length) {
    await server.close();
    throw new Error(`pd build: the storefront has problems, so nothing was written:\n${sfCrawl.problems.map(p => `  - ${p}`).join("\n")}`);
  }
  if (sfCrawl) log(`… storefront checked: ${sfCrawl.urls.length} files`);
  const origin = `http://127.0.0.1:${server.port}`;

  // The link check (links.ts), also before anything is written: every reference on every site page (its pages and
  // its 404 page; not the previews and redirect stubs it writes) resolves to what this build writes, a link into the
  // workbench to a component and variant the workbench snapshot has. Other hosts are listed in the notes.
  let linkSummary: StaticBuildReport["links"];
  let a11ySummary: StaticBuildReport["accessibility"];
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
      workbench: { url: wbUrl, routes, variants },
    });
    if (links.problems.length) {
      await server.close();
      throw new Error(`pd build: the storefront has broken links, so nothing was written:\n${links.problems.map(p => `  - ${p}`).join("\n")}`);
    }
    for (const [url, on] of links.external) externalNotes.push(`an external link, not checked: ${url} (on ${on.join(", ")})`);
    linkSummary = { pages: pages.length, references: links.references, external: links.external.size };
    log(`… links checked: ${links.references} references on ${pages.length} pages`);

    // Accessibility (step 6b), also before anything is written: one main landmark and one <h1> per site page, and
    // axe's rules that jsdom decides (@pattern-dump/a11y). A critical or serious WCAG finding, and a page without
    // exactly one main and one <h1>, stop the build; the rest are warnings in the report, grouped by rule.
    const errors: string[] = [];
    const warned = new Map<string, { finding: PageA11yFinding; pages: string[]; elements: number }>();
    for (const page of pages) {
      const html = sfCrawl.documents.get(page);
      if (html === undefined) continue;
      for (const p of checkPageBasics(html)) errors.push(`${page}: ${p}`);
      for (const f of await runPageA11y(html)) {
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
    a11ySummary = {
      pages: pages.length,
      warnings: [...warned.values()].map(w => `${w.finding.ruleId} (${w.finding.impact}): ${w.finding.help}, ${w.elements} `
        + `element${w.elements === 1 ? "" : "s"} on ${w.pages.join(", ")} (${w.finding.helpUrl})`),
    };
    log(`… accessibility checked on ${pages.length} pages`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const report: StaticBuildReport = { outDir, basePath, files: 0, bytes: 0, components: 0, warnings: [], notes: [], ms: 0 };
  const { capture, store } = createSnapshotWriter({ outDir, basePath, origin, report });

  /** Every /_pd/ stylesheet and script a document references. */
  const referenced = (html: string): string[] =>
    [...html.matchAll(/(?:href|src)="(\/_pd\/(?:components|themes|scripts)\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));

  try {
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
      if (base.variants.length) routes.add(`/${id}/variants`);
      for (const variant of [undefined, ...base.variants.map(v => v.name)]) {
        const detailText = variant ? await capture(componentUrl(id, variant)) : baseText;
        if (detailText) {
          // The detail response carries the complete preview document — byte-identical to what
          // /preview/:id serves for the default theme — so write it rather than render it twice.
          const { document } = JSON.parse(detailText) as ComponentDetailResponse;
          await store(previewUrl(id, variant), document);
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
      await cp(rootDir, join(outDir, "assets", cfg.assetRootNames[i]), { recursive: true, filter: notABarrier });
      if (cfg.assetRoots.length === 1) await cp(rootDir, join(outDir, "assets"), { recursive: true, force: false, filter: notABarrier });
    }

    // ---- 6. One shell page per route ----
    const runtime: ShellRuntime = {
      mode: "static", basePath, builtAt: now().toISOString(), pdVersion: opts.pdVersion,
      ...(includeAudit ? {} : { audit: false }),
    };
    // Through the writer like every other file: the base path is applied there, once, and a route whose
    // file is already written (by a capture) is not written over. That only happens when a pattern folder
    // shares its name with one of PD's own URL prefixes; the route then has no page, so it is reported.
    const shell = buildShellHtml(runtime);
    for (const route of routes) {
      const holder = await store(route, shell);
      if (holder !== null) {
        report.warnings.push(`shell page for route ${route} not written: ${staticPathFor(route)} already holds the server's response to ${holder}`);
      }
    }
    // GitHub Pages runs Jekyll unless told otherwise, and Jekyll drops every folder starting with "_"
    // — which would silently remove _pd/ (the shell, its CSS, every theme and component stylesheet).
    await writeFile(join(outDir, ".nojekyll"), "");
    report.files++;
    // Crawlers: the workbench is searchable, its previews are not.
    await writeFile(join(outDir, "robots.txt"), workbenchRobotsTxt(basePath));
    report.files++;
    // Unless the storefront's own robots.txt, at this host's root, already keeps these previews out: a
    // workbench published on the storefront's host at this base path (with index: false, it keeps out everything).
    if (basePath !== "/" && sameHostWorkbenchPath(storefront ?? undefined) !== basePath) {
      report.notes.push(`robots.txt is written to the workbench's root, but crawlers read it only at a host's root: `
        + `with the base path ${basePath}, add its rule (Disallow: ${basePath}preview/) to the robots.txt the host serves at /`);
    }

    // ---- 7. The storefront, into its own root, through its own writer ----
    if (storefront && sfGet && sfCrawl) {
      const sfOut = storefront.outDir;
      await rm(sfOut, { recursive: true, force: true });
      await mkdir(sfOut, { recursive: true });
      const counts = { files: 0, bytes: 0, warnings: [] as string[] };
      const sf = createSnapshotWriter({ outDir: sfOut, basePath: "/", origin: "", report: counts, fetch: sfGet });
      for (const url of sfCrawl.urls) await sf.capture(url, { fatal: true });
      if (sf.failures.length) {
        throw new Error(`pd build: the storefront changed while it was being written:\n${sf.failures.map(f => `  - ${f}`).join("\n")}`);
      }
      await writeFile(join(sfOut, ".nojekyll"), "");
      counts.files++;
      const stubs = new Set((await (await sfGet(PD_ROUTES.pages)).json() as StorefrontPagesResponse).pages.flatMap(p => p.redirectFrom ?? []));
      const pages = sfCrawl.urls.filter(u => !/^\/(?:_pd|assets|preview)\//.test(u) && !sfFiles.includes(u) && !stubs.has(u)).length;
      report.storefront = { outDir: sfOut, pages, files: counts.files, bytes: counts.bytes };
      if (storefront.url === undefined) {
        report.notes.push("storefront.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, "
          + "and there is no sitemap: set storefront.url to the site's address, such as \"https://example.com/\"");
      }
      report.notes.push(...storefrontNotes, ...externalNotes);
      if (linkSummary) report.links = linkSummary;
      if (a11ySummary) report.accessibility = a11ySummary;
      log(`… storefront: ${pages} pages, ${counts.files} files`);
    }

    // ---- 8. The image cache keeps what this build used: the variants written to either root ----
    const used = new Set<string>();
    for (const root of [outDir, ...(storefront ? [storefront.outDir] : [])]) {
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
  }

  report.ms = Math.round(performance.now() - started);
  return report;
}
