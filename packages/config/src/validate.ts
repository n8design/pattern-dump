// Runtime validation of a loaded config. The types above only check a .ts config in the author's
// editor: a .json config is never type-checked, and a .ts one is transpiled without a type check.
// Without this, a typo (`"style"` for `"styles"`) surfaces as "Cannot read properties of
// undefined" from whichever reader touches the key first.

import { relative, resolve, sep } from "node:path";
import { DATE_OPTIONS, SKIPPABLE_CHECKS, type PatternDumpConfig, type PatternDumpConfigInput } from "./index.js";

type Rule =
  | "string" | "strings" | "string-or-strings" | "boolean"
  | { values: readonly string[]; unsupported?: readonly string[] }
  | { keys: Shape; required?: readonly string[] }
  | "packages" | "logo" | "workbench-url" | "site-url" | "lang" | "asset-path" | "color-token" | "host" | "inset" | "plain-object" | "hbs-file"
  | "quality" | "effort" | "date-format" | "categories" | "tags" | "term-pages" | "skip-checks" | "component-id";
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
      symbols: { keys: { currentColor: "color-token" } },
    },
  },
  scriptsDir: "string",
  globalScripts: "strings",
  dataDir: "string",
  helpers: "string",
  documentBase: "strings",
  overviews: "boolean",
  shell: {
    keys: { brand: { keys: { title: "string", logo: "logo", logoAlt: "string", href: "string" } }, start: "string", inset: "inset" },
  },
  packages: "packages",
  exclude: "strings",
  build: { keys: { outDir: "string", basePath: "string", audit: "boolean", skipChecks: "skip-checks", workbench: "boolean", graph: "boolean" } },
  images: IMAGES,
  // The MCP server of pd dev (and pd mcp): the host name it answers on.
  mcp: { keys: { host: "host" } },
  // The website. Written `storefront` before 0.8.0, with `globals` as `site` (legacyKeys reads the old names).
  site: {
    keys: {
      pagesDir: "string", outDir: "string", host: "host", workbenchUrl: "workbench-url", globals: "plain-object",
      url: "site-url", lang: "lang", dates: "date-format", index: "boolean", image: "asset-path", images: IMAGES, head: "hbs-file",
      categories: "categories", tags: "tags", tagPages: "term-pages", categoryPages: "term-pages", search: "boolean",
      llms: "boolean", socialImages: { keys: { component: "component-id" }, required: ["component"] },
      checks: { keys: { classes: { values: ["warning", "error", "off"] }, allowClasses: "strings", allowProperties: "strings" } },
    },
    required: ["pagesDir", "outDir"],
  },
};

