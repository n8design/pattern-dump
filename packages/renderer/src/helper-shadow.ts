// A data field shadowed by a helper. In a template, a bare `{{id}}` (one name, no arguments) calls the helper `id`
// whenever one is registered, so a field of that name in the data is never read there: `{{#each palettes}}{{id}}`
// shows the helper's output, not `palettes[].id`. Nothing fails; the page is just wrong. Found by reading the
// template (Handlebars' own parser) for such calls whose name is also a key in the component's data, at any depth.
// A path (`{{this.id}}`, `{{../id}}`, `{{@root.id}}`) reads the field and is left alone, as is a call with arguments
// (a real helper call). The schema check (schema-helper-names.ts) covers a field a schema declares; this one covers
// data with or without a schema.

import Handlebars from "handlebars";

export interface HelperShadow {
  /** The name: a registered helper's, and a data key's. */
  name: string;
  /** Where the data has it, as a reader writes it: "id", "palettes[].id". */
  at: string;
  line: number;
  column: number;
}

/** Each key in `data` with the first place it is found, depth first. */
function keysOf(data: unknown): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) { for (const item of v) walk(item, `${path}[]`); return; }
    if (typeof v !== "object" || v === null) return;
    for (const [k, child] of Object.entries(v)) {
      const here = path ? `${path}.${k}` : k;
      if (!found.has(k)) found.set(k, here);
      walk(child, here);
    }
  };
  walk(data, "");
  return found;
}

interface Node { type?: string; [key: string]: unknown }

/** Every bare one-name mustache in the template whose name is a helper and a data key, in template order. */
export function helperShadows(template: string, data: unknown, helpers: Iterable<string>, skip: ReadonlySet<string> = new Set()): HelperShadow[] {
  let ast: Node;
  try { ast = Handlebars.parse(template) as unknown as Node; } catch { return []; } // a template that doesn't parse fails its render
  const helperNames = new Set(helpers);
  const keys = keysOf(data);
  const shadows: HelperShadow[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== "object" || node === null) return;
    const n = node as Node;
    if (n.type === "MustacheStatement") {
      const path = n["path"] as { type?: string; parts?: string[]; original?: string; data?: boolean } | undefined;
      const params = n["params"] as unknown[] | undefined;
      const hash = n["hash"] as { pairs?: unknown[] } | undefined;
      const name = path?.parts?.[0];
      if (path?.type === "PathExpression" && !path.data && path.parts?.length === 1 && path.original === name
        && !params?.length && !hash?.pairs?.length && name && helperNames.has(name) && keys.has(name) && !skip.has(name)) {
        const loc = n["loc"] as { start?: { line: number; column: number } } | undefined;
        const key = `${name}@${loc?.start?.line}:${loc?.start?.column}`;
        if (!seen.has(key)) {
          seen.add(key);
          shadows.push({ name, at: keys.get(name)!, line: loc?.start?.line ?? 1, column: (loc?.start?.column ?? 0) + 1 });
        }
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && typeof v === "object") visit(v);
  };
  visit(ast);
  return shadows;
}
