// Runtime validation of a loaded config. The types above only check a .ts config in the author's
// editor: a .json config is never type-checked, and a .ts one is transpiled without a type check.
// Without this, a typo (`"style"` for `"styles"`) surfaces as "Cannot read properties of
// undefined" from whichever reader touches the key first.

import { relative, resolve, sep } from "node:path";
import type { PatternDumpConfig } from "./index.js";

type Rule =
  | "string" | "strings" | "string-or-strings" | "boolean"
  | { values: readonly string[]; unsupported?: readonly string[] }
  | { keys: Shape; required?: readonly string[] }
  | "packages" | "logo" | "workbench-url" | "site-url" | "lang" | "asset-path" | "host" | "plain-object"
  | "quality" | "effort";
type Shape = Readonly<Record<string, Rule>>;

/** How responsive image variants are encoded: for the project, and overridden per site. */
const IMAGES: Rule = { keys: { quality: "quality", effort: "effort" } };

const SHAPE: Shape = {
  $schema: "string",
  sourceDir: "string",
  patternsDir: "string",
  outDir: "string",
  styles: {
    keys: {
      strategy: { values: ["parallel"], unsupported: ["co-located"] },
      dir: "string",
      entry: "string-or-strings",
    },
    required: ["dir"],
  },
  themes: {
    keys: {
      dir: "string",
      default: "string",
      switch: { values: ["attribute", "stylesheet"] },
      swatch: { keys: { slots: "strings" }, required: ["slots"] },
    },
    required: ["default"],
  },
  assets: {
    keys: {
      strategy: { values: ["central"], unsupported: ["component-relative"] },
      dir: "string-or-strings",
      css: "strings",
    },
  },
  scriptsDir: "string",
  globalScripts: "strings",
  dataDir: "string",
  helpers: "string",
  documentBase: "strings",
  overviews: "boolean",
  shell: {
    keys: { brand: { keys: { title: "string", logo: "logo", logoAlt: "string", href: "string" } } },
  },
  packages: "packages",
  exclude: "strings",
  build: { keys: { outDir: "string", basePath: "string", audit: "boolean" } },
  images: IMAGES,
  storefront: {
    keys: {
      pagesDir: "string", outDir: "string", host: "host", workbenchUrl: "workbench-url", site: "plain-object",
      url: "site-url", lang: "lang", index: "boolean", image: "asset-path", images: IMAGES,
    },
    required: ["pagesDir", "outDir"],
  },
};

const REQUIRED = ["sourceDir", "patternsDir", "outDir", "styles"] as const;

/** A root-relative path of plain segments: "/workbench/", "/docs/workbench". Never "//…" (another host), and
 *  no "." or ".." segment (the path a browser resolves would not be the one written). */
const WORKBENCH_PATH = /^\/(?:(?!\.{1,2}(?:\/|$))[a-z0-9._~-]+\/?)+$/i;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === "string");

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The closest of `known` to `key` when it is near enough to be a typo of it, else undefined. Used for
 *  "did you mean" in config problems, and by other checks that name an unknown key. */
export function suggest(key: string, known: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of known) {
    const d = distance(key, k);
    if (d < bestD) { best = k; bestD = d; }
  }
  if (best === undefined) return undefined;
  // Close enough to be a typo: two edits, or three when the start matches (entries → entry).
  const sameStart = key.slice(0, 3).toLowerCase() === best.slice(0, 3).toLowerCase();
  return bestD <= 2 || (bestD <= 3 && sameStart) ? best : undefined;
}

function checkObject(value: Record<string, unknown>, shape: Shape, required: readonly string[], at: string, problems: string[]): void {
  const known = Object.keys(shape);
  const unknown = Object.keys(value).filter(k => !(k in shape));
  for (const key of required) {
    if (value[key] !== undefined) continue;
    const near = unknown.find(u => suggest(u, [key]) === key);
    problems.push(near
      ? `missing required "${at}${key}" (found "${at}${near}" — did you mean "${at}${key}"?)`
      : `missing required "${at}${key}"`);
  }
  for (const key of unknown) {
    const near = suggest(key, known);
    if (near && required.includes(near) && value[near] === undefined) continue; // reported above
    problems.push(`unknown key "${at}${key}"${near ? ` — did you mean "${at}${near}"?` : ""}`);
  }
  for (const key of known) {
    if (value[key] !== undefined) checkValue(value[key], shape[key], `${at}${key}`, problems);
  }
}

