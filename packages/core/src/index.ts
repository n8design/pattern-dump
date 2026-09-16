// @pattern-dump/core
// Orchestration: load config, start dev server, run the diagnostics audit.
import { startDevServer, runDiagnosticsAudit, formatAudit, planExport, writeExport, writeThreadedIncluders, buildRewriteMap, deriveHandle, buildStaticSite } from "@pattern-dump/dev-server";
import type { DevServerOptions, AuditFormat } from "@pattern-dump/dev-server";
import { build as esbuild } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { PatternDumpConfig } from "@pattern-dump/config";

export async function runDev(
  root: string,
  opts?: DevServerOptions,
  configPath?: string
): Promise<void> {
  const config = await loadConfig(root, configPath);
  await startDevServer(config, root, opts);
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
  for (const w of report.warnings) console.log(`[pd build]   not built: ${w}`);
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
  const { graph, reaudited, reused, artifactPath } = await runDiagnosticsAudit(config, root);
  const report = formatAudit(graph, format);
  const ext = format === "json" ? "json" : format === "text" ? "txt" : "md";
  const reportPath = join(dirname(artifactPath), `diagnostics-report.${ext}`);
  await writeFile(reportPath, report, "utf-8");

  console.log(report);
  const affected = new Set(graph.occurrences.map(o => o.component)).size;
  // Meta lines: stderr for json (so stdout is pure JSON for CI), stdout otherwise.
  const meta = format === "json" ? console.error : console.log;
  meta(`${format === "json" ? "" : "\n"}[pd audit] re-audited ${reaudited.length}, reused ${reused} (of ${graph.components.length}).`);
  meta(`[pd audit] serialized graph: ${artifactPath}`);
  meta(`[pd audit] report: ${reportPath}`);
  meta(`[pd audit] ${graph.occurrences.length} defects across ${affected}/${graph.components.length} components.`);
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
 */
export async function loadConfig(root: string, configPath?: string): Promise<PatternDumpConfig> {
  if (configPath) {
    if (!existsSync(configPath)) {
      throw new Error(`--config file not found: ${configPath}`);
    }
    return configPath.endsWith(".json")
      ? (JSON.parse(await readFile(configPath, "utf-8")) as PatternDumpConfig)
      : loadTsConfig(configPath);
  }

  const tsPath = join(root, "pattern-dump.config.ts");
  const jsonPath = join(root, "pattern-dump.config.json");

  if (existsSync(tsPath)) return loadTsConfig(tsPath);
  if (existsSync(jsonPath)) {
    return JSON.parse(await readFile(jsonPath, "utf-8")) as PatternDumpConfig;
  }

  throw new Error(
    `No pattern-dump.config.ts or pattern-dump.config.json found in ${root} (and no --config given)`
  );
}

/** Transpile a TS config to a temp ESM file and import its default export. */
async function loadTsConfig(tsPath: string): Promise<PatternDumpConfig> {
  const tmp = join(tmpdir(), `pd-config-${Date.now()}.mjs`);
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
    return cfg as PatternDumpConfig;
  } finally {
    await unlink(tmp).catch(() => {/* best-effort cleanup */});
  }
}
