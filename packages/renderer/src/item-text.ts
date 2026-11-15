// A list's items written as text: `{{this}}` or `{{.}}` inside an `{{#each}}` over the list, read from the template's
// AST. A storefront check uses it where a list's items changed from strings to objects (tags in 0.5.0): written as
// text, an object prints "[object Object]", so the page fails and names the field to write instead.
import Handlebars from "handlebars";

/** One place an item is written whole: the list's path as the template writes it, and where. */
export interface ItemAsText { list: string; line: number; column: number }

type Node = { type: string; loc?: { start: { line: number; column: number } } } & Record<string, unknown>;
type PathNode = { type: string; original?: unknown; parts?: unknown };

/** Blocks that keep the item as their context: what they hold still writes the item. */
const SAME_CONTEXT = new Set(["if", "unless"]);

/**
 * Every `{{this}}` / `{{.}}` (escaped or not) written directly in an `{{#each <path>}}` whose path's last segment is
 * `name` (`page.tags`, `tags`), also inside its #if and #unless. Not its {{else}}, not inside a block that changes the
 * context (another #each, #with), not as a helper's argument. A template that does not parse has none here.
 */
export function itemsWrittenAsText(template: string, name: string): ItemAsText[] {
  let ast: Node;
  try { ast = Handlebars.parse(template) as unknown as Node; } catch { return []; }
  const out: ItemAsText[] = [];
  const isItem = (p: PathNode | undefined) => p?.type === "PathExpression" && (p.original === "this" || p.original === ".");
  const inEach = (body: unknown[], list: string): void => {
    for (const s of body as Node[]) {
      if (s.type === "MustacheStatement") {
        const params = (s["params"] as unknown[] | undefined) ?? [];
        if (params.length === 0 && isItem(s["path"] as PathNode)) {
          const loc = s.loc?.start ?? { line: 1, column: 0 };
          out.push({ list, line: loc.line, column: loc.column + 1 });
        }
      } else if (s.type === "BlockStatement" && SAME_CONTEXT.has(String((s["path"] as PathNode).original))) {
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
  return out;
}