function checkValue(value: unknown, rule: Rule, at: string, problems: string[]): void {
  const fail = (expected: string) => problems.push(`"${at}" must be ${expected}`);
  if (rule === "string") { if (typeof value !== "string") fail("a string"); return; }
  if (rule === "boolean") { if (typeof value !== "boolean") fail("true or false"); return; }
  if (rule === "strings") { if (!isStrings(value)) fail("a list of strings"); return; }
  if (rule === "string-or-strings") {
    if (typeof value !== "string" && !isStrings(value)) fail("a string or a list of strings");
    return;
  }
  if (rule === "packages") {
    const ok = Array.isArray(value) && value.every(p =>
      typeof p === "string" || (isObject(p) && typeof p.name === "string"
        && (p.exclude === undefined || isStrings(p.exclude))
        && (p.styles === undefined || typeof p.styles === "boolean")));
    if (!ok) fail(`a list of package names or { name, exclude, styles } objects`);
    return;
  }
  if (rule === "logo") {
    const ok = typeof value === "string" ||
      (isObject(value) && typeof value.light === "string" && typeof value.dark === "string");
    if (!ok) fail(`a path or { light, dark }`);
    return;
  }
  if (rule === "workbench-url") {
    // Written into every link a static build makes to the workbench: a full address for a workbench on a
    // host of its own, or a path for one on the storefront's own host. Links are built by appending a path
    // to it, so it carries no query or fragment. "//host/" is refused: a browser reads it as another host.
    let ok = false;
    if (typeof value === "string" && WORKBENCH_PATH.test(value)) ok = true;
    else if (typeof value === "string") {
      try {
        const url = new URL(value);
        ok = /^https?:$/.test(url.protocol) && url.search === "" && url.hash === "" && !/[?#]/.test(value);
      } catch { ok = false; }
    }
    if (!ok) fail(`an absolute http(s) URL for a workbench on its own host, such as "https://workbench.example.com/", or a path for one on the storefront's host, such as "/workbench/"`);
    return;
  }
  if (rule === "site-url") {
    // The storefront is served from the root of its host: canonical URLs, og:url and the sitemap are this
    // value followed by a page's route, so it is an origin, with no path, query or fragment.
    let ok = false;
    if (typeof value === "string") {
      try {
        const url = new URL(value);
        ok = /^https?:$/.test(url.protocol) && url.pathname === "/" && url.search === "" && url.hash === "" && !/[?#]/.test(value);
      } catch { ok = false; }
    }
    if (!ok) fail(`the site's absolute http(s) address, with no path, query or fragment, such as "https://example.com/"`);
    return;
  }
  if (rule === "lang") {
    // A BCP 47 tag's shape (language, then optional script, region and variants), as <html lang> takes it.
    if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*$/i.test(value)) {
      fail(`a language tag, such as "en", "de-AT" or "zh-Hant-TW"`);
    }
    return;
  }
  if (rule === "asset-path") {
    // A file the site serves from its assets; that it exists, and its format, are checked by the storefront.
    if (typeof value !== "string" || !/^\/assets\/[^?#]+[^/?#]$/.test(value)) {
      fail(`a path to a file in the assets, such as "/assets/images/share.png"`);
    }
    return;
  }
  if (rule === "quality") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) fail("a whole number from 1 to 100 (WebP quality)");
    return;
  }
  if (rule === "effort") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) fail("a whole number from 0 to 6 (WebP effort: 0 fastest, 6 smallest)");
    return;
  }
  if (rule === "plain-object") {
    // Its keys are checked where the patterns are known: against what the site's layouts declare.
    if (!isObject(value)) fail(`an object of the site's values, such as { title: "My site" }`);
    return;
  }
  if (rule === "host") {
    // Compared with the request's Host header, so a bare name: no scheme, port or path.
    if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(value)) {
      fail(`a host name with no scheme, port or path, such as "live.localhost"`);
    }
    return;
  }
  if ("values" in rule) {
    if (typeof value === "string" && rule.unsupported?.includes(value)) {
      problems.push(`"${at}": "${value}" is not supported yet — use ${rule.values.map(v => `"${v}"`).join(" or ")}, or leave it out`);
    } else if (typeof value !== "string" || !rule.values.includes(value)) {
      fail(rule.values.map(v => `"${v}"`).join(" or "));
    }
    return;
  }
  if (!isObject(value)) { fail("an object"); return; }
  checkObject(value, rule.keys, rule.required ?? [], `${at}.`, problems);
}

