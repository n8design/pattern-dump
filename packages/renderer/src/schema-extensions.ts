// The schema extensions for components placed on a page (`pd-` tags), checked in any schema that has them:
//
//   x-pd-component     on a property or its items: that value is the named component; it must exist and have
//                      a schema.
//   x-pd-content       at a schema's top: the property a tag's content fills; it must be a declared string.
//   contentMediaType   only "text/markdown", only on a string: rendered as markdown, HTML escaped.
//
// Any other `x-pd-` key is an error (a typo would otherwise do nothing); other `x-` keys are left alone. A
// schema that uses a placement extension says its component can be placed, so its template is checked too:
// it may output unescaped (`{{{x}}}`, `{{& x}}`) only what the schema declares `text/markdown`. Checked at
// render, so a broken schema shows on its component in the workbench before any page places it; the
// storefront refuses to place it as well.
import { unescapedOutputs } from "./unescaped";

/** One problem, with the JSON pointer of the schema keyword it is about. */
export interface SchemaExtensionProblem { path: string; message: string }

export interface SchemaExtensionContext {
  /** Whether a component id exists, and whether it has a schema. */
  componentExists(id: string): boolean;
  hasSchema(id: string): boolean;
}

type Prop = Record<string, unknown>;
const KNOWN_PROPERTY_KEYS = new Set(["x-pd-component"]);
const KNOWN_TOP_KEYS = new Set(["x-pd-content"]);
const isObject = (v: unknown): v is Prop => typeof v === "object" && v !== null && !Array.isArray(v);
const typesOf = (p: Prop): unknown[] => p["type"] === undefined ? [] : Array.isArray(p["type"]) ? p["type"] : [p["type"]];

/** Every problem with a schema's placement extensions (and, when it uses them, its template's). */
export function checkSchemaExtensions(schema: unknown, template: string | undefined, ctx: SchemaExtensionContext): SchemaExtensionProblem[] {
  if (!isObject(schema)) return [];
  const problems: SchemaExtensionProblem[] = [];
  let usesPlacement = false;
  const markdown = new Set<string>();

  const unknownKeys = (node: Prop, known: Set<string>, path: string): void => {
    for (const key of Object.keys(node)) {
      if (key.startsWith("x-pd-") && !known.has(key)) {
        problems.push({ path: `${path}/${key}`, message: `"${key}" is not a schema extension Pattern Dump knows (x-pd-component, x-pd-content)` });
      }
    }
  };

  const property = (name: string, prop: unknown, path: string): void => {
    if (!isObject(prop)) return;
    unknownKeys(prop, KNOWN_PROPERTY_KEYS, path);
    const component = prop["x-pd-component"];
    if (component !== undefined) {
      usesPlacement = true;
      if (typeof component !== "string") problems.push({ path: `${path}/x-pd-component`, message: `x-pd-component must name a component` });
      else if (!ctx.componentExists(component)) problems.push({ path: `${path}/x-pd-component`, message: `x-pd-component names "${component}", which is not a component` });
      else if (!ctx.hasSchema(component)) problems.push({ path: `${path}/x-pd-component`, message: `x-pd-component names "${component}", which has no schema, so it cannot be placed with values` });
    }
    const media = prop["contentMediaType"];
    if (media !== undefined) {
      usesPlacement = true;
      if (media !== "text/markdown") problems.push({ path: `${path}/contentMediaType`, message: `contentMediaType must be "text/markdown" (got ${JSON.stringify(media)})` });
      else if (!typesOf(prop).includes("string")) problems.push({ path: `${path}/contentMediaType`, message: `contentMediaType is only for a string property` });
      else markdown.add(name);
    }
    if (isObject(prop["items"])) property(name, prop["items"], `${path}/items`);
    if (isObject(prop["properties"])) for (const [k, v] of Object.entries(prop["properties"])) property(k, v, `${path}/properties/${k}`);
  };

  unknownKeys(schema, KNOWN_TOP_KEYS, "#");
  const props = isObject(schema["properties"]) ? schema["properties"] : {};
  for (const [k, v] of Object.entries(props)) property(k, v, `#/properties/${k}`);

  const content = schema["x-pd-content"];
  if (content !== undefined) {
    usesPlacement = true;
    const target = typeof content === "string" && isObject(props[content]) ? props[content] as Prop : undefined;
    if (!target) problems.push({ path: "#/x-pd-content", message: `x-pd-content names ${JSON.stringify(content)}, which is not a declared property` });
    else if (!typesOf(target).includes("string")) problems.push({ path: "#/x-pd-content", message: `x-pd-content names "${content}", which is not a string` });
  }

  if (usesPlacement && template !== undefined) {
    for (const o of unescapedOutputs(template)) {
      if (!o.helper && markdown.has(o.name)) continue;
      const what = o.helper ? `a helper's result ({{{${o.name}}}})` : `"${o.name}" ({{{${o.name}}}})`;
      problems.push({ path: "#", message: `the template outputs ${what} unescaped at ${o.line}:${o.column}, which only a text/markdown property may be` });
    }
  }
  return problems;
}
