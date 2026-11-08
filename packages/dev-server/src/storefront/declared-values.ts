// A value checked against what a schema property declares: its type (or the first of its types that
// fits), its array items, its enum. One checker for every value the storefront takes from an author:
//
//   - "frontmatter": a page's frontmatter value, which is always text or a list of text. It is coerced
//     to the declared type where that is unambiguous ("2" to 2, "true" to true).
//   - "json": a value from the config, already typed. Nothing is coerced: it must be the declared type.
//
// And a third, `checkPlaced` (at the end): a component placed on a page with values, checked at every level.
//
// Only what the property declares is checked; nothing is inferred, and other schema keywords are ignored.

import { readFile } from "node:fs/promises";
import { suggest } from "@pattern-dump/config";
import type { FrontmatterValue } from "../frontmatter.js";

export type JsonType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
export interface PropertySchema {
  type?: JsonType | JsonType[]; enum?: unknown[]; items?: PropertySchema; properties?: Record<string, PropertySchema>; required?: string[];
  /** Placed components: this value (or each item) is that component, checked against its own schema. */
  "x-pd-component"?: string;
  /** Placed components: "text/markdown" on a string renders it as markdown, with HTML escaped. */
  contentMediaType?: string;
}

/** How a value arrives: frontmatter text, coerced; or a typed config value, taken as it is. */
export type DeclaredMode = "frontmatter" | "json";

export type Checked = { ok: true; value: unknown } | { ok: false; message: string };

