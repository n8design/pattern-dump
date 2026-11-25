// @pattern-dump/core
// Orchestration: load config, start dev server, run the diagnostics audit.
import { startDevServer, runDiagnosticsAudit, formatAudit, planExport, writeExport, writeThreadedIncluders, buildRewriteMap, deriveHandle, buildStaticSite, ensureScratchDir, renderSocialImages } from "@pattern-dump/dev-server";
import { readProjectGraph, graphJson, describeOf, affectedOf } from "@pattern-dump/dev-server";
import type { DevServerOptions, AuditFormat, StaticBuildReport } from "@pattern-dump/dev-server";
import { PD_HOSTS, PD_ROUTES, type DiagnosticsGraph, type StorefrontPagesResponse } from "@pattern-dump/contracts";
import { request as httpRequest } from "node:http";
import { build as esbuild } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { basename, join, dirname, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ConfigError, configWarnings, validateConfig, withOwnManifest, type PatternDumpConfig } from "@pattern-dump/config";

export async function runDev(
  root: string,
  opts?: DevServerOptions,
  configPath?: string
): Promise<void> {
  const config = await loadConfig(root, configPath);
  // The config file is watched: a change to storefront.site alone is taken live (DevServerOptions.configPath).
  const file = configFileOf(root, configPath);
  await startDevServer(config, root, { ...opts, configPath: file, reloadConfig: () => loadConfig(root, configPath) });
  // dev-server runs indefinitely; do not close unless signalled.
}

/**
 * `pd mcp`: the MCP server over stdio, for a client that starts a process (Claude Code's .mcp.json, the Claude desktop
 * app). One JSON-RPC message per line in, one answer per line out. It runs the project's own pd dev in this process
 * (on free loopback ports, with its watcher), so its answers are pd dev's and follow every save. stdout carries the
 * protocol only: whatever else would be printed goes to stderr. Ends when stdin closes.
 */
export async function runMcp(root: string, configPath: string | undefined, version: string): Promise<void> {
  const out = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  console.log = console.error;
  console.info = console.error;
  const config = await loadConfig(root, configPath);
  const file = configFileOf(root, configPath);
  const server = await startDevServer(config, root, {
    port: 0, wsPort: 0, version, configPath: file, reloadConfig: () => loadConfig(root, configPath),
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try { message = JSON.parse(line); } catch {
      out(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "the line is not JSON" } })}\n`);
      continue;
    }
    const answer = await server.mcp(message);
    if (answer) out(`${JSON.stringify(answer)}\n`);
  }
  await server.close();
}

/**
 * Whether a website's pages render: the project's dev server, started without live reload, is asked for every page
 * the site has, as a browser asks for them. `pd init --site` runs it once the style guide is installed, so a
 * package without a skin (layouts/page, partials/base) or without a `patternDump` field is named before the first
 * `npm run dev`. Resolves to the problems, one line each; none when every page answers 200. What the server prints
 * while it runs is kept, and returned with a problem.
 */
export async function checkSitePages(root: string): Promise<string[]> {
  const printed: string[] = [];
  const keep = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...args: unknown[]): void => { printed.push(args.map(String).join(" ")); };
  console.log = capture; console.error = capture; console.warn = capture;
  try {
    const config = await loadConfig(root);
    if (!config.storefront) return ["the project has no site: there are no pages to check"];
    const host = config.storefront.host ?? PD_HOSTS.storefront;
    const server = await startDevServer(config, root, { port: 0, wsPort: 0, live: false });
    try {
      const get = (path: string) => new Promise<{ status: number; body: string }>((ok, fail) => {
        httpRequest({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", d => { body += d; });
          res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
        }).on("error", fail).end();
      });
      const list = await get(PD_ROUTES.pages);
      if (list.status !== 200) return [`the site's page list answered ${list.status}`];
      const problems: string[] = [];
      for (const page of (JSON.parse(list.body) as StorefrontPagesResponse).pages) {
        const res = await get(page.route);
        if (res.status !== 200) problems.push(`${page.route} (layout "${page.layout}") does not render: ${res.status}`);
      }
      // What the server printed about them: each page's problems, with file and line.
      return problems.length ? [...problems, ...printed.filter(l => l.startsWith("[site]") || l.startsWith("  - "))] : [];
    } finally {
      await server.close();
    }
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  } finally {
    Object.assign(console, keep);
  }
}