// sourceDir, patternsDir and styles are optional (withSourceDefaults): a site whose patterns and styles all come from
// pattern packages names none of them.
const REQUIRED = ["outDir"] as const;

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
      ? `missing required "${at}${key}" (found "${at}${near}": did you mean "${at}${key}"?)`
      : `missing required "${at}${key}"`);
  }
  for (const key of unknown) {
    const near = suggest(key, known);
    if (near && required.includes(near) && value[near] === undefined) continue; // reported above
    problems.push(`unknown key "${at}${key}"${near ? `: did you mean "${at}${near}"?` : ""}`);
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
  if (rule === "skip-checks") {
    if (!isStrings(value) || !(value as string[]).every(v => (SKIPPABLE_CHECKS as readonly string[]).includes(v))) {
      fail(`a list of the checks pd build may skip: ${SKIPPABLE_CHECKS.map(c => `"${c}"`).join(", ")}`);
    }
    return;
  }
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
    if (!ok) fail(`an absolute http(s) URL for a workbench on its own host, such as "https://workbench.example.com/", or a path for one on the site's host, such as "/workbench/"`);
    return;
  }
  if (rule === "site-url") {
    // The site's address: canonical URLs, og:url and the sitemap are this value followed by a page's route. It may
    // have a path (a site published under one, such as a GitHub project page), which is then the site's base path;
    // no query or fragment, since routes are appended to it, and no empty segment in the path.
    let ok = false;
    if (typeof value === "string") {
      try {
        const url = new URL(value);
        ok = /^https?:$/.test(url.protocol) && url.search === "" && url.hash === "" && !/[?#]/.test(value)
          && !/\/\/./.test(url.pathname);
      } catch { ok = false; }
    }
    if (!ok) fail(`the site's absolute http(s) address, with no query or fragment, such as "https://example.com/", or "https://example.github.io/project/" for a site published under a path`);
    return;
  }
  if (rule === "lang") {
    // A BCP 47 tag's shape (language, then optional script, region and variants), as <html lang> takes it.
    if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*$/i.test(value)) {
      fail(`a language tag, such as "en", "de-AT" or "zh-Hant-TW"`);
    }
    return;
  }
  if (rule === "date-format") {
    // Options of Intl.DateTimeFormat for a day. A time or a time zone is refused by name (a page's date is a day,
    // written as the day it is), and so is dateStyle with a part; Intl itself refuses a value it doesn't take.
    if (!isObject(value)) { fail(`an object of Intl.DateTimeFormat options for a day, such as { dateStyle: "long" }`); return; }
    const before = problems.length;
    const timeKeys = Object.keys(value).filter(k => TIME_OPTIONS.includes(k));
    for (const k of timeKeys) {
      problems.push(`"${at}.${k}": a page's date is a day, so site.dates takes no ${k === "timeZone" ? "time zone (the day is written as it is, wherever the site is built)" : "time"}: leave it out`);
    }
    for (const k of Object.keys(value).filter(k => !timeKeys.includes(k) && !(DATE_OPTIONS as readonly string[]).includes(k))) {
      const near = suggest(k, [...DATE_OPTIONS]);
      problems.push(`unknown key "${at}.${k}": site.dates takes ${DATE_OPTIONS.join(", ")}${near ? `: did you mean "${at}.${near}"?` : ""}`);
    }
    const parts = ["weekday", "era", "year", "month", "day"].filter(k => Object.hasOwn(value, k));
    if (value.dateStyle !== undefined && parts.length) {
      problems.push(`"${at}": dateStyle is a whole style, so it can't be set with ${parts.join(", ")}: use dateStyle alone, or the parts alone, such as { day: "numeric", month: "long", year: "numeric" }`);
    }
    if (problems.length > before) return;
    try { new Intl.DateTimeFormat(undefined, value as Intl.DateTimeFormatOptions); } catch (e) {
      problems.push(`"${at}": ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  if (rule === "hbs-file") {
    // A template file of the project's, relative to its root; that it exists is checked when a page is built.
    if (typeof value !== "string" || !/\.hbs$/.test(value) || /^(?:\/|[a-zA-Z]:)/.test(value)) {
      fail(`a Handlebars file relative to the project's root, such as "./head.hbs"`);
    }
    return;
  }
  if (rule === "color-token") {
    // A colour token of the document base layer; that the base layer declares it is checked when a symbol uses it.
    if (typeof value !== "string" || !/^--color-[A-Za-z0-9_-]+$/.test(value)) fail(`a colour token's name, such as "--color-text"`);
    return;
  }
  if (rule === "component-id") {
    // A component's id, as the workbench names it: folders and its name, no variant; that it exists is checked when
    // the site's pages are checked.
    if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) || /(?:^|\/)\.\.?(?:\/|$)/.test(value)) {
      fail(`a component's id, such as "components/social-image"`);
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
  if (rule === "inset") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 8) fail("a number of rem from 0 to 8, such as 1 (0 for none)");
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
  if (rule === "categories" || rule === "tags") {
    checkTerms(value, at, problems, rule === "tags" ? TAG_WORDS : CATEGORY_WORDS);
    return;
  }
  if (rule === "term-pages") {
    if (typeof value === "boolean") return;
    if (!isObject(value)) { fail(`true, false, or { path, title }, such as { path: "topics" }`); return; }
    if (typeof value.path === "string" && !SEGMENT.test(value.path)) {
      problems.push(`"${at}.path": the pages' first URL segment, so lowercase letters, digits and hyphens only, such as "topics"`);
    }
    checkObject(value, TERM_PAGES, [], `${at}.`, problems);
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
      problems.push(`"${at}": "${value}" is not supported yet: use ${rule.values.map(v => `"${v}"`).join(" or ")}, or leave it out`);
    } else if (typeof value !== "string" || !rule.values.includes(value)) {
      fail(rule.values.map(v => `"${v}"`).join(" or "));
    }
    return;
  }
  if (!isObject(value)) { fail("an object"); return; }
  checkObject(value, rule.keys, rule.required ?? [], `${at}.`, problems);
}