/** A config that cannot be used, with a message written for the person editing it. The CLI prints
 *  its message alone, without a stack trace. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Checks across keys, run once every key has the right type. */
function checkRelations(raw: Record<string, unknown>, problems: string[]): void {
  const sf = raw.storefront;
  if (!isObject(sf)) return;
  // Three folders that must not share files, so they are pairwise disjoint: not the same folder, and
  // neither inside the other. Pages are markdown that is not component docs (under patternsDir the
  // watcher could not tell which an edit belongs to, and the reverse puts component docs among the
  // pages); the storefront output is emptied and written by `pd build`, so it must hold neither.
  const folders: Array<[name: string, value: unknown]> = [
    ["storefront.pagesDir", sf.pagesDir],
    ["patternsDir", raw.patternsDir],
    ["storefront.outDir", sf.outDir],
  ];
  // All are relative to the project root, so they are compared resolved against the same (any) root.
  const root = resolve(sep, "pd-root");
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel);
  };
  for (let i = 0; i < folders.length; i++) {
    for (let j = i + 1; j < folders.length; j++) {
      const [a, va] = folders[i], [b, vb] = folders[j];
      if (typeof va !== "string" || typeof vb !== "string") continue;
      const pa = resolve(root, va), pb = resolve(root, vb);
      const label = (name: string, value: string) => `"${name}" ("${value}")`;
      if (pa === pb) problems.push(`${label(a, va)} and ${label(b, vb)} are the same folder — each needs a folder of its own`);
      else if (inside(pa, pb)) problems.push(`${label(a, va)} is inside ${label(b, vb)} — each needs a folder of its own, outside the other`);
      else if (inside(pb, pa)) problems.push(`${label(b, vb)} is inside ${label(a, va)} — each needs a folder of its own, outside the other`);
    }
  }
}

/** The problems with a loaded config, one line each; empty when it is valid. */
export function configProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ["the config must be an object (a .ts config must `export default defineConfig({ … })`)"];
  const problems: string[] = [];
  checkObject(raw, SHAPE, REQUIRED, "", problems);
  if (problems.length === 0) checkRelations(raw, problems);
  return problems;
}

/** A URL that other paths are appended to: exactly one trailing slash. */
const withOneTrailingSlash = (url: string): string => `${url.replace(/\/+$/, "")}/`;

/** Check a loaded config and return it typed, or throw one error listing every problem. */
export function validateConfig(raw: unknown, source: string): PatternDumpConfig {
  const problems = configProblems(raw);
  if (problems.length > 0) {
    throw new ConfigError(`${source}: invalid config\n${problems.map(p => `  - ${p}`).join("\n")}`);
  }
  const config = raw as PatternDumpConfig;
  // Normalized here, once, so every reader gets the same form: links are `<workbenchUrl><path>`.
  // The input is never changed: a config that needs no normalizing is returned as it is, one that does
  // is returned as a copy.
  const sf = config.storefront;
  if (!sf) return config;
  const workbenchUrl = sf.workbenchUrl !== undefined ? withOneTrailingSlash(sf.workbenchUrl) : undefined;
  // The site URL has no path, so its one form is the origin with "/": "https://example.com" → "https://example.com/".
  const url = sf.url !== undefined ? `${new URL(sf.url).origin}/` : undefined;
  if (workbenchUrl === sf.workbenchUrl && url === sf.url) return config;
  return { ...config, storefront: {
    ...sf, ...(workbenchUrl !== undefined ? { workbenchUrl } : {}), ...(url !== undefined ? { url } : {}),
  } };
}

/**
 * The path of a workbench published on the storefront's own host, or undefined when it has a host of its own.
 * Same-host means a root-relative `workbenchUrl` ("/workbench/"), or an absolute one on the origin of
 * `storefront.url`. Reads a validated config, so both are already normalised (one trailing slash).
 */
export function sameHostWorkbenchPath(storefront: { workbenchUrl?: string; url?: string } | undefined): string | undefined {
  const w = storefront?.workbenchUrl;
  if (w === undefined) return undefined;
  if (w.startsWith("/")) return w;
  if (storefront?.url === undefined) return undefined;
  const u = new URL(w);
  return `${u.origin}/` === storefront.url ? u.pathname : undefined;
}