/**
 * `pd build` — write a static snapshot of the workbench (see dev-server/src/static-build.ts) and print
 * where it went. `out` resolves against the root and defaults to config.build.outDir, then outDir,
 * then "dist"; `base` defaults to config.build.basePath, then "/".
 */
export async function runBuild(
  root: string,
  configPath: string | undefined,
  options: { out?: string; base?: string; audit?: boolean; browser?: boolean; checkWorkers?: number; skipChecks?: string[]; pdVersion: string },
): Promise<void> {
  const config = await loadConfig(root, configPath);
  const outDir = resolve(root, options.out ?? config.build?.outDir ?? config.outDir ?? "dist");
  const report = await buildStaticSite(config, root, {
    outDir,
    ...(options.base !== undefined ? { basePath: options.base } : {}),
    ...(options.audit !== undefined ? { audit: options.audit } : {}),
    ...(options.browser ? { browser: true } : {}),
    ...(options.checkWorkers !== undefined ? { checkWorkers: options.checkWorkers } : {}),
    ...(options.skipChecks !== undefined ? { skipChecks: options.skipChecks } : {}),
    pdVersion: options.pdVersion,
    log: line => console.log(`[pd build] ${line}`),
  });
  for (const line of buildReportLines(report, config.storefront?.workbenchUrl)) console.log(line);
}

/** What `pd build` prints when it's done, one line each, in order: `workbenchUrl` is site.workbenchUrl as the config
 *  has it. The last lines are the ones written to be seen: NO SOCIAL IMAGE, then NOT CHECKED. */