/** Options of Intl.DateTimeFormat that write a time or pick a time zone: site.dates refuses them by name. */
const TIME_OPTIONS: readonly string[] = ["timeZone", "timeStyle", "hour", "minute", "second", "dayPeriod",
  "fractionalSecondDigits", "hour12", "hourCycle", "timeZoneName"];

/** A category's or tag's key, and each old key of one: a URL segment (each gets a page of its own). */
const SEGMENT = /^[a-z0-9-]+$/;
const TERM: Shape = { label: "string", description: "string", aliases: "strings" };
/** storefront.tagPages and storefront.categoryPages as an object. */
const TERM_PAGES: Shape = { path: "string", title: "string" };

/** How the messages name a kind of term. */
interface TermWords { one: string; example: string }
const CATEGORY_WORDS: TermWords = { one: "category", example: `{ guides: { label: "Guides" } }` };
const TAG_WORDS: TermWords = { one: "tag", example: `{ css: { label: "CSS" } }` };

/**
 * storefront.categories and storefront.tags: `{ <key>: { label, description?, aliases? } }`. An alias is an old key:
 * pages that still name it build, resolved to the term (with a note), and its old page forwards to the new one. So an
 * alias is never a key of its own, and one alias leads to one term.
 */
function checkTerms(value: unknown, at: string, problems: string[], w: TermWords): void {
  const plural = w.one === "category" ? "categories" : `${w.one}s`;
  if (!isObject(value)) {
    problems.push(`"${at}" must be an object of ${plural} by key, such as ${w.example}`);
    return;
  }
  const claimed = new Map<string, string>();
  for (const [key, category] of Object.entries(value)) {
    if (!SEGMENT.test(key)) {
      problems.push(`"${at}.${key}": a ${w.one}'s key is part of a URL, so it is lowercase letters, digits and hyphens only`);
      continue;
    }
    if (!isObject(category)) { problems.push(`"${at}.${key}" must be an object, such as { label: "${w.one === "tag" ? "CSS" : "Guides"}" }`); continue; }
    checkObject(category, TERM, ["label"], `${at}.${key}.`, problems);
    if (!isStrings(category.aliases)) continue;
    for (const alias of category.aliases as string[]) {
      if (!SEGMENT.test(alias)) {
        problems.push(`"${at}.${key}.aliases": "${alias}" is not a key: an old key is lowercase letters, digits and hyphens, as a key is`);
      } else if (Object.hasOwn(value, alias)) {
        problems.push(`"${at}.${key}.aliases": "${alias}" is a ${w.one} of its own, so it can't be an old key of "${key}"`);
      } else if (claimed.has(alias)) {
        problems.push(`"${at}.${key}.aliases": "${alias}" is an old key of "${claimed.get(alias)}" already: one old key leads to one ${w.one}`);
      } else claimed.set(alias, key);
    }
  }
}

/** A config that cannot be used, with a message written for the person editing it. The CLI prints
 *  its message alone, without a stack trace. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Checks across keys, run once every key has the right type. */
/** The host names pd dev answers to of its own: the MCP host must be none of them, nor the site's. */
const RESERVED_HOSTS = ["localhost", "127.0.0.1", "pd.localhost"];

