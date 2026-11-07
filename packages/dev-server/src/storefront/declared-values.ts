// A value checked against what a schema property declares: its type (or the first of its types that
// fits), its array items, its enum. One checker for every value the storefront takes from an author:
//
//   - "frontmatter": a page's frontmatter value, which is always text or a list of text. It is coerced
//     to the declared type where that is unambiguous ("2" to 2, "true" to true).
//   - "json": a value from the config, already typed. Nothing is coerced: it must be the declared type.
//
// Only what the property declares is checked; nothing is inferred, and other schema keywords are ignored.

import { readFile } from "node:fs/promises";
import type { FrontmatterValue } from "../frontmatter.js";

export type JsonType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
export interface PropertySchema { type?: JsonType | JsonType[]; enum?: unknown[]; items?: PropertySchema; properties?: Record<string, PropertySchema>; required?: string[] }

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
export interface ObjectSchema { required?: string[]; properties?: Record<string, PropertySchema> }

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
