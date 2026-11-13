// `{{pd-image field alt=…}}`: which image slot each call fills, worked out from the template's own component schema
// before the template is compiled. Handlebars hands a helper the field's value, never its name, and inside
// `{{#each slides}}` a path is relative to the item; so the call's first argument is resolved here, statically,
// following `#each` (into an array's items) and `#with` (into an object), and `../` and `@root` back out. The slot is
// the resolved field's `x-pd-image` (`widths`, `sizes`), and is written onto the call as a hash value the helper
// reads (`pd-slot`). A call that can't be resolved, a field without `x-pd-image`, and a call without `alt=` are
// problems, reported as SCHEMA_INVALID on the component (schema-extensions.ts), and the helper fails such a call.
import Handlebars from "handlebars";

/** An image slot, as `x-pd-image` declares it. */
export interface ImageSlot { widths: number[]; sizes: string }

/** One `{{pd-image}}` call: where it is, the field it names, and its slot or what is wrong with it. */
export interface ImageCall { line: number; column: number; field: string; slot?: ImageSlot; problem?: string }

type Node = Record<string, unknown>;
type Schema = Record<string, unknown> | null;
const isObject = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** The hash key the resolved slot travels in, from the template to the helper. Not for authors to write. */
export const SLOT_KEY = "pd-slot";

/** The slot `x-pd-image` declares, or null when the value isn't one (schema-extensions.ts says why). */
export function readSlot(value: unknown): ImageSlot | null {
  if (!isObject(value)) return null;
  const { widths, sizes } = value;
  if (!Array.isArray(widths) || widths.length === 0 || !widths.every(w => typeof w === "number" && Number.isInteger(w) && w > 0)) return null;
  if (!widths.every((w, i) => i === 0 || w > (widths[i - 1] as number))) return null;
  if (typeof sizes !== "string" || sizes.trim() === "" || sizes.includes('"')) return null;
  if (Object.keys(value).some(k => k !== "widths" && k !== "sizes")) return null;
  return { widths: widths as number[], sizes };
}

/** A path's schema node from a scope: through `properties`, or for `this` the scope itself. */
function lookup(scope: Schema, parts: string[]): Schema {
  let node: Schema = scope;
  for (const part of parts) {
    const props = node && isObject(node["properties"]) ? node["properties"] : null;
    node = props && isObject(props[part]) ? props[part] as Node : null;
    if (!node) return null;
  }
  return node;
}

/** Visits every `{{pd-image}}` call with its resolution, in document order. */
function visit(ast: hbs.AST.Program, schema: Schema, onCall: (node: Node, call: ImageCall) => void): void {
  const resolve = (path: Node, scopes: Schema[]): Schema => {
    const parts = (path["parts"] as string[] | undefined) ?? [];
    if (path["data"]) return parts[0] === "root" ? lookup(scopes[0] ?? null, parts.slice(1)) : null;
    const depth = (path["depth"] as number | undefined) ?? 0;
    const scope = scopes[scopes.length - 1 - depth];
    return scope === undefined ? null : lookup(scope, parts);
  };
  const walk = (node: unknown, scopes: Schema[]): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n, scopes); return; }
    if (!isObject(node)) return;
    const path = isObject(node["path"]) ? node["path"] : null;
    const name = path?.["original"];
    if ((node["type"] === "MustacheStatement" || node["type"] === "SubExpression") && name === "pd-image") {
      const loc = (node["loc"] as { start: { line: number; column: number } } | undefined)?.start ?? { line: 0, column: 0 };
      const param = (node["params"] as Node[] | undefined)?.[0];
      const pairs = ((node["hash"] as Node | undefined)?.["pairs"] as Node[] | undefined) ?? [];
      const at = `{{pd-image}} at ${loc.line}:${loc.column + 1}`;
      const call: ImageCall = { line: loc.line, column: loc.column + 1, field: param && param["type"] === "PathExpression" ? String(param["original"]) : "" };
      if (!param || param["type"] !== "PathExpression") call.problem = `${at} takes the image field as its first argument, such as {{pd-image image alt=alt}}`;
      else if (pairs.some(p => p["key"] === SLOT_KEY)) call.problem = `${at}: "${SLOT_KEY}" is set by Pattern Dump, not in a template`;
      else {
        const field = resolve(param, scopes);
        const slot = field ? readSlot(field["x-pd-image"]) : null;
        if (!field) call.problem = `${at}: "${call.field}" is not a field this component's schema declares`;
        else if (!slot) call.problem = `${at}: the field "${call.field}" declares no image slot (x-pd-image with its widths and sizes)`;
        else if (!pairs.some(p => p["key"] === "alt")) call.problem = `${at} needs alt=…: the image's text alternative, or alt="" for a decorative image`;
        else call.slot = slot;
      }
      onCall(node, call);
      return;
    }
    if (node["type"] === "BlockStatement") {
      const param = (node["params"] as Node[] | undefined)?.[0];
      let inner: Schema = null;
      if (name === "if" || name === "unless") inner = scopes[scopes.length - 1] ?? null;
      else if ((name === "each" || name === "with") && param?.["type"] === "PathExpression") {
        const target = resolve(param, scopes);
        inner = name === "each" ? (target && isObject(target["items"]) ? target["items"] as Node : null) : target;
      }
      const sameScope = name === "if" || name === "unless";
      walk(node["program"], sameScope ? scopes : [...scopes, inner]);
      walk(node["inverse"], scopes);
      return;
    }
    for (const key of ["body", "program", "inverse"]) walk(node[key], scopes);
  };
  walk(ast, [schema]);
}

/** Every `{{pd-image}}` call in a template, resolved against its component's schema. Empty when it has none. */
export function imageCalls(template: string, schema: unknown): ImageCall[] {
  if (!template.includes("pd-image")) return [];
  const calls: ImageCall[] = [];
  let ast: hbs.AST.Program;
  try { ast = Handlebars.parse(template); } catch { return []; }
  visit(ast, isObject(schema) ? schema : null, (_, call) => calls.push(call));
  return calls;
}

/** What to compile: the template's AST with each resolved call carrying its slot, or the source unchanged when it
 *  has no `{{pd-image}}`. An unresolved call is left without a slot, and the helper fails it. */
export function withImageSlots(template: string, schema: unknown): string | hbs.AST.Program {
  if (!template.includes("pd-image")) return template;
  const ast = Handlebars.parse(template);
  visit(ast, isObject(schema) ? schema : null, (node, call) => {
    if (!call.slot) return;
    const hash = (isObject(node["hash"]) ? node["hash"] : (node["hash"] = { type: "Hash", pairs: [], loc: node["loc"] })) as Node;
    (hash["pairs"] as Node[]).push({
      type: "HashPair", key: SLOT_KEY, loc: node["loc"],
      value: { type: "StringLiteral", value: JSON.stringify(call.slot), original: JSON.stringify(call.slot), loc: node["loc"] },
    });
  });
  return ast;
}