const NUMERIC = /^-?\d+(\.\d+)?$/;
const quote = (v: FrontmatterValue): string => Array.isArray(v) ? `[${v.join(", ")}]` : `"${v}"`;
const describe = (v: unknown, mode: DeclaredMode): string => mode === "frontmatter" ? quote(v as FrontmatterValue) : JSON.stringify(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A value as one type, or an error message. */
function asType(type: JsonType, value: unknown, items: PropertySchema | undefined, mode: DeclaredMode): Checked {
  const got = (): string => describe(value, mode);
  switch (type) {
    case "string":
      if (mode === "frontmatter") return typeof value === "string" ? { ok: true, value } : { ok: false, message: "must be text, not a list" };
      return typeof value === "string" ? { ok: true, value } : { ok: false, message: `must be text (got ${got()})` };
    case "number":
      if (mode === "frontmatter") return typeof value === "string" && NUMERIC.test(value) ? { ok: true, value: Number(value) } : { ok: false, message: `must be a number (got ${got()})` };
      return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false, message: `must be a number (got ${got()})` };
    case "integer":
      if (mode === "frontmatter") return typeof value === "string" && /^-?\d+$/.test(value) ? { ok: true, value: Number(value) } : { ok: false, message: `must be a whole number (got ${got()})` };
      return typeof value === "number" && Number.isInteger(value) ? { ok: true, value } : { ok: false, message: `must be a whole number (got ${got()})` };
    case "boolean":
      if (mode === "frontmatter") return value === "true" || value === "false" ? { ok: true, value: value === "true" } : { ok: false, message: `must be true or false (got ${got()})` };
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, message: `must be true or false (got ${got()})` };
    case "array": {
      if (!Array.isArray(value)) return { ok: false, message: `must be a list (got ${got()})` };
      const itemType = items?.type;
      if (itemType === undefined) return { ok: true, value };
      const out: unknown[] = [];
      for (const item of value) {
        const r = checkDeclared({ type: itemType, ...(items?.enum ? { enum: items.enum } : {}) }, item, mode);
        if (!r.ok) return { ok: false, message: `has an item that ${r.message}` };
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "object":
      if (mode === "json") return isPlainObject(value) ? { ok: true, value } : { ok: false, message: `must be an object (got ${got()})` };
      return { ok: false, message: `has a type (${type}) a page cannot set in frontmatter` };
    case "null":
      if (mode === "json") return value === null ? { ok: true, value } : { ok: false, message: `must be null (got ${got()})` };
      return { ok: false, message: `has a type (${type}) a page cannot set in frontmatter` };
    default:
      return { ok: false, message: `has a type (${String(type)}) that cannot be checked` };
  }
}

/** A value as the property declares it: its type (or the first of its types that fits), then its enum. */
export function checkDeclared(prop: PropertySchema, value: unknown, mode: DeclaredMode): Checked {
  let result: Checked = { ok: true, value };
  if (prop.type !== undefined) {
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    const tries = types.map(t => asType(t, value, prop.items, mode));
    result = tries.find(r => r.ok) ?? tries[0];
  }
  if (result.ok && Array.isArray(prop.enum) && !prop.enum.some(e => e === result.value)) {
    return { ok: false, message: `must be one of ${prop.enum.map(e => JSON.stringify(e)).join(", ")} (got ${describe(value, mode)})` };
  }
  return result;
}

/** What a component schema file declares at its top. */
export interface ObjectSchema {
  required?: string[]; properties?: Record<string, PropertySchema>;
  /** Placed components: the property a tag's content text fills. */
  "x-pd-content"?: string;
}

/** A component's schema file, parsed: `schema` is absent when there is no file; `error` says why one
 *  cannot be read. The one place a storefront check reads a schema. */
export async function readSchema(schemaPath: string | undefined): Promise<{ schema?: ObjectSchema; error?: string }> {
  if (!schemaPath) return {};
  try {
    return { schema: JSON.parse(await readFile(schemaPath, "utf8")) as ObjectSchema };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Placed components ───────────────────────────────────────────────────────────────────────────────
// A component placed on a page with values (a `pd-` tag) is checked here, in a third mode beside the two
// above, which stay as they are. The values arrive as a located tree, text at the leaves, as a page writes
// them; every level is checked against what it declares, and every problem is reported with its path and
// its position in the file, not only the first. A value that names a component (`x-pd-component`) is
// checked against that component's schema. Declared keys a placement leaves unset are null, at every level,
// so a component's sample data can never fill them on a real page.

/** A position in the page file, 1-based. */
export interface Pos { line: number; column: number }
/** A placed value, as written: text, an attribute written without a value, a list, or a set of keys. */
export type Placed =
  | { kind: "text"; value: string; at: Pos }
  | { kind: "bare"; at: Pos }
  | { kind: "list"; items: Placed[]; at: Pos }
  | { kind: "keys"; entries: PlacedEntry[]; at: Pos };
/** One key of a set, with how the page wrote it (`label`: an attribute name, a child tag). */
export interface PlacedEntry { key: string; label: string; at: Pos; value: Placed }
export interface PlacedProblem { at: Pos; message: string }

export interface PlacedContext {
  /** A component's schema; undefined when it has none. */
  schemaOf(componentId: string): Promise<ObjectSchema | undefined>;
  /** How a schema key is written on the page, for messages (an attribute is kebab-case). */
  label(key: string): string;
  /** Text of a `text/markdown` property, rendered with HTML escaped. */
  markdown(text: string): string;
}

/** A component's placed values, checked: the values to render it with, and every problem. */
export async function checkPlaced(
  componentId: string, values: Placed & { kind: "keys" }, where: string, ctx: PlacedContext,
): Promise<{ value: Record<string, unknown>; problems: PlacedProblem[] }> {
  const problems: PlacedProblem[] = [];
  const value = await placedComponent(componentId, values, where, ctx, problems);
  return { value, problems };
}

async function placedComponent(
  id: string, node: Placed & { kind: "keys" }, where: string, ctx: PlacedContext, problems: PlacedProblem[],
): Promise<Record<string, unknown>> {
  const schema = await ctx.schemaOf(id);
  if (!schema) { problems.push({ at: node.at, message: `${where}: ${id} has no schema, so it cannot be placed with values` }); return {}; }
  return placedKeys(schema, node, where, id, ctx, problems);
}

async function placedKeys(
  schema: ObjectSchema, node: Placed & { kind: "keys" }, where: string, owner: string, ctx: PlacedContext, problems: PlacedProblem[],
): Promise<Record<string, unknown>> {
  const declared = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const e of node.entries) {
    if (seen.has(e.key)) { problems.push({ at: e.at, message: `${where}: "${e.label}" is set twice` }); continue; }
    seen.add(e.key);
    const prop = Object.hasOwn(declared, e.key) ? declared[e.key] : undefined;
    if (!prop) {
      const near = suggest(e.label, Object.keys(declared).map(k => ctx.label(k)));
      problems.push({ at: e.at, message: `${where}: "${e.label}" is not declared by ${owner}${near ? ` — did you mean "${near}"?` : ""}` });
      continue;
    }
    const v = await placedValue(prop, e.value, `${where}.${e.label}`, ctx, problems);
    if (v !== undefined) out[e.key] = v;
  }
  for (const key of schema.required ?? []) {
    if (!seen.has(key)) problems.push({ at: node.at, message: `${where}: "${ctx.label(key)}" is required by ${owner}` });
  }
  for (const key of Object.keys(declared)) if (!(key in out)) out[key] = null;
  return out;
}

async function placedValue(prop: PropertySchema, node: Placed, where: string, ctx: PlacedContext, problems: PlacedProblem[]): Promise<unknown> {
  const component = prop["x-pd-component"];
  if (component) {
    if (node.kind !== "keys") { problems.push({ at: node.at, message: `${where} must be a ${component}` }); return undefined; }
    return placedComponent(component, node, where, ctx, problems);
  }
  const types = prop.type === undefined ? [] : Array.isArray(prop.type) ? prop.type : [prop.type];
  if (node.kind === "list") {
    if (!types.includes("array")) { problems.push({ at: node.at, message: `${where} must not be a list` }); return undefined; }
    const items = prop.items ?? {};
    const out: unknown[] = [];
    for (const [i, item] of node.items.entries()) {
      const v = await placedValue(items, item, `${where}[${i + 1}]`, ctx, problems);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (node.kind === "keys") {
    if (!types.includes("object")) { problems.push({ at: node.at, message: `${where} must not be a set of keys` }); return undefined; }
    return placedKeys(prop, node, where, where, ctx, problems);
  }
  if (node.kind === "bare") {
    // Written without a value: a boolean, true. Anything else needs one.
    if (types.includes("boolean")) return true;
    problems.push({ at: node.at, message: `${where} needs a value — only a boolean can be written without one` });
    return undefined;
  }
  // Text: as frontmatter coerces it ("2" to 2; "true" and "false" to booleans, nothing else).
  const r = checkDeclared(prop, node.value, "frontmatter");
  if (!r.ok) { problems.push({ at: node.at, message: `${where} ${r.message}` }); return undefined; }
  if (prop.contentMediaType === "text/markdown" && typeof r.value === "string") return ctx.markdown(r.value);
  return r.value;
}
