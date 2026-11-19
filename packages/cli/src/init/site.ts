// `pd init --site <package or folder>`: which style guide a content-only website uses, and how its package.json
// depends on it. A folder is read here (its package.json names the package); an npm name is taken as given, and
// checked once it is installed (run.ts, then core's checkSitePages).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { configFileOf, loadConfig } from "@pattern-dump/core";
import { manifestBlock, manifestOf } from "./manifest.js";

export interface SiteSource {
  /** The style guide's package name. */
  name: string;
  /** Its dependency spec: the range given, `latest` when none was, or `file:<path relative to the site>`. */
  spec: string;
  /** For a folder: where it is. */
  dir?: string;
}

export type SiteResult =
  | { ok: true; site: SiteSource; warnings: string[] }
  | { ok: false; reason: string };

/** An npm package name, scoped or not (lowercase; the characters npm allows). */
const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

/** Whether `input` is written as a path rather than as a package name. */
const pathLike = (input: string): boolean => /^(?:\.{1,2}(?:[\\/]|$)|[\\/]|~|[a-zA-Z]:[\\/])/.test(input);

export async function resolveSitePackage(input: string, cwd: string, target: string): Promise<SiteResult> {
  const given = input.trim();
  const dir = resolve(cwd, given);
  // A folder that holds a package.json is that folder, even when its name could be a package's.
  if (pathLike(given) || existsSync(join(dir, "package.json"))) {
    if (!existsSync(join(dir, "package.json"))) {
      return { ok: false, reason: `${given} has no package.json: --site takes a style guide's npm name, or the folder of one` };
    }
    if (resolve(dir) === resolve(target)) {
      return { ok: false, reason: `${given} is the folder the site would be written to: give the style guide's own folder` };
    }
    let pkg: { name?: unknown; patternDump?: unknown };
    try {
      pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as typeof pkg;
    } catch (e) {
      return { ok: false, reason: `${join(given, "package.json")} is not valid JSON (${e instanceof Error ? e.message : e})` };
    }
    if (typeof pkg.name !== "string" || !NPM_NAME.test(pkg.name)) {
      return { ok: false, reason: `${join(given, "package.json")} has no package name, so the site can't depend on it: give it a "name"` };
    }
    const warnings = pkg.patternDump === undefined ? [await missingManifest(pkg.name, dir, given)] : [];
    const path = relative(target, dir).split(sep).join("/");
    return { ok: true, site: { name: pkg.name, spec: `file:${path}`, dir }, warnings };
  }
  // name@range: the last @ that is not a scope's.
  const at = given.lastIndexOf("@");
  const [name, range] = at > 0 ? [given.slice(0, at), given.slice(at + 1)] : [given, "latest"];
  if (!NPM_NAME.test(name) || range === "") {
    return { ok: false, reason: `"${given}" is neither a folder nor an npm package name (such as @acme/styleguide or @acme/styleguide@1.2.0)` };
  }
  return { ok: true, site: { name, spec: range }, warnings: [] };
}

/** The warning for a style guide without the `patternDump` field: with the block to add, from its own config's folders
 *  (manifest.ts), or, without a config Pattern Dump can read, what the block names. */
async function missingManifest(name: string, dir: string, given: string): Promise<string> {
  const head = `${name} has no "patternDump" field in its package.json yet, so Pattern Dump can't read its patterns, styles `
    + "and themes";
  if (configFileOf(dir) !== undefined) {
    try {
      const block = manifestBlock(manifestOf(await loadConfig(dir)));
      return `${head}. Add this to ${join(given, "package.json")} (the folders of its config):\n${block}`;
    } catch {
      // A config that doesn't load: its folders are unknown, as without one.
    }
  }
  return `${head}: add one naming its folders (see "A content-only website" in the getting started guide)`;
}
