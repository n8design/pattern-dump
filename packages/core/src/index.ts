// @pattern-dump/core
// Orchestration: load config, start dev server, run the diagnostics audit.
import { startDevServer, runDiagnosticsAudit, formatAudit, planExport, writeExport, writeThreadedIncluders, buildRewriteMap, deriveHandle, buildStaticSite } from "@pattern-dump/dev-server";
import type { DevServerOptions, AuditFormat } from "@pattern-dump/dev-server";
import type { DiagnosticsGraph } from "@pattern-dump/contracts";
import { build as esbuild } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { basename, join, dirname, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ConfigError, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";

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
 * `pd build` — write a static snapshot of the workbench (see dev-server/src/static-build.ts) and print
 * where it went. `out` resolves against the root and defaults to config.build.outDir, then outDir,
 * then "dist"; `base` defaults to config.build.basePath, then "/".
 */
export async function runBuild(
  root: string,
  configPath: string | undefined,
  options: { out?: string; base?: string; audit?: boolean; pdVersion: string },
): Promise<void> {
  const config = await loadConfig(root, configPath);
  const outDir = resolve(root, options.out ?? config.build?.outDir ?? config.outDir ?? "dist");
  const report = await buildStaticSite(config, root, {
    outDir,
    ...(options.base !== undefined ? { basePath: options.base } : {}),
    ...(options.audit !== undefined ? { audit: options.audit } : {}),
    pdVersion: options.pdVersion,
    log: line => console.log(`[pd build] ${line}`),
  });
  const mb = (report.bytes / 1024 / 1024).toFixed(1);
  console.log(`[pd build] ${report.components} components → ${report.files} files, ${mb} MB in ${report.ms} ms`);
  console.log(`[pd build] ${report.outDir}  (served from ${report.basePath})`);
  if (report.storefront) {
    console.log(`[pd build] storefront: ${report.storefront.pages} pages → ${report.storefront.files} files in ${report.storefront.outDir}  (served from /)`);
  }
  if (report.links) {
    console.log(`[pd build] links: ${report.links.references} references on ${report.links.pages} pages, none broken`
      + (report.links.external ? `; ${report.links.external} external, not checked (notes)` : ""));
  }
  if (report.accessibility) {
    const n = report.accessibility.warnings.length;
    console.log(`[pd build] accessibility: ${report.accessibility.pages} pages, no errors`
      + (n ? `; ${n} rule${n === 1 ? "" : "s"} with warnings:` : ""));
    for (const w of report.accessibility.warnings) console.log(`[pd build]   warning: ${w}`);
  }
  for (const w of report.warnings) console.log(`[pd build]   not built: ${w}`);
  for (const n of report.notes) console.log(`[pd build]   note: ${n}`);
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
export async function runAudit(root: string, configPath?: string, format: AuditFormat = "md"): Promise<void> {
  const config = await loadConfig(root, configPath);
  const { graph, reaudited, reused, artifactPath, imageWarning } = await runDiagnosticsAudit(config, root);
  const report = formatAudit(graph, format);
  const ext = format === "json" ? "json" : format === "text" ? "txt" : "md";
  const reportPath = join(dirname(artifactPath), `diagnostics-report.${ext}`);
  await writeFile(reportPath, report, "utf-8");

  console.log(report);
  // Meta lines: stderr for json (so stdout is pure JSON for CI), stdout otherwise.
  const meta = format === "json" ? console.error : console.log;
  const lines = auditSummaryLines({ graph, reaudited: reaudited.length, reused, artifactPath, reportPath, ...(imageWarning ? { imageWarning } : {}) });
  meta(`${format === "json" ? "" : "\n"}${lines.join("\n")}`);
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
 * A PD-owned default export sink OUTSIDE the project root, under the OS temp dir. Used only when
 * `--out` is omitted. Keyed by a hash of the root (mirrors dev-server's pdScratchDir), with a
 * dedicated `export/` leaf so a written corpus never collides with the diagnostics artifacts.
 * `--out <dir>` is the intended durable target; this is the ephemeral fallback.
 */
function defaultExportDir(root: string): string {
  const key = createHash("sha1").update(resolve(root)).digest("hex").slice(0, 16);
  return join(tmpdir(), "pattern-dump", key, "export");
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
export async function runExport(root: string, configPath?: string, outDir?: string): Promise<void> {
  const config = await loadConfig(root, configPath);
  const patternsDir = resolve(root, config.patternsDir);
  const sink = outDir ? resolve(process.cwd(), outDir) : defaultExportDir(root);
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
  console.log(`[pd export] sink: ${sink}${outDir ? "" : " (default — pass --out <dir> for a durable target)"}`);
  console.log(`[pd export] ${plan.collapse.length} family(ies) collapse (leaf, shape (a)); ${plan.threaded.length} threaded (include-consumed shape (a) — slice 2); ${plan.deferred.length} deferred (§7 hazard, not shape (a) — slice 3 / shape-(c) track); ${plan.skipped.length} skipped (leaf but not lossless shape (a)).`);
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
      const sitesNote = sites.length ? `  used-by: [${sites.join(", ")}]` : "  (no include site — free member)";
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
    return validateConfig(await readConfigFile(configPath), configPath);
  }

  const path = configFileOf(root);
  if (path) return validateConfig(await readConfigFile(path), basename(path));

  throw new ConfigError(
    `No pattern-dump.config.ts or pattern-dump.config.json found in ${root} (and no --config given)`
  );
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
