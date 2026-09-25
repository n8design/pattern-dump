// Runtime validation of a loaded config. The types above only check a .ts config in the author's
// editor: a .json config is never type-checked, and a .ts one is transpiled without a type check.
// Without this, a typo (`"style"` for `"styles"`) surfaces as "Cannot read properties of
// undefined" from whichever reader touches the key first.

import type { PatternDumpConfig } from "./index.js";

type Rule =
  | "string" | "strings" | "string-or-strings" | "boolean"
  | { values: readonly string[]; unsupported?: readonly string[] }
  | { keys: Shape; required?: readonly string[] }
  | "packages" | "logo";
type Shape = Readonly<Record<string, Rule>>;

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
    required: ["dir", "default"],
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
};

const REQUIRED = ["sourceDir", "patternsDir", "outDir", "styles"] as const;

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

function suggest(key: string, known: string[]): string | undefined {
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

/** The problems with a loaded config, one line each; empty when it is valid. */
export function configProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ["the config must be an object (a .ts config must `export default defineConfig({ … })`)"];
  const problems: string[] = [];
  checkObject(raw, SHAPE, REQUIRED, "", problems);
  return problems;
}

/** Check a loaded config and return it typed, or throw one error listing every problem. */
export function validateConfig(raw: unknown, source: string): PatternDumpConfig {
  const problems = configProblems(raw);
  if (problems.length > 0) {
    throw new ConfigError(`${source}: invalid config\n${problems.map(p => `  - ${p}`).join("\n")}`);
  }
  return raw as PatternDumpConfig;
}
