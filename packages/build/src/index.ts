// @pattern-dump/build
// SCSS compilation + the SCSS dependency tracker + script compilation — the in-tree build core the
// dev server drives. File watching lives in dev-server (watch.ts), which owns what a change means.
import * as sass from "sass";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import { build as esbuildBuild } from "esbuild";
import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

// ---- SCSS compilation utilities ----

const packageOptionsCache = new Map<string, Pick<sass.Options<"sync">, "loadPaths" | "importers">>();

/**
 * Sass options that resolve a package by its bare name, as Node does: `@use '@scope/pkg/path'`
 * through every `node_modules` from the entry's folder upward, and `@use 'pkg:@scope/pkg'` through
 * Sass's Node package importer. Relative loads still resolve first, so existing stylesheets are
 * unaffected. Walking up from the entry means a package's own entry (inside `node_modules`) finds
 * the project's installed packages too.
 */
export function sassPackageOptions(entryFile: string): Pick<sass.Options<"sync">, "loadPaths" | "importers"> {
  const start = dirname(resolve(entryFile));
  let options = packageOptionsCache.get(start);
  if (!options) {
    const loadPaths: string[] = [];
    for (let dir = start; ; dir = dirname(dir)) {
      const modules = join(dir, "node_modules");
      if (existsSync(modules)) loadPaths.push(modules);
      if (dirname(dir) === dir) break;
    }
    options = { loadPaths, importers: [new sass.NodePackageImporter(start)] };
    packageOptionsCache.set(start, options);
  }
  return options;
}

/** Recursively collect non-partial SCSS files under `dir`. */
export async function collectScssFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string) {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (extname(entry.name) === ".scss" && !entry.name.startsWith("_")) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files;
}

/** Compile a single SCSS file; return CSS and the set of file-system paths it loaded. */
async function compileSassFileWithDeps(
  filePath: string
): Promise<{ css: string; deps: string[] }> {
  const result = sass.compile(filePath, sassPackageOptions(filePath));
  const processed = await postcss([autoprefixer]).process(result.css, { from: undefined });
  const deps = result.loadedUrls
    .filter((u) => u.protocol === "file:")
    .map((u) => fileURLToPath(u))
    .filter((p) => resolve(p) !== resolve(filePath));
  return { css: processed.css, deps };
}

/** Compile a single SCSS file to CSS (no dep info needed). */
export async function compileSassFile(filePath: string): Promise<string> {
  const { css } = await compileSassFileWithDeps(filePath);
  return css;
}

// ---- SCSS Dependency Tracker ----
//
// Tracks which non-partial files depend on which partials, enabling targeted
// recompilation when a partial changes — rather than rebuilding everything.
//
// Design: single source of truth for the combined CSS used by the dev-server.
//   1. On creation, compiles all non-partial files in `dirs` and records their
//      dependencies from sass.compile().loadedUrls.
//   2. On `update(changedFile)`:
//      • If changed file is a non-partial (tracked directly): recompile it.
//      • If changed file is a partial: recompile every file that @use'd it.
//      Either way, the combined CSS is updated and returned.
//
// No contract change needed — this is a build-package utility, not a pipeline API.

export interface SassDependencyTracker {
  /** The current combined CSS from all tracked files (same order as initial compilation). */
  readonly css: string;
  /**
   * Recompile CSS for a changed path and return updated combined CSS + which files
   * were actually recompiled. Only files that depend on the changed partial are
   * recompiled; unrelated files are untouched.
   */
  update(changedFile: string): Promise<{
    css: string;
    recompiledFiles: string[];
    /** Files that FAILED to compile on this pass, with a legible message.
     *
     *  A compile failure is deliberately non-fatal here — one broken file must not stop the other
     *  files' CSS reaching the preview. But it was previously only `console.warn`ed, so the caller
     *  could not tell a failure from a no-op and the dev server had nothing to report. The result
     *  now carries them so the watcher can push them to the client. */
    errors: Array<{ file: string; message: string }>;
  }>;
}