function checkRelations(raw: Record<string, unknown>, problems: string[]): void {
  const sf = raw.site;
  // The MCP host: a name of its own, so its requests are told apart from the workbench's and the site's.
  const mcpHost = isObject(raw.mcp) && typeof raw.mcp.host === "string" ? raw.mcp.host.toLowerCase() : undefined;
  if (mcpHost !== undefined) {
    const siteHost = isObject(sf) && typeof sf.host === "string" ? sf.host.toLowerCase() : isObject(sf) ? "live.localhost" : undefined;
    if (RESERVED_HOSTS.includes(mcpHost)) problems.push(`"mcp.host": "${mcpHost}" is the workbench's: give the MCP server a name of its own, such as "mcp.localhost"`);
    else if (mcpHost === siteHost) problems.push(`"mcp.host": "${mcpHost}" is the site's host as well: give the MCP server a name of its own, such as "mcp.localhost"`);
  }
  if (!isObject(sf)) return;
  // site.workbenchUrl reaches templates as site.workbenchUrl: a global of that name would be silently replaced.
  if (isObject(sf.globals) && Object.hasOwn(sf.globals, "workbenchUrl")) {
    problems.push(`"site.globals.workbenchUrl": templates get site.workbenchUrl from Pattern Dump (site.workbenchUrl, or pd dev's own workbench): remove this global and use site.workbenchUrl`);
  }
  // Tag pages and category pages each under a path of their own (when both are on).
  const pathOf = (v: unknown, fallback: string): string | undefined =>
    v === false ? undefined : isObject(v) && typeof v.path === "string" ? v.path : fallback;
  const tagPath = pathOf(sf.tagPages, "tags"), categoryPath = pathOf(sf.categoryPages, "categories");
  if (tagPath !== undefined && tagPath === categoryPath) {
    problems.push(`"site.tagPages.path" and "site.categoryPages.path" are both "${tagPath}": tag pages and category pages need a path each`);
  }
  // Three folders that must not share files, so they are pairwise disjoint: not the same folder, and
  // neither inside the other. Pages are markdown that is not component docs (under patternsDir the
  // watcher could not tell which an edit belongs to, and the reverse puts component docs among the
  // pages); the storefront output is emptied and written by `pd build`, so it must hold neither.
  const folders: Array<[name: string, value: unknown]> = [
    ["site.pagesDir", sf.pagesDir],
    ["patternsDir", raw.patternsDir],
    ["site.outDir", sf.outDir],
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
      if (pa === pb) problems.push(`${label(a, va)} and ${label(b, vb)} are the same folder: each needs a folder of its own`);
      else if (inside(pa, pb)) problems.push(`${label(a, va)} is inside ${label(b, vb)}: each needs a folder of its own, outside the other`);
      else if (inside(pb, pa)) problems.push(`${label(b, vb)} is inside ${label(a, va)}: each needs a folder of its own, outside the other`);
    }
  }
}

/**
 * The config with the website under its own name, `site`, whichever name it was written with: before 0.8.0 it was
 * `storefront`, and its `site` (the values every page shares) is now `site.globals`. The old names still load, each
 * old key with a warning; both names at once is a problem. Nothing else is changed.
 */
export function legacyKeys(raw: Record<string, unknown>): { raw: Record<string, unknown>; warnings: string[]; problems: string[] } {
  if (raw["storefront"] === undefined) return { raw, warnings: [], problems: [] };
  if (raw["site"] !== undefined) {
    return { raw, warnings: [], problems: ["both \"site\" and \"storefront\" are set: storefront is the old name of site, keep site only"] };
  }
  const { storefront, ...rest } = raw;
  if (!isObject(storefront)) return { raw: { ...rest, site: storefront }, warnings: ["storefront is now site"], problems: [] };
  const warnings = Object.keys(storefront).map(k => k === "site" ? "storefront.site is now site.globals" : `storefront.${k} is now site.${k}`);
  if (Object.hasOwn(storefront, "globals")) {
    return { raw, warnings, problems: ["\"storefront.globals\" is not a key of the old storefront: write the website under site, and its globals there"] };
  }
  const { site: globals, ...keys } = storefront;
  return { raw: { ...rest, site: { ...keys, ...(globals !== undefined ? { globals } : {}) } }, warnings: warnings.length ? warnings : ["storefront is now site"], problems: [] };
}

/** The warnings a loaded config gives: each key written with its old name (legacyKeys). */
export function configWarnings(raw: unknown): string[] {
  return isObject(raw) ? legacyKeys(raw).warnings : [];
}

/** The problems with a loaded config, one line each; empty when it is valid. */
export function configProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ["the config must be an object (a .ts config must `export default defineConfig({ … })`)"];
  const legacy = legacyKeys(raw);
  if (legacy.problems.length) return legacy.problems;
  const problems: string[] = [];
  checkObject(legacy.raw, SHAPE, REQUIRED, "", problems);
  if (problems.length === 0) checkRelations(legacy.raw, problems);
  return problems;
}

