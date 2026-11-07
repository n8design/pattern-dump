// Project loaders — read the subject project's config-declared directories into renderer inputs.
//
// Both share one discipline that is the point of the module: a single bad file is ISOLATED AND
// LOGGED, never fatal. PD reads design systems it did not author, often read-only and often
// imperfect; one malformed helper or data file must not sink the whole set, because the
// alternative is a workbench that refuses to open the system you need to inspect.
//
// Explicit arguments; no server state. Called from exactly two places — the dev-server bootstrap
// and the headless `pd audit` bootstrap — which is why they belong together rather than with
// either caller.

import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deepMerge } from "@pattern-dump/renderer";

/**
 * Load project Handlebars helper modules from a config-declared path (dir or single file).
 * Returns registrars — `(env) => void` — invoked by the renderer against its Handlebars env.
 *
 * Two module shapes are accepted: a registrar (`module.exports = (Handlebars) => {…}` / ESM
 * `export default (hb) => {…}`, PatternLab/hTWOo shape) is used directly; a named-function map
 * (`export function foo(){}` / `module.exports = { foo }`) is wrapped into a registrar. CJS and ESM
 * both surface via dynamic import. A module that fails to load is isolated and logged — one bad
 * helper file never sinks the whole set.
 */
export async function loadHelperRegistrars(helpersPath: string): Promise<Array<(hb: unknown) => void>> {
  const { registrars, problems } = await readHelperRegistrars(helpersPath);
  for (const p of problems) console.warn(p.missing ? `[dev-server] helpers path not found: ${p.file}` : `[dev-server] skipped helper module ${p.file}: ${p.message}`);
  return registrars;
}

/** A helper module or data file that did not load, and why: one readable line. */
export interface LoadProblem { file: string; message: string; missing?: boolean }

const require = createRequire(import.meta.url);

/**
 * The helper registrars at a path, and every module that failed to load, as problems rather than
 * warnings. With `bust`, each module is imported afresh (a new query, and its CommonJS cache entry
 * dropped: Node keys CommonJS by file name alone), so an edited helper loads its new code; the modules
 * it imports itself are not reloaded.
 */
export async function readHelperRegistrars(helpersPath: string, opts: { bust?: number } = {}): Promise<{ registrars: Array<(hb: unknown) => void>; files: string[]; problems: LoadProblem[] }> {
  const registrars: Array<(hb: unknown) => void> = [];
  /** The file each registrar came from, by index. */
  const sources: string[] = [];
  const problems: LoadProblem[] = [];
  let files: string[] = [];
  try {
    const st = await stat(helpersPath);
    if (st.isDirectory()) {
      const entries = await readdir(helpersPath, { withFileTypes: true });
      files = entries
        .filter(e => e.isFile() && /\.(c?js|mjs)$/.test(e.name) && !e.name.startsWith("."))
        .map(e => join(helpersPath, e.name))
        .sort();
    } else {
      files = [helpersPath];
    }
  } catch {
    problems.push({ file: helpersPath, message: "not found", missing: true });
    return { registrars, files: sources, problems };
  }
  for (const file of files) {
    try {
      let href = pathToFileURL(file).href;
      if (opts.bust !== undefined) {
        delete require.cache[file];
        href += `?pd-reload=${opts.bust}`;
      }
      const mod = await import(href) as Record<string, unknown>;
      const def = (mod["default"] ?? mod) as unknown;
      if (typeof def === "function") {
        registrars.push(def as (hb: unknown) => void);
        sources.push(file);
      } else if (def && typeof def === "object") {
        const named = Object.entries(def as Record<string, unknown>)
          .filter(([, v]) => typeof v === "function") as Array<[string, (...a: unknown[]) => unknown]>;
        if (named.length) {
          sources.push(file);
          registrars.push((hb: unknown) => {
            const h = hb as { registerHelper(n: string, f: (...a: unknown[]) => unknown): void };
            for (const [name, fn] of named) h.registerHelper(name, fn);
          });
        }
      }
    } catch (e) {
      problems.push({ file, message: oneLine(e) });
    }
  }
  return { registrars, files: sources, problems };
}

/** An error as one readable line — never a stack trace for a bad project file. */
function oneLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return (message.split("\n")[0] ?? "").trim() || "unknown error";
}

/**
 * Load global data (config.dataDir, and each pattern package's). Every `*.json` in each dir is
 * deep-merged (sorted per dir for determinism) into one context — the flat PatternLab `_data`
 * model. Dirs merge in order, so a later dir (the project's) overrides an earlier one (a package's).
 * A bad file is skipped with a one-line warning. Loaded once at startup; the renderer merges it
 * beneath component data.
 */
export async function loadGlobalData(dataDirs: string | string[]): Promise<Record<string, unknown>> {
  const { data, problems } = await readGlobalData(dataDirs);
  for (const p of problems) console.warn(p.missing ? `[dev-server] dataDir not found: ${p.file}` : `[dev-server] skipped _data file ${p.file.split(/[\\/]/).pop()}: ${p.message}`);
  return data;
}

/** Global data, and every file that did not load, as problems rather than warnings. */
export async function readGlobalData(dataDirs: string | string[]): Promise<{ data: Record<string, unknown>; problems: LoadProblem[] }> {
  const merged: Record<string, unknown> = {};
  const problems: LoadProblem[] = [];
  for (const dataDir of Array.isArray(dataDirs) ? dataDirs : [dataDirs]) {
    let files: string[] = [];
    try {
      const entries = await readdir(dataDir, { withFileTypes: true });
      files = entries.filter(e => e.isFile() && e.name.endsWith(".json") && !e.name.startsWith("."))
        .map(e => e.name).sort();
    } catch {
      problems.push({ file: dataDir, message: "not found", missing: true });
      continue;
    }
    for (const name of files) {
      try {
        const obj = JSON.parse(await readFile(join(dataDir, name), "utf-8")) as unknown;
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          deepMerge(merged, obj as Record<string, unknown>);
        }
      } catch (e) {
        problems.push({ file: join(dataDir, name), message: e instanceof SyntaxError ? `invalid JSON (${oneLine(e)})` : oneLine(e) });
      }
    }
  }
  return { data: merged, problems };
}
