// What a template outputs without escaping: `{{{x}}}` and `{{& x}}`, read from its Handlebars AST. A value a
// page writes reaches the page as HTML only through one of these, so a check on placed components can ask
// which names a template outputs this way, and refuse those it may not.
import Handlebars from "handlebars";

/** One unescaped output: the name it outputs (a helper call is named with its arguments), and where. */
export interface UnescapedOutput { name: string; line: number; column: number; helper: boolean }

type Node = { type: string; loc?: { start: { line: number; column: number } } } & Record<string, unknown>;

/** Every unescaped output of a template, in source order. A template that does not parse has none here
 *  (rendering it reports why). */
export function unescapedOutputs(template: string): UnescapedOutput[] {
  let ast: Node;
  try { ast = Handlebars.parse(template) as unknown as Node; } catch { return []; }
  const out: UnescapedOutput[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const n = node as Node;
    if (n.type === "MustacheStatement" && n["escaped"] === false) {
      const path = n["path"] as { original?: unknown } | undefined;
      const params = (n["params"] as unknown[] | undefined) ?? [];
      const hash = n["hash"] as { pairs?: unknown[] } | undefined;
      const helper = params.length > 0 || (hash?.pairs?.length ?? 0) > 0;
      const original = String(path?.original ?? "?").replace(/^this\./, "");
      const loc = n.loc?.start ?? { line: 1, column: 0 };
      out.push({ name: helper ? `${original} …` : original, line: loc.line, column: loc.column + 1, helper });
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && v && typeof v === "object") visit(v);
  };
  visit(ast);
  return out;
}