export function buildReportLines(report: StaticBuildReport, workbenchUrl: string | undefined): string[] {
  const lines: string[] = [];
  const mb = (report.bytes / 1024 / 1024).toFixed(1);
  if (report.workbench === false) {
    lines.push(`[pd build] workbench: not built (build.workbench: false); the pages link to it at ${workbenchUrl ?? "site.workbenchUrl"}`);
  } else {
    lines.push(`[pd build] ${report.components} components → ${report.files} files, ${mb} MB in ${report.ms} ms`);
    lines.push(`[pd build] ${report.outDir}  (served from ${report.basePath})`);
  }
  if (report.borrowedStyles) {
    const n = report.borrowedStyles;
    lines.push(`[pd build] styles: ${n} stylesheet${n === 1 ? "" : "s"} linked by a borrowed class (STYLE_BORROWED on the component's Diagnostics tab)`);
  }
  if (report.storefront) {
    lines.push(`[pd build] site: ${report.storefront.pages} pages → ${report.storefront.files} files in ${report.storefront.outDir}  (served from ${report.storefront.basePath})`);
  }
  if (report.links) {
    lines.push(`[pd build] links: ${report.links.references} references on ${report.links.pages} pages, none broken`
      + (report.links.external ? `; ${report.links.external} external, not checked (notes)` : ""));
  }
  if (report.accessibility) {
    const n = report.accessibility.warnings.length;
    lines.push(`[pd build] accessibility: ${report.accessibility.pages} pages${report.accessibility.browser ? ", in jsdom and Chromium" : ""}, no errors`
      + (n ? `; ${n} rule${n === 1 ? "" : "s"} with warnings:` : ""));
    for (const w of report.accessibility.warnings) lines.push(`[pd build]   warning: ${w}`);
  }
  if (report.images) {
    const n = report.images.warnings.length;
    lines.push(`[pd build] images: ${n ? `${n} with a variant that doesn't fit:` : "every variant fits its box"}`);
    for (const w of report.images.warnings) lines.push(`[pd build]   warning: ${w}`);
  }
  const social = report.socialImages;
  if (social) {
    const from = [[social.rendered, "rendered"], [social.cached, "from the cache"], [social.committed, "committed"]]
      .filter(([k]) => k).map(([k, what]) => `${k} ${what}`);
    if (social.missing.length) from.push(`${social.missing.length} without one:`);
    lines.push(`[pd build] social images: ${social.pages} page${social.pages === 1 ? "" : "s"}${from.length ? ` (${from.join(", ")})` : ""}`);
    for (const w of social.missing) lines.push(`[pd build]   warning: ${w}`);
  }
  if (report.classes) {
    const n = report.classes.warnings.length;
    lines.push(`[pd build] classes: ${n ? `${n} outside the design system:` : "every class on the site's pages is the style guide's"}`);
    for (const w of report.classes.warnings) lines.push(`[pd build]   warning: ${w}`);
  }
  if (report.llms) lines.push(`[pd build] llms.txt: ${report.llms.pages} page${report.llms.pages === 1 ? "" : "s"}`);
  if (report.feeds) lines.push(`[pd build] feeds: ${report.feeds.files} file${report.feeds.files === 1 ? "" : "s"}`);
  if (report.mounts) {
    const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
    const all = report.mounts.reduce((t, m) => ({ files: t.files + m.files, bytes: t.bytes + m.bytes }), { files: 0, bytes: 0 });
    lines.push(`[pd build] mounts: ${files(all.files)} (${size(all.bytes)}), copied as they are: `
      + report.mounts.map(m => `${m.to} ${files(m.files)} (${size(m.bytes)})`).join(", "));
  }
  if (report.search) {
    lines.push(`[pd build] search: ${report.search.pages} pages indexed → ${report.search.files} files in _pd/search/ (${(report.search.bytes / 1024).toFixed(0)} KB)`);
  }
  if (report.drafts) {
    lines.push(`[pd build] drafts: ${report.drafts.length} left out (${report.drafts.join(", ")})`);
    // A folder's draft default hides every page under it: said per folder, so a forgotten line can't do it silently.
    for (const d of report.draftsByDefaults ?? []) {
      lines.push(`[pd build]   ${d.pages} page${d.pages === 1 ? " is a draft" : "s are drafts"} via the childDefaults of ${d.from}`);
    }
  }
  if (report.scheduled) {
    lines.push(`[pd build] scheduled: ${report.scheduled.length} held back (${report.scheduled.map(s => `${s.path} until ${s.until}`).join(", ")})`);
  }
  for (const w of report.warnings) lines.push(`[pd build]   not built: ${w}`);
  for (const n of report.notes) lines.push(`[pd build]   note: ${n}`);
  // Next to last, written to be seen: the pages that went out with the site's image, or none, for want of a card.
  if (social?.missing.length) {
    const n = social.missing.length;
    const pages = `${n} page${n === 1 ? "" : "s"}`;
    lines.push(`[pd build] NO SOCIAL IMAGE: ${pages} ${social.siteImage ? `use${n === 1 ? "s" : ""} the site image instead` : `ha${n === 1 ? "s" : "ve"} no link-preview image`}`
      + ` (run pd social, or install Playwright)`);
  }
  // Last, so it is the line a reader sees: what this build did not check.
  if (report.skippedChecks) {
    const what: Record<string, string> = {
      a11y: "the accessibility of the site's pages (a11y)",
      html: "the components' markup against HTML's content model (html)",
    };
    lines.push(`[pd build] NOT CHECKED: ${report.skippedChecks.map(c => what[c] ?? c).join(", ")}, as asked (--skip-checks or build.skipChecks)`);
  }
  return lines;
}

/**
 * `pd social`: render the site's social images into the project (<site>/social/), to be committed, and print what
 * it did (dev-server/src/social-command.ts).
 */
export async function runSocial(root: string, configPath: string | undefined, pdVersion: string): Promise<void> {
  const config = await loadConfig(root, configPath);
  await renderSocialImages(config, root, { pdVersion, log: line => console.log(`[pd social] ${line}`) });
}

/**
 * `pd audit` — build the diagnostics graph headlessly, write the report + serialized graph to the
 * PD-owned scratch path (never the project root), and print the report. Returns nothing; exits when done.
 *
 * `format` selects the report serialization (`md` default, `text`, or `json`). The `json` report is the
 * CI-consumable rollup — distinct from the raw bipartite graph JSON, which is always persisted at
 * `artifactPath` and reachable via its printed path. To keep `json` stdout machine-parseable, the human
 * `[pd audit]` meta lines go to stderr for the `json` format (stdout stays pure JSON); `md`/`text` keep
 * their meta on stdout as before.
 */
export async function runAudit(
  root: string, configPath?: string, format: AuditFormat = "md", opts: { strict?: boolean } = {},
): Promise<{ failed: boolean }> {
  const config = await loadConfig(root, configPath);
  const { graph, style, reaudited, reused, artifactPath, imageWarning } = await runDiagnosticsAudit(config, root);
  const report = formatAudit(graph, format, { style });
  const ext = format === "json" ? "json" : format === "text" ? "txt" : "md";
  const reportPath = join(dirname(artifactPath), `diagnostics-report.${ext}`);
  await writeFile(reportPath, report, "utf-8");

  console.log(report);
  // Meta lines: stderr for json (so stdout is pure JSON for CI), stdout otherwise.
  const meta = format === "json" ? console.error : console.log;
  const lines = auditSummaryLines({ graph, reaudited: reaudited.length, reused, artifactPath, reportPath, ...(imageWarning ? { imageWarning } : {}) });
  const verdict = auditVerdict(graph.occurrences, opts.strict === true);
  meta(`${format === "json" ? "" : "\n"}${[...lines, ...(verdict ? [verdict] : [])].join("\n")}`);
  return { failed: verdict !== undefined };
}

/** Why `pd audit` fails, as its last line, or undefined when it passes: it fails on an error, as pd build fails on its
 *  checks' errors, and with `strict` on any finding. */
export function auditVerdict(occurrences: ReadonlyArray<{ severity: string }>, strict: boolean): string | undefined {
  if (strict) {
    if (!occurrences.length) return undefined;
    return `[pd audit] failed: ${occurrences.length} defect${occurrences.length === 1 ? "" : "s"} found, with --strict (a warning fails it too).`;
  }
  const errors = occurrences.filter(o => o.severity === "error").length;
  if (!errors) return undefined;
  return `[pd audit] failed: ${errors} error${errors === 1 ? "" : "s"} found (warnings alone don't fail it; --strict makes them fail it too).`;
}

/** The audit's summary, after its report: what was re-audited, where the files are, the defects, and the image
 *  warning once for the whole audit, not per component (a missing sharp is the installation's, not a component's). */
export function auditSummaryLines(r: {
  graph: Pick<DiagnosticsGraph, "occurrences" | "components">; reaudited: number; reused: number;
  artifactPath: string; reportPath: string; imageWarning?: string;
}): string[] {
  const affected = new Set(r.graph.occurrences.map(o => o.component)).size;
  return [
    `[pd audit] re-audited ${r.reaudited}, reused ${r.reused} (of ${r.graph.components.length}).`,
    `[pd audit] serialized graph: ${r.artifactPath}`,
    `[pd audit] report: ${r.reportPath}`,
    `[pd audit] ${r.graph.occurrences.length} defects across ${affected}/${r.graph.components.length} components.`,
    ...(r.imageWarning ? [`[pd audit] warning: ${r.imageWarning}`] : []),
  ];
}

/**
 * A PD-owned default export sink OUTSIDE the project root: an `export/` leaf of the root's scratch folder (the
 * user's cache folder, created for the user only), so a written corpus never collides with the diagnostics
 * artifacts. Used only when `--out` is omitted. `--out <dir>` is the intended durable target; this is the
 * ephemeral fallback.
 */
async function defaultExportDir(root: string): Promise<string> {
  return join(await ensureScratchDir(root), "export");
}

/**
 * Reject an output dir that is the project root or nested inside it. The root may be a frozen,
 * read-only tree PD does not own (B7 writes hTWOo's *corrected* form OUT, never back into the
 * frozen source). The sink must be separable from the input root — this enforces it.
 */
function assertOutsideRoot(outDir: string, root: string): void {
  const rel = relative(resolve(root), resolve(outDir));
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (inside) {
    throw new Error(
      `--out must be outside --root (the root is read-only; export writes the corrected form elsewhere).\n` +
      `  root: ${resolve(root)}\n  out:  ${resolve(outDir)}`,
    );
  }
}

/**
 * `pd export` — B7 slice 1: read the subject's flattened families and write their corrected form
 * (one base template + `~*.json` overlays) to a separable, PD-owned sink. Slice 1 wires the command
 * and the sink; the collapse pipeline lands in a following commit.
 *
 * The export is FAITHFUL, never corrective: it collapses structure and preserves the subject's values
 * verbatim — it does not auto-repair drift. Same discipline as the flattening diagnostic (report,
 * don't fix) and the D1 thesis (read what the subject declares, don't impose).
 */
/** `pd graph`: the project graph, as JSON (the same as /api/graph), or a summary of its nodes and edges by kind. */
export async function runGraph(root: string, configPath: string | undefined, json: boolean): Promise<string> {
  const { graph } = await readProjectGraph(await loadConfig(root, configPath), root);
  const g = graphJson(graph);
  if (json) return JSON.stringify(g);
  const count = (xs: ReadonlyArray<{ kind: string }>): string => {
    const by = new Map<string, number>();
    for (const x of xs) by.set(x.kind, (by.get(x.kind) ?? 0) + 1);
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n} ${k}`).join(", ");
  };
  return [`Project graph (version ${g.version})`, `  ${g.nodes.length} nodes: ${count(g.nodes)}`, `  ${g.edges.length} edges: ${count(g.edges)}`,
    "", "pd graph --json prints it whole; pd describe <id> answers for one component."].join("\n");
}

/** `pd describe <id>`: its contract, usage, ownership and blast radius, as JSON or a short text. */
export async function runDescribe(root: string, configPath: string | undefined, id: string, json: boolean): Promise<string> {
  const { graph, discoveryMap } = await readProjectGraph(await loadConfig(root, configPath), root);
  const d = await describeOf(graph, id, discoveryMap);
  if (json) return JSON.stringify(d, null, 2);
  const list = (xs: string[]): string => (xs.length ? [...new Set(xs)].join(", ") : "none");
  return [
    `${d.id} (${d.contract.role}${"package" in d.contract.origin ? `, from ${d.contract.origin.package}` : ""})`,
    `  Contract: ${d.contract.schema === null ? "no schema" : "a schema"}; variants: ${list(d.contract.variants.map(v => v.id))}`,
    `  Used by: ${list(d.usage.components)}; on pages: ${list([...new Set(d.usage.pages.map(p => p.route))])}`,
    `  Stylesheets: ${list(d.ownership.stylesheets.map(s => s.file))}`,
    `  Styles classes of: ${list(d.ownership.stylesClassesOf.map(c => c.component))}; its classes are styled by: ${list(d.ownership.classesStyledBy.map(c => c.component))}`,
    `  Blast radius: ${d.blastRadius.components.length} components, ${d.blastRadius.stylesheets.length} stylesheets, ${d.blastRadius.pages.length} pages`,
    "", "pd describe <id> --json gives each part in full, with the path to everything in the blast radius.",
  ].join("\n");
}

/** `pd affected <id|file>...`: everything the change reaches. A target that names a file (from `cwd`) is a changed
 *  file; anything else a component id. */
export async function runAffected(root: string, configPath: string | undefined, targets: readonly string[], json: boolean, cwd: string): Promise<string> {
  const { graph, pagesPrefix, display } = await readProjectGraph(await loadConfig(root, configPath), root);
  const files: string[] = [];
  const ids: string[] = [];
  for (const t of targets) {
    const abs = resolve(cwd, t);
    if (existsSync(abs)) files.push(display(abs)); else ids.push(t);
  }
  const a = affectedOf(graph, { ids, files }, pagesPrefix);
  if (json) return JSON.stringify(a, null, 2);
  return [
    `Changed: ${a.changed.join(", ") || "nothing the graph knows"}${a.unknown.length ? ` (not in the graph: ${a.unknown.join(", ")})` : ""}`,
    `  ${a.components.length} components: ${a.components.join(", ") || "none"}`,
    `  ${a.pages.length} pages: ${a.pages.join(", ") || "none"}`,
  ].join("\n");
}

export async function runExport(root: string, configPath?: string, outDir?: string): Promise<void> {
  const config = await loadConfig(root, configPath);
  const patternsDir = resolve(root, config.patternsDir);
  const sink = outDir ? resolve(process.cwd(), outDir) : await defaultExportDir(root);
  assertOutsideRoot(sink, root);

  const plan = await planExport(config, root);
  await mkdir(sink, { recursive: true });
  // Both collapse (leaf) and threaded (include-consumed shape (a)) families write base+overlays the same
  // way; threaded families additionally get their include sites rewritten (below).
  const threadedFamilies = plan.threaded.map((t) => t.family);
  const { files } = await writeExport([...plan.collapse, ...threadedFamilies], sink);
  // Slice 2: rewrite each threaded family's include sites into the sink (base+overlays already written).
  const { files: includerFiles, rewrites } = await writeThreadedIncluders(plan.threaded, patternsDir, sink);

  console.log(`[pd export] patterns: ${patternsDir}`);
  console.log(`[pd export] sink: ${sink}${outDir ? "" : " (default: pass --out <dir> for a durable target)"}`);
  console.log(`[pd export] ${plan.collapse.length} family(ies) collapse (leaf, shape (a)); ${plan.threaded.length} threaded (include-consumed shape (a), slice 2); ${plan.deferred.length} deferred (§7 hazard, not shape (a): slice 3 / shape-(c) track); ${plan.skipped.length} skipped (leaf but not lossless shape (a)).`);
  console.log(`[pd export] wrote ${files.length} collapsed file(s) + ${includerFiles.length} rewritten includer(s) (${rewrites} include site(s) threaded):`);
  for (const f of files) console.log(`    ${f}`);
  for (const f of includerFiles) console.log(`    ${f}  (includer, rewritten)`);

  // Report each family's group so the collapse target is verified against the flattening cluster.
  for (const family of plan.collapse) {
    console.log(`\n[pd export] COLLAPSE ${family.baseId}  (root .${family.root}, ${family.variants.length} variants)`);
    for (const v of family.variants) {
      console.log(`    ~${v.token || "(base-default)"}  modifier="${v.modifier}"  ← ${v.sourceId}`);
    }
  }
  for (const t of plan.threaded) {
    const family = t.family;
    console.log(`\n[pd export] THREADED ${family.baseId}  (root .${family.root}, ${family.variants.length} variants)`);
    for (const v of family.variants) {
      console.log(`    ~${v.token || "(base-default)"}  modifier="${v.modifier}"  ← ${v.sourceId}`);
    }
  }

  // Commit-2 CHECKPOINT: the include-rewrite map — `oldFlatHandle → (baseHandle, modifier)` — printed
  // BEFORE any include site is rewritten. The modifier values must be exactly the collapsed `~*.json`
  // overlay values (faithful). A wrong map here corrupts every rewrite.
  const rewriteMap = buildRewriteMap(threadedFamilies);
  if (rewriteMap.size) {
    // hazardSites are keyed by member SLASH id; the map is keyed by member HANDLE. Correlate via
    // deriveHandle so the report shows which include sites each flat handle is rewritten at.
    const sitesByHandle = new Map<string, Set<string>>();
    for (const t of plan.threaded) {
      for (const [memberId, sites] of Object.entries(t.hazardSites)) {
        const set = sitesByHandle.get(deriveHandle(memberId)) ?? new Set<string>();
        for (const s of sites) set.add(s);
        sitesByHandle.set(deriveHandle(memberId), set);
      }
    }
    console.log(`\n[pd export] REWRITE MAP (${rewriteMap.size} flat handle(s) → collapsed base + threaded modifier):`);
    for (const [oldHandle, { baseHandle, modifier }] of [...rewriteMap].sort((a, b) => a[0].localeCompare(b[0]))) {
      const sites = [...(sitesByHandle.get(oldHandle) ?? [])].sort();
      const sitesNote = sites.length ? `  used-by: [${sites.join(", ")}]` : "  (no include site: free member)";
      console.log(`    {{> ${oldHandle}}}  →  {{> ${baseHandle} modifier="${modifier}"}}${sitesNote}`);
    }
  }
  for (const d of plan.deferred) {
    const sites = Object.entries(d.hazardSites).map(([m, s]) => `${m}→[${s.join(", ")}]`).join("; ");
    console.log(`\n[pd export] DEFERRED (${d.members.length} members; §7 hazard: ${sites})`);
  }
  for (const s of plan.skipped) {
    console.log(`\n[pd export] SKIPPED [${s.reason}] (${s.members.length} members: ${s.members.join(", ")})`);
  }
}

/**
 * Load the project config. The config *file* location is decoupled from the project root:
 *  - `configPath` given (--config): load exactly that file (it may live outside the root, which
 *    is how a read-only project you don't own gets opened).
 *  - `configPath` absent: fall back to `pattern-dump.config.(ts|json)` at the root.
 *
 * Either way, the config's *internal* directory paths (patternsDir, styles.dir, …) resolve
 * against `root`, never against the config file's location — the single resolution base.
 *
 * The loaded value is validated (unknown keys, missing required keys, wrong types) before anything
 * reads it, so a typo is reported by name instead of failing later in whichever reader hits it.
 */
export async function loadConfig(root: string, configPath?: string): Promise<PatternDumpConfig> {
  if (configPath) {
    if (!existsSync(configPath)) {
      throw new ConfigError(`--config file not found: ${configPath}`);
    }
    return loaded(await withRootManifest(root, await readConfigFile(configPath), configPath), configPath);
  }

  const path = configFileOf(root);
  if (path) return loaded(await withRootManifest(root, await readConfigFile(path), basename(path)), basename(path));

  throw new ConfigError(
    `No pattern-dump.config.ts or pattern-dump.config.json found in ${root} (and no --config given)`
  );
}

/** The config, validated, after a warning for each key it writes with its name before 0.8.0 (storefront is now site). */
function loaded(raw: unknown, source: string): PatternDumpConfig {
  for (const w of configWarnings(raw)) console.warn(`[pd] warning: ${source}: ${w}`);
  return validateConfig(raw, source);
}

/** A project that is also a pattern package takes the folders its config doesn't name from its own package.json's
 *  `patternDump` field (withOwnManifest). Without a package.json, or one without the field, the config as it is. */
async function withRootManifest(root: string, raw: unknown, configName: string): Promise<unknown> {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return raw;
  let pkg: unknown;
  try { pkg = JSON.parse(await readFile(pkgPath, "utf-8")); } catch { return raw; }
  const manifest = typeof pkg === "object" && pkg !== null ? (pkg as { patternDump?: unknown }).patternDump : undefined;
  return manifest === undefined ? raw : withOwnManifest(raw, manifest, { config: configName, manifest: "package.json" });
}

/** The file loadConfig reads: `configPath` when given, else the root's own config file; undefined when
 *  there is none. */
export function configFileOf(root: string, configPath?: string): string | undefined {
  if (configPath) return configPath;
  for (const name of CONFIG_NAMES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}
const CONFIG_NAMES = ["pattern-dump.config.ts", "pattern-dump.config.json"] as const;

/** The config file's value, not yet validated: parsed JSON, or a TS config's default export. */
async function readConfigFile(path: string): Promise<unknown> {
  return path.endsWith(".json") ? JSON.parse(await readFile(path, "utf-8")) : loadTsConfig(path);
}

/** Transpile a TS config to a temp ESM file and import its default export. */
async function loadTsConfig(tsPath: string): Promise<unknown> {
  // A name of its own for every load: loads in the same millisecond (pd processes started together, or
  // several loads in one process) would otherwise write, import and delete one shared file.
  const tmp = join(tmpdir(), `pd-config-${process.pid}-${randomUUID()}.mjs`);
  try {
    await esbuild({
      entryPoints: [tsPath],
      bundle: true,
      format: "esm",
      platform: "node",
      // No packages:"external" — the temp file runs from /tmp so we must inline deps.
      outfile: tmp,
    });
    const { default: cfg } = await import(pathToFileURL(tmp).href);
    return cfg as unknown;
  } finally {
    await unlink(tmp).catch(() => {/* best-effort cleanup */});
  }
}