export async function createSassDependencyTracker(
  dirs: string[],
  /** Further source files to track, listed rather than found: a style root that compiles only
   *  declared entries contributes those, not every non-partial file under it. */
  files: string[] = [],
): Promise<SassDependencyTracker> {
  // The ordered list of non-partial SCSS source files (order preserved for deterministic CSS output).
  const sourceFiles: string[] = [];
  for (const dir of dirs) {
    sourceFiles.push(...(await collectScssFiles(dir)));
  }
  sourceFiles.push(...files.map(f => resolve(f)));

  // Per-file compiled CSS.
  const perFileCss = new Map<string, string>();

  // Reverse dep map: real path of a dep/partial → Set of non-partial source files that load it. Real,
  // because Sass names a partial by the path it reached it through: through a package's link in
  // node_modules for a `@use` into another package, while the watcher reports the real file.
  const reverseDeps = new Map<string, Set<string>>();
  const real = (p: string): string => { try { return realpathSync(p); } catch { return resolve(p); } };

  function addDeps(sourceFile: string, deps: string[]) {
    for (const dep of deps) {
      const abs = real(dep);
      if (!reverseDeps.has(abs)) reverseDeps.set(abs, new Set());
      reverseDeps.get(abs)!.add(sourceFile);
    }
  }

  function removeDeps(sourceFile: string) {
    for (const dependents of reverseDeps.values()) {
      dependents.delete(sourceFile);
    }
  }

  // Initial compilation.
  for (const file of sourceFiles) {
    try {
      const { css, deps } = await compileSassFileWithDeps(file);
      perFileCss.set(file, css);
      addDeps(file, deps);
    } catch (e) {
      console.warn(`[build] SCSS compile error in ${file}:`, e);
      perFileCss.set(file, "");
    }
  }

  const combineCss = () =>
    sourceFiles.map((f) => perFileCss.get(f) ?? "").join("\n");

  return {
    get css() {
      return combineCss();
    },

    async update(changedFile: string) {
      const abs = resolve(changedFile);
      const filesToRecompile = new Set<string>();

      // If the changed file is a tracked non-partial, recompile it directly.
      if (perFileCss.has(abs)) filesToRecompile.add(abs);

      // Collect all non-partial files that depend on the changed file (handles partials).
      const dependents = reverseDeps.get(real(abs));
      if (dependents) {
        for (const dep of dependents) filesToRecompile.add(dep);
      }

      const recompiledFiles: string[] = [];
      const errors: Array<{ file: string; message: string }> = [];
      for (const file of filesToRecompile) {
        try {
          const { css, deps } = await compileSassFileWithDeps(file);
          perFileCss.set(file, css);
          removeDeps(file);
          addDeps(file, deps);
          recompiledFiles.push(file);
        } catch (e) {
          console.warn(`[build] SCSS compile error in ${file}:`, e);
          // Collected as well as logged. Logging alone meant the failure existed only in the dev
          // server's terminal — the caller saw a successful update with one file quietly missing.
          errors.push({ file, message: e instanceof Error ? e.message : String(e) });
        }
      }

      return { css: combineCss(), recompiledFiles, errors };
    },
  };
}

// ---- Script compilation (for requireScript in dev-server) ----

/**
 * Compile a TypeScript/JavaScript entry point to an ESM browser bundle. esbuild heads each module's code
 * with a comment naming its file, relative to the working directory: from the entry's own folder, so the
 * output reads `// toggle.ts` from any checkout or working directory and names no folder of the machine.
 */
export async function compileScriptFile(entryPoint: string): Promise<string> {
  const result = await esbuildBuild({
    absWorkingDir: dirname(resolve(entryPoint)),
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    sourcemap: false,
  });
  return result.outputFiles[0].text;
}

export {
  SHARP_VERSION, SharpUnavailableError, loadSharp, imageVariantKey, imageVariantKeyFromSourceHash, imageSourceHash,
  imageSize, encodeWebp, createImageCache,
  type SharpModule, type ImageEncoding, type ImageCache,
} from "./images.js";
export { imageInfo, svgSize, type ImageInfo, type RasterFormat } from "./image-info.js";
export { createImageIndexer, type ImageIndex, type ImageIndexEntry, type ImageIndexFile, type ImageIndexer } from "./image-index.js";
