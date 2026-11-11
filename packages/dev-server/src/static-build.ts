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

import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type { PatternDumpConfig } from "@pattern-dump/config";
import {
  componentUrl, dataSourceUrl, normalizeBasePath, overviewUrl, PD_ROUTES, previewUrl, renderedSourceUrl,
  staticPathFor, themeCssUrl,
  type ComponentDetailResponse, type ComponentTree, type ShellRuntime, type ThemeSummary, type TreeNode,
} from "@pattern-dump/contracts";
import { startDevServer } from "./index.js";
import { buildShellHtml } from "./http-utils.js";
import { loadPatternPackages } from "./packages.js";
import { resolveServerConfig, shadowedAssetRoots } from "./server-config.js";
import { createSnapshotWriter } from "./snapshot-writer.js";
import { crawlStorefront, hostTransport } from "./storefront/crawl.js";

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
  const sfCrawl = sfGet ? await crawlStorefront(sfGet) : null;
  if (sfCrawl && sfCrawl.problems.length) {
    await server.close();
    throw new Error(`pd build: the storefront has problems, so nothing was written:\n${sfCrawl.problems.map(p => `  - ${p}`).join("\n")}`);
  }
  if (sfCrawl) log(`… storefront checked: ${sfCrawl.urls.length} files`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const origin = `http://127.0.0.1:${server.port}`;
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
      const pages = sfCrawl.urls.filter(u => !/^\/(?:_pd|assets|preview)\//.test(u)).length;
      report.storefront = { outDir: sfOut, pages, files: counts.files, bytes: counts.bytes };
      if (storefront.url === undefined) {
        report.notes.push("storefront.url is not set, so pages have no canonical URL, og:url, og:image or JSON-LD, "
          + "and there is no sitemap: set storefront.url to the site's address, such as \"https://example.com/\"");
      }
      report.notes.push(...storefrontNotes);
      log(`… storefront: ${pages} pages, ${counts.files} files`);
    }

    // Deliberately no 404.html shell: every route has its own index.html, and a host that served the
    // shell for a missing preview would boot a second workbench inside the preview iframe.
  } finally {
    await server.close();
  }

  report.ms = Math.round(performance.now() - started);
  return report;
}
