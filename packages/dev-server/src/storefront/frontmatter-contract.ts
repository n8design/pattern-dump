// A storefront page's frontmatter, checked against the layout it uses.
//
// Two keys belong to the build, not to a layout: `layout` (which layout; `page` when absent) and `order`
// (where in the nav). Every other key must be declared by the chosen layout's schema — the
// `<stem>.schema.json` beside `layouts/<name>/<name>.hbs` — and is coerced to the type the schema
// declares. Nothing is inferred: a key the schema does not declare is an error, and a layout with no
// schema declares nothing. Two more keys are filled by the storefront itself (`body`, the rendered
// markdown, and `nav`); a page cannot set them, and a layout requiring them is satisfied.
//
// Every problem is returned, each with the line it is on when it has one, and every problem is fatal to
// the caller (D7). The frontmatter's own grammar errors (readFrontmatterStrict) come first.

import { readFile } from "node:fs/promises";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import type { FrontmatterValue } from "../frontmatter.js";
import { DEFAULT_LAYOUT, type PageFile } from "./pages.js";

/** Keys the build owns: they are read by the storefront, never passed to the layout. */
export const RESERVED_KEYS = ["layout", "order"] as const;
/** Keys the storefront fills for every page: a page cannot set them. */
export const ASSEMBLY_KEYS = ["body", "nav"] as const;

export interface PageProblem {
  /** The page file, relative to the pages folder. */
  file: string;
  /** 1-based line, when the problem is on one. */
  line?: number;
  message: string;
}

export interface CheckedPage {
  /** The layout component, e.g. "layouts/article". Set even when it does not exist. */
  layoutId: string;
  /** The frontmatter for the layout: declared keys only, coerced to their declared types. */
  values: Record<string, unknown>;
  problems: PageProblem[];
}

type JsonType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
interface PropertySchema { type?: JsonType | JsonType[]; enum?: unknown[]; items?: PropertySchema }
interface LayoutSchema { required?: string[]; properties?: Record<string, PropertySchema> }

const NUMERIC = /^-?\d+(\.\d+)?$/;
const quote = (v: FrontmatterValue): string => Array.isArray(v) ? `[${v.join(", ")}]` : `"${v}"`;

/** A frontmatter value as `type`, or an error message. */
function coerceTo(type: JsonType, value: FrontmatterValue, items: PropertySchema | undefined): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (type) {
    case "string":
      return typeof value === "string" ? { ok: true, value } : { ok: false, message: "must be text, not a list" };
    case "number":
      return typeof value === "string" && NUMERIC.test(value) ? { ok: true, value: Number(value) } : { ok: false, message: `must be a number (got ${quote(value)})` };
    case "integer":
      return typeof value === "string" && /^-?\d+$/.test(value) ? { ok: true, value: Number(value) } : { ok: false, message: `must be a whole number (got ${quote(value)})` };
    case "boolean":
      return value === "true" || value === "false" ? { ok: true, value: value === "true" } : { ok: false, message: `must be true or false (got ${quote(value)})` };
    case "array": {
      if (!Array.isArray(value)) return { ok: false, message: `must be a list (got ${quote(value)})` };
      const itemType = items?.type;
      if (itemType === undefined) return { ok: true, value };
      const out: unknown[] = [];
      for (const item of value) {
        const r = coerce({ type: itemType, ...(items?.enum ? { enum: items.enum } : {}) }, item);
        if (!r.ok) return { ok: false, message: `has an item that ${r.message}` };
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, message: `has a type (${type}) a page cannot set in frontmatter` };
  }
}

/** A value as the property declares it: its type (or the first of its types that fits), then its enum. */
function coerce(prop: PropertySchema, value: FrontmatterValue): { ok: true; value: unknown } | { ok: false; message: string } {
  let result: { ok: true; value: unknown } | { ok: false; message: string } = { ok: true, value };
  if (prop.type !== undefined) {
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    const tries = types.map(t => coerceTo(t, value, prop.items));
    result = tries.find(r => r.ok) ?? tries[0];
  }
  if (result.ok && Array.isArray(prop.enum) && !prop.enum.some(e => e === result.value)) {
    return { ok: false, message: `must be one of ${prop.enum.map(e => JSON.stringify(e)).join(", ")} (got ${quote(value)})` };
  }
  return result;
}

/** The layouts a page can choose: base components directly under layouts/. */
export function layoutNames(discoveryMap: DiscoveryMap): string[] {
  return [...discoveryMap.keys()]
    .filter(id => /^layouts\/[^/~]+$/.test(id))
    .map(id => id.slice("layouts/".length))
    .sort();
}

export async function checkPageFrontmatter(page: PageFile, discoveryMap: DiscoveryMap): Promise<CheckedPage> {
  const { values, errors, lines } = page.frontmatter;
  const problems: PageProblem[] = errors.map(e => ({ file: page.path, line: e.line, message: e.message }));
  const at = (key: string, message: string): void => {
    problems.push({ file: page.path, ...(lines[key] !== undefined ? { line: lines[key] } : {}), message });
  };

  // ---- layout ----
  const rawLayout = values["layout"];
  let layout = DEFAULT_LAYOUT;
  if (Array.isArray(rawLayout)) at("layout", "layout must be one layout name, not a list");
  else if (rawLayout !== undefined) layout = rawLayout;
  const layoutId = `layouts/${layout}`;
  const known = layoutNames(discoveryMap);
  const entry = /^[^/~]+$/.test(layout) ? discoveryMap.get(layoutId) : undefined;
  if (!entry || Array.isArray(rawLayout)) {
    if (!Array.isArray(rawLayout)) {
      at("layout", known.length
        ? `layout "${layout}" is not a layout — the layouts are ${known.map(n => `"${n}"`).join(", ")}`
        : `layout "${layout}" is not a layout — the project has no layouts (components in a layouts/ folder of its patterns)`);
    }
    return { layoutId, values: {}, problems };
  }

  // ---- the layout's schema: what a page may set ----
  let schema: LayoutSchema = {};
  let hasSchema = false;
  if (entry.schemaPath) {
    try {
      schema = JSON.parse(await readFile(entry.schemaPath, "utf8")) as LayoutSchema;
      hasSchema = true;
    } catch (e) {
      problems.push({ file: page.path, message: `the schema of layout "${layout}" cannot be read: ${e instanceof Error ? e.message : String(e)}` });
      return { layoutId, values: {}, problems };
    }
  }
  const declared = schema.properties ?? {};

  // ---- every key the page sets ----
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if ((RESERVED_KEYS as readonly string[]).includes(key)) continue;
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) { at(key, `"${key}" is filled by the storefront, not by a page`); continue; }
    const prop = Object.hasOwn(declared, key) ? declared[key] : undefined;
    if (!prop) {
      if (!hasSchema) { at(key, `"${key}" is not declared by layout "${layout}", which has no schema`); continue; }
      const near = suggest(key, [...Object.keys(declared), ...RESERVED_KEYS]);
      at(key, `"${key}" is not declared by layout "${layout}"${near ? ` — did you mean "${near}"?` : ""}`);
      continue;
    }
    const r = coerce(prop, value);
    if (r.ok) out[key] = r.value;
    else at(key, `"${key}" ${r.message}`);
  }

  // ---- what the layout requires ----
  for (const key of schema.required ?? []) {
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) continue;
    if (!(key in values)) problems.push({ file: page.path, message: `"${key}" is required by layout "${layout}"` });
  }

  return { layoutId, values: out, problems };
}
