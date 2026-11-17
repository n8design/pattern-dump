// A list's items written as text: `{{this}}` or `{{.}}` inside an `{{#each}}` over the list, read from the template's
// AST. A storefront check uses it where a list's items changed from strings to objects (tags in 0.5.0): written as
// text, an object prints "[object Object]", so the page fails and names the field to write instead.
import Handlebars from "handlebars";
import { byTemplate } from "./template-memo";

/** One place an item is written whole: the list's path as the template writes it, and where. */
export interface ItemAsText { list: string; item: "this" | "."; line: number; column: number }

type Node = { type: string; loc?: { start: { line: number; column: number } } } & Record<string, unknown>;
type PathNode = { type: string; original?: unknown; parts?: unknown };

/** Blocks that keep the item as their context: what they hold still writes the item. */
const SAME_CONTEXT = new Set(["if", "unless"]);

/** One place a field of an item is read: `{{label}}` or `{{this.label}}` in the `{{#each}}` over the list. */
export interface ItemFieldRead { list: string; field: string; line: number; column: number }

/**
 * Walk every `{{#each <path>}}` whose path's last segment is `name` (`page.tags`, `tags`), visiting each mustache
 * written directly in it, also inside its #if and #unless. Not its {{else}}, not inside a block that changes the
 * context (another #each, #with). A template that does not parse has none.
 */
function eachMustache(template: string, name: string, visitMustache: (list: string, s: Node) => void): void {
  let ast: Node;
  try { ast = Handlebars.parse(template) as unknown as Node; } catch { return; }
  const inEach = (body: unknown[], list: string): void => {
    for (const s of body as Node[]) {
      if (s.type === "MustacheStatement") visitMustache(list, s);
      else if (s.type === "BlockStatement" && SAME_CONTEXT.has(String((s["path"] as PathNode).original))) {
        inEach(((s["program"] as Node | undefined)?.["body"] as unknown[]) ?? [], list);
        inEach(((s["inverse"] as Node | undefined)?.["body"] as unknown[]) ?? [], list);
      }
    }
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const n = node as Node;
    if (n.type === "BlockStatement" && (n["path"] as PathNode).original === "each") {
      const p = ((n["params"] as PathNode[] | undefined) ?? [])[0];
      const parts = p?.type === "PathExpression" && Array.isArray(p.parts) ? p.parts as string[] : [];
      if (parts.at(-1) === name) inEach(((n["program"] as Node | undefined)?.["body"] as unknown[]) ?? [], String(p!.original));
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && v && typeof v === "object") visit(v);
  };
  visit(ast);
}

/**
 * Every `{{this}}` / `{{.}}` (escaped or not) written directly in an `{{#each <path>}}` whose path's last segment is
 * `name`, as eachMustache walks it; not as a helper's argument.
 */
export function itemsWrittenAsText(template: string, name: string): readonly ItemAsText[] {
  return byTemplate(`items as text ${name}`, template, () => itemsAsTextIn(template, name));
}
function itemsAsTextIn(template: string, name: string): ItemAsText[] {
  const out: ItemAsText[] = [];
  const isItem = (p: PathNode | undefined) => p?.type === "PathExpression" && (p.original === "this" || p.original === ".");
  eachMustache(template, name, (list, s) => {
    const params = (s["params"] as unknown[] | undefined) ?? [];
    if (params.length === 0 && isItem(s["path"] as PathNode)) {
      const loc = s.loc?.start ?? { line: 1, column: 0 };
      out.push({ list, item: (s["path"] as PathNode).original === "." ? "." : "this", line: loc.line, column: loc.column + 1 });
    }
  });
  return out;
}

/** Every read of one of `fields` of the item (`{{label}}`, `{{this.label}}`, escaped or not, not a helper call) in an
 *  `{{#each <path>}}` whose path's last segment is `name`, as eachMustache walks it. */
export function itemFieldsRead(template: string, name: string, fields: readonly string[]): readonly ItemFieldRead[] {
  return byTemplate(`item fields ${name} ${fields.join(",")}`, template, () => fieldsReadIn(template, name, fields));
}
function fieldsReadIn(template: string, name: string, fields: readonly string[]): ItemFieldRead[] {
  const out: ItemFieldRead[] = [];
  eachMustache(template, name, (list, s) => {
    const params = (s["params"] as unknown[] | undefined) ?? [];
    const path = s["path"] as PathNode;
    // One segment of the item itself: not {{../label}} (the parent's), not {{@key}} (data).
    if (params.length || path?.type !== "PathExpression" || !Array.isArray(path.parts) || path.parts.length !== 1) return;
    if ((path as { depth?: number }).depth || (path as { data?: boolean }).data) return;
    const field = String(path.parts[0]);
    if (!fields.includes(field)) return;
    const loc = s.loc?.start ?? { line: 1, column: 0 };
    out.push({ list, field, line: loc.line, column: loc.column + 1 });
  });
  return out;
}