/** The website as the code reads it: `storefront`, with the values every page shares as `site` (its name before
 *  0.8.0, kept inside Pattern Dump until its own names change). */
function internalShape(raw: Record<string, unknown>): Record<string, unknown> {
  // Written with the old name, or with no website: already the shape the code reads, returned as it is.
  if (raw["site"] === undefined) return raw;
  const { site, ...rest } = raw;
  if (!isObject(site)) return rest;
  const { globals, ...keys } = site;
  return { ...rest, storefront: { ...keys, ...(globals !== undefined ? { site: globals } : {}) } };
}

/** A URL that other paths are appended to: exactly one trailing slash. */
const withOneTrailingSlash = (url: string): string => `${url.replace(/\/+$/, "")}/`;

/** Check a loaded config and return it typed, or throw one error listing every problem. */
/**
 * A config with its source folders filled in where it names none: `sourceDir` is "./src", and `patternsDir` and
 * `styles.dir` are its `patterns` and `styles` folders. None of them has to exist: a site whose patterns and styles
 * all come from pattern packages has none of its own. What the config names is kept as it is.
 */
export function withSourceDefaults(config: PatternDumpConfigInput): PatternDumpConfig {
  if (config.sourceDir !== undefined && config.patternsDir !== undefined && config.styles !== undefined) return config as PatternDumpConfig;
  const sourceDir = config.sourceDir ?? "./src";
  const base = sourceDir.replace(/\/+$/, "");
  return {
    ...config, sourceDir,
    patternsDir: config.patternsDir ?? `${base}/patterns`,
    styles: config.styles ?? { strategy: "parallel", dir: `${base}/styles` },
  };
}

export function validateConfig(raw: unknown, source: string): PatternDumpConfig {
  const problems = configProblems(raw);
  if (problems.length > 0) {
    throw new ConfigError(`${source}: invalid config\n${problems.map(p => `  - ${p}`).join("\n")}`);
  }
  const config = withSourceDefaults(internalShape(raw as Record<string, unknown>) as PatternDumpConfigInput);
  // Normalized here, once, so every reader gets the same form: links are `<workbenchUrl><path>`.
  // The input is never changed: a config that needs no normalizing is returned as it is, one that does
  // is returned as a copy.
  const sf = config.storefront;
  if (!sf) return config;
  const workbenchUrl = sf.workbenchUrl !== undefined ? withOneTrailingSlash(sf.workbenchUrl) : undefined;
  // The site URL's one form is its origin and path with one trailing slash: "https://example.com" →
  // "https://example.com/", "https://example.github.io/project" → "https://example.github.io/project/".
  const url = sf.url !== undefined ? siteUrlForm(sf.url) : undefined;
  if (workbenchUrl === sf.workbenchUrl && url === sf.url) return config;
  return { ...config, storefront: {
    ...sf, ...(workbenchUrl !== undefined ? { workbenchUrl } : {}), ...(url !== undefined ? { url } : {}),
  } };
}

/** A site URL in its one form: origin, then the path with exactly one trailing slash. */
function siteUrlForm(value: string): string {
  const u = new URL(value);
  return `${u.origin}${withOneTrailingSlash(u.pathname)}`;
}

/**
 * The storefront's base path: the path of `storefront.url` ("/" at the root of a host, "/project/" under a path), or
 * "/" for a site with no address. Reads a validated config, so the URL is already in its one form.
 */
export function storefrontBasePath(storefront: { url?: string } | undefined): string {
  return storefront?.url === undefined ? "/" : new URL(storefront.url).pathname;
}

/**
 * The path of a workbench published on the storefront's own host, or undefined when it has a host of its own.
 * Same-host means a root-relative `workbenchUrl` ("/workbench/"), or an absolute one on the origin of
 * `storefront.url` (whatever the site's own path). The path is the workbench's full path on the host. Reads a validated config, so both are already normalised (one trailing slash).
 */
export function sameHostWorkbenchPath(storefront: { workbenchUrl?: string; url?: string } | undefined): string | undefined {
  const w = storefront?.workbenchUrl;
  if (w === undefined) return undefined;
  if (w.startsWith("/")) return w;
  if (storefront?.url === undefined) return undefined;
  const u = new URL(w);
  return u.origin === new URL(storefront.url).origin ? u.pathname : undefined;
}
