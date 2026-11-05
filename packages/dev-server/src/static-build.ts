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
import { dirname, join, relative, resolve, sep } from "node:path";
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

export interface StaticBuildReport {
  outDir: string;
  basePath: string;
  files: number;
  bytes: number;
  components: number;
  /** Requests that did not return 200: a component that fails to render, a missing asset. They are not
   *  written, and do not fail the build. */
  warnings: string[];
  ms: number;
}

/** Root-relative PD URL prefixes that must move under the base path. */
const PD_PREFIXES = /(^|["'(\s,=])\/(_pd|api|preview|source|assets)\//g;

/** Prefix every root-relative PD URL in a text response with the base path. "/" leaves it untouched. */
export function withBasePath(text: string, basePath: string): string {
  if (basePath === "/") return text;
  return text.replace(PD_PREFIXES, (_m, lead: string, head: string) => `${lead}${basePath}${head}/`);
}

const isText = (contentType: string): boolean =>
  /\b(text\/html|text\/css|application\/json)\b/.test(contentType);

/** The on-disk path for a snapshot URL path: segments decoded, as a static host will look them up. */
function diskPath(outDir: string, urlPath: string): string {
  return join(outDir, ...urlPath.split("/").map(seg => decodeURIComponent(seg)));
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
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const fixed = opts.now;
  const now = fixed ? (): Date => new Date(fixed.getTime()) : (): Date => new Date();
  const server = await startDevServer(config, root, { port: 0, live: false, now });
  log("… server ready");
  const origin = `http://127.0.0.1:${server.port}`;
  const report: StaticBuildReport = { outDir, basePath, files: 0, bytes: 0, components: 0, warnings: [], ms: 0 };
  const done = new Set<string>();

  /** Fetch a live URL and write it to its snapshot file. Returns the (unrewritten) body, or null. */
  async function capture(liveUrl: string, { optional = false } = {}): Promise<string | null> {
    const file = staticPathFor(liveUrl);
    if (done.has(file)) return null;
    done.add(file);
    const res = await fetch(`${origin}${liveUrl}`);
    if (res.status !== 200) {
      // A component that fails to render is a finding about the design system, not a reason to abort
      // the build: the static shell reports the missing file exactly as the live one reports the error.
      // 404s of optional views (a component without a data file) are expected and not listed.
      if (res.status >= 500 || !optional) {
        const reason = res.status >= 500 ? `: ${((await res.text()).split("\n")[0] ?? "").slice(0, 160)}` : "";
        report.warnings.push(`${res.status} ${liveUrl}${reason}`);
      }
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    const target = diskPath(outDir, file);
    await mkdir(dirname(target), { recursive: true });
    if (isText(type)) {
      const body = await res.text();
      const out = withBasePath(body, basePath);
      await writeFile(target, out);
      report.bytes += Buffer.byteLength(out);
      report.files++;
      return body;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(target, buffer);
    report.bytes += buffer.length;
    report.files++;
    return /javascript/.test(type) ? buffer.toString("utf8") : null;
  }

  /** Write a text body under the snapshot path of a live URL (for responses already in hand). */
  async function store(liveUrl: string, body: string): Promise<void> {
    const file = staticPathFor(liveUrl);
    if (done.has(file)) return;
    done.add(file);
    const target = diskPath(outDir, file);
    await mkdir(dirname(target), { recursive: true });
    const out = withBasePath(body, basePath);
    await writeFile(target, out);
    report.bytes += Buffer.byteLength(out);
    report.files++;
  }

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
      await cp(rootDir, join(outDir, "assets", cfg.assetRootNames[i]), { recursive: true });
      if (cfg.assetRoots.length === 1) await cp(rootDir, join(outDir, "assets"), { recursive: true, force: false });
    }

    // ---- 6. One shell page per route ----
    const runtime: ShellRuntime = {
      mode: "static", basePath, builtAt: now().toISOString(), pdVersion: opts.pdVersion,
      ...(includeAudit ? {} : { audit: false }),
    };
    const shell = withBasePath(buildShellHtml(runtime), basePath);
    for (const route of routes) {
      const target = diskPath(outDir, staticPathFor(route));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, shell);
      report.files++;
      report.bytes += Buffer.byteLength(shell);
    }
    // GitHub Pages runs Jekyll unless told otherwise, and Jekyll drops every folder starting with "_"
    // — which would silently remove _pd/ (the shell, its CSS, every theme and component stylesheet).
    await writeFile(join(outDir, ".nojekyll"), "");
    report.files++;

    // Deliberately no 404.html shell: every route has its own index.html, and a host that served the
    // shell for a missing preview would boot a second workbench inside the preview iframe.
  } finally {
    await server.close();
  }

  report.ms = Math.round(performance.now() - started);
  return report;
}
