// A project that is also a pattern package (a style guide worked on in its own workbench, and published for sites to
// use) describes its folders once: in its package.json's `patternDump` field. Its config takes each folder it doesn't
// name from there. A folder named in both must be the same in both (written either way: "./patterns" is "patterns");
// different values are a config error naming both places, since the workbench and the sites using the package would
// otherwise read different folders. The manifest's paths are relative to the package's root, which is the project's.

import { ConfigError } from "./validate.js";

/** Where a config value comes from in the manifest, and where it goes in the config. */
interface Field {
  /** Its name in the manifest (`patternDump.<from>`), as a reader writes it. */
  from: string;
  get: (manifest: Record<string, unknown>) => unknown;
  /** Its name in the config, as a reader writes it. */
  to: string;
  read: (config: Record<string, unknown>) => unknown;
  write: (config: Record<string, unknown>, value: unknown) => void;
  /** A path, or a list of paths: compared normalised. */
  paths: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const child = (o: Record<string, unknown>, key: string): Record<string, unknown> => {
  if (!isObject(o[key])) o[key] = {};
  return o[key] as Record<string, unknown>;
};
const at = (o: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), o);

const top = (from: string, to: string, paths = true): Field => ({
  from, get: m => m[from], to, read: c => c[to], write: (c, v) => { c[to] = v; }, paths,
});

const FIELDS: Field[] = [
  top("patterns", "patternsDir"),
  top("data", "dataDir"),
  top("helpers", "helpers"),
  top("scripts", "scriptsDir"),
  top("globalScripts", "globalScripts", false),
  top("exclude", "exclude", false),
  { from: "assets", get: m => m["assets"], to: "assets.dir", read: c => at(c, "assets", "dir"),
    write: (c, v) => { child(c, "assets")["dir"] = v; }, paths: true },
  { from: "styles.dir", get: m => at(m, "styles", "dir"), to: "styles.dir", read: c => at(c, "styles", "dir"),
    write: (c, v) => { child(c, "styles")["dir"] = v; }, paths: true },
  { from: "styles.entry", get: m => at(m, "styles", "entry"), to: "styles.entry", read: c => at(c, "styles", "entry"),
    write: (c, v) => { child(c, "styles")["entry"] = v; }, paths: true },
  { from: "styles.documentBase", get: m => at(m, "styles", "documentBase"), to: "documentBase", read: c => c["documentBase"],
    write: (c, v) => { c["documentBase"] = v; }, paths: true },
  { from: "themes.dir", get: m => at(m, "themes", "dir"), to: "themes.dir", read: c => at(c, "themes", "dir"),
    write: (c, v) => { child(c, "themes")["dir"] = v; }, paths: true },
  { from: "themes.default", get: m => at(m, "themes", "default"), to: "themes.default", read: c => at(c, "themes", "default"),
    write: (c, v) => { child(c, "themes")["default"] = v; }, paths: false },
  { from: "themes.switch", get: m => at(m, "themes", "switch"), to: "themes.switch", read: c => at(c, "themes", "switch"),
    write: (c, v) => { child(c, "themes")["switch"] = v; }, paths: false },
];

/** A path as written, in one form: no leading "./", no trailing "/", no doubled or "." segments. */
function samePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/") || ".";
}
/** A value in one form, to compare: paths normalised, a single path the same as a list of one. */
function comparable(v: unknown, paths: boolean): string {
  const list = Array.isArray(v) ? v : [v];
  return JSON.stringify(paths ? list.map(x => (typeof x === "string" ? samePath(x) : x)) : (Array.isArray(v) ? v : [v]));
}
const shown = (v: unknown): string => JSON.stringify(v);

/**
 * The config with each folder its project's own manifest names and the config doesn't, or the config as it is when
 * there is no manifest. `where` names the two files in the error. A config that sets a field the manifest sets too,
 * to another value, throws a ConfigError listing every such field. The raw config is never changed.
 */
export function withOwnManifest(raw: unknown, manifest: unknown, where: { config: string; manifest: string }): unknown {
  if (!isObject(raw) || !isObject(manifest)) return raw;
  const config = structuredClone(raw);
  const conflicts: string[] = [];
  for (const f of FIELDS) {
    const value = f.get(manifest);
    if (value === undefined) continue;
    const own = f.read(config);
    if (own === undefined) { f.write(config, structuredClone(value)); continue; }
    if (comparable(own, f.paths) !== comparable(value, f.paths)) {
      conflicts.push(`"${f.to}" is ${shown(own)} in ${where.config}, but "patternDump.${f.from}" is ${shown(value)} in ${where.manifest}: `
        + `name it in one of them, or give both the same value`);
    }
  }
  if (conflicts.length) {
    throw new ConfigError(`${where.config}: the config and the project's own package manifest disagree\n${conflicts.map(c => `  - ${c}`).join("\n")}`);
  }
  return config;
}
