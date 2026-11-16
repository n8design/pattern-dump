// Tags are objects since 0.5.0 (key, label, description, route). A component that contradicts itself about them renders
// wrong with no error: its template reads a tag's fields while its sample data or schema gives strings (empty
// <li></li>), or writes a tag whole while its schema declares objects ("[object Object]"). Only a contradiction is
// reported: a component whose tags are strings, written as strings, is a design system's own business.
import { basename } from "node:path";
import type { Diagnostic } from "@pattern-dump/contracts";
import { itemFieldsRead, itemsWrittenAsText } from "./item-text";

const TAG_FIELDS = ["key", "label", "description", "route"] as const;
const SINCE = "a tag is an object since 0.5.0 (key, label, description, route)";

type SchemaNode = { type?: unknown; properties?: Record<string, SchemaNode>; items?: SchemaNode };

/** A list path as a template writes it ("tags", "this.page.tags"), as segments under the context. */
const segments = (list: string): string[] => list.split(/[./]/).filter(s => s && s !== "this");

/** The value at `list` in the sample data. */
function dataAt(data: unknown, list: string): unknown {
  let v = data;
  for (const s of segments(list)) v = v && typeof v === "object" ? (v as Record<string, unknown>)[s] : undefined;
  return v;
}

/** The schema of the list's items at `list`, through `properties`. */
function itemsAt(schema: SchemaNode | undefined, list: string): SchemaNode | undefined {
  let node = schema;
  for (const s of segments(list)) node = node?.properties?.[s];
  return node?.items;
}

const typeIs = (t: unknown, only: string): boolean => t === only || (Array.isArray(t) && t.includes(only) && t.length === 1);

export interface TagShapeInput {
  template: string;
  /** The template's file, as diagnostics name it. */
  templateFile: string;
  /** The merged sample data, and the component's own data file (absent without one). */
  data: Record<string, unknown>;
  dataPath?: string;
  /** The parsed schema and its file (absent without one, or when it doesn't parse). */
  schema?: SchemaNode;
  schemaPath?: string;
  schemaFile?: string;
}

export function tagShapeProblems(i: TagShapeInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const reads = itemFieldsRead(i.template, "tags", TAG_FIELDS);
  // The first field read in each list: one problem per list, at its first read.
  const firstRead = new Map<string, (typeof reads)[number]>();
  for (const r of reads) if (!firstRead.has(r.list)) firstRead.set(r.list, r);
  for (const [list, r] of firstRead) {
    const value = dataAt(i.data, list);
    if (Array.isArray(value) && value.some(v => typeof v === "string")) {
      out.push({
        kind: "SHAPE_MISMATCH", severity: "error", source: "render",
        message: `{{#each ${list}}} reads {{${r.field}}}, but the tags in the sample data are strings: ${SINCE}: `
          + `give each one as { "key": "design", "label": "Design" }${i.dataPath ? ` in ${basename(i.dataPath)}` : " in its sample data"}`,
        location: { file: i.templateFile, line: r.line, column: r.column },
      });
    }
    if (i.schemaPath && typeIs(itemsAt(i.schema, list)?.type, "string")) {
      out.push({
        kind: "SCHEMA_INVALID", severity: "error", source: "schema",
        message: `${basename(i.schemaPath)} declares tags as a list of strings, but {{#each ${list}}} reads {{${r.field}}} (line ${r.line}): `
          + `${SINCE}: declare its items as "type": "object"`,
        path: `#/properties/${segments(list).join("/properties/")}`,
        location: { file: i.schemaFile! },
      });
    }
  }
  if (i.schemaPath) {
    for (const w of itemsWrittenAsText(i.template, "tags")) {
      if (!typeIs(itemsAt(i.schema, w.list)?.type, "object")) continue;
      out.push({
        kind: "SCHEMA_INVALID", severity: "error", source: "schema",
        message: `{{#each ${w.list}}} writes {{${w.item}}} (line ${w.line}), but ${basename(i.schemaPath)} declares tags as objects: ${SINCE}: `
          + `write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)`,
        path: `#/properties/${segments(w.list).join("/properties/")}`,
        location: { file: i.templateFile, line: w.line, column: w.column },
      });
    }
  }
  return out;
}
