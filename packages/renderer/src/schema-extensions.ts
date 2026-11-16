// The schema extensions for components placed on a page (`pd-` tags), checked in any schema that has them:
//
//   x-pd-component     on a property or its items: that value is the named component; it must exist and have
//                      a schema.
//   x-pd-content       at a schema's top: the property a tag's content fills; it must be a declared string.
//   contentMediaType   only "text/markdown", only on a string: rendered as markdown, HTML escaped.
//
// And five that are not about placement, so they don't switch on the template check below:
//
//   x-pd-card            on a list property (a layout's `page.children`, a view's `entries`): the card each page of
//                        the listing is shown as. It names a component with a schema; the storefront checks every page
//                        in the listing against that schema (cards.ts in the dev-server).
//   x-pd-image           on a string property: the image slot that field fills, `{ widths, sizes }`, which
//                        `{{pd-image field alt=…}}` writes as an <img> with its variants (image-slots.ts). Every
//                        `{{pd-image}}` call in the template is checked against it.
//   x-pd-query           on a sub-key of a layout's `page` (`page.related`): a list of pages the storefront fills from
//                        a query, `{ pages, collections, categories, tags, match, sort, order, limit, view }`
//                        (query.ts in the dev-server checks the values against the site).
//   x-pd-view            on a layout's `page.listing`: the view its listing is shown in when the folder's index.md
//                        names none.
//   x-pd-example-height  at a schema's top: the height, in whole CSS pixels, a live example of the component
//                        starts at on a storefront page, before its preview reports its own. It must err
//                        short: the frame can grow to its content but never shrink below this. One value
//                        covers every variant, so it is the height at the widest column and no taller than
//                        the shortest variant.
//   x-pd-regions         on a layout's `page.regions`: its regions, a list of names; with x-pd-toc (true: its pages show
//                        the table of contents). The storefront checks both (regions.ts in the dev-server).
//   x-pd-region          at a component's top: the layout region it goes into when a page places it (regions.ts).
//   x-pd-prose-images    at a layout's top: the slot of the images in its pages' prose, `{ widths, sizes, eager }`.
//                        A raster image from the assets in a page's markdown is written as an <img> with its variants
//                        and `sizes="auto, <sizes>"`; the first `eager` (optional, default 0) load at once, with
//                        `sizes` alone. A page with a raster image whose layout declares no slot fails.
//
// Any other `x-pd-` key is an error (a typo would otherwise do nothing); other `x-` keys are left alone. A
// schema that uses a placement extension says its component can be placed, so its template is checked too:
// it may output unescaped (`{{{x}}}`, `{{& x}}`) only what the schema declares `text/markdown`. Checked at
// render, so a broken schema shows on its component in the workbench before any page places it; the
// storefront refuses to place it as well.
import { unescapedOutputs } from "./unescaped";
import { imageCalls, readSlot, type ImageSlot } from "./image-slots";

/** One problem, with the JSON pointer of the schema keyword it is about. */
export interface SchemaExtensionProblem { path: string; message: string }

export interface SchemaExtensionContext {
  /** Whether a component id exists, and whether it has a schema. */
  componentExists(id: string): boolean;
  hasSchema(id: string): boolean;
}

type Prop = Record<string, unknown>;
const KNOWN_PROPERTY_KEYS = new Set(["x-pd-card", "x-pd-component", "x-pd-image", "x-pd-query", "x-pd-regions", "x-pd-toc", "x-pd-view"]);
const KNOWN_TOP_KEYS = new Set(["x-pd-content", "x-pd-example-height", "x-pd-prose-images", "x-pd-region"]);
const KNOWN_LIST = "x-pd-card, x-pd-component, x-pd-content, x-pd-example-height, x-pd-image, x-pd-prose-images, x-pd-query, x-pd-region, "
  + "x-pd-regions, x-pd-toc, x-pd-view";
/** The options of a query (x-pd-query), in the order the docs list them. Their values are checked by the storefront,
 *  against the site's pages, folders and categories (query.ts in the dev-server). */
export const QUERY_OPTIONS = ["pages", "collections", "categories", "tags", "match", "sort", "order", "limit", "view"] as const;
const isObject = (v: unknown): v is Prop => typeof v === "object" && v !== null && !Array.isArray(v);
const typesOf = (p: Prop): unknown[] => p["type"] === undefined ? [] : Array.isArray(p["type"]) ? p["type"] : [p["type"]];

/** A schema's x-pd-example-height: the height when it declares a valid one, the problem when it is invalid,
 *  nothing when it declares none. The schema check and the storefront's live examples both read it here. */
export function readExampleHeight(schema: unknown): { height?: number; problem?: string } {
  if (!isObject(schema) || !("x-pd-example-height" in schema)) return {};
  const value = schema["x-pd-example-height"];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return { height: value };
  return { problem: `x-pd-example-height must be a whole number of pixels above 0 (got ${JSON.stringify(value)}): `
    + `the live example's height at the widest column, no taller than its shortest variant` };
}

/** A layout's slot for the images in its pages' prose: its widths and sizes, and how many of a page's first images
 *  load at once. */
export interface ProseSlot extends ImageSlot { eager: number }

/** A schema's x-pd-prose-images: the slot when it declares a valid one, the problem when it is invalid, nothing when
 *  it declares none. The schema check and the storefront's markdown both read it here. */
export function readProseSlot(schema: unknown): { slot?: ProseSlot; problem?: string } {
  if (!isObject(schema) || !("x-pd-prose-images" in schema)) return {};
  const value = schema["x-pd-prose-images"];
  if (isObject(value)) {
    const { eager = 0, ...rest } = value;
    const slot = readSlot(rest);
    if (slot && typeof eager === "number" && Number.isInteger(eager) && eager >= 0) return { slot: { ...slot, eager } };
  }
  return { problem: `x-pd-prose-images must be { "widths": [...], "sizes": "...", "eager": n }: `
    + `widths whole numbers above 0 in ascending order, sizes the <img> sizes value (with no double quote), `
    + `eager (optional) how many of a page's first images load at once, a whole number from 0` };
}

/** Every problem with a schema's placement extensions (and, when it uses them, its template's). */
export function checkSchemaExtensions(schema: unknown, template: string | undefined, ctx: SchemaExtensionContext): SchemaExtensionProblem[] {
  if (!isObject(schema)) return [];
  const problems: SchemaExtensionProblem[] = [];
  let usesPlacement = false;
  const markdown = new Set<string>();

  const unknownKeys = (node: Prop, known: Set<string>, path: string): void => {
    for (const key of Object.keys(node)) {
      if (key.startsWith("x-pd-") && !known.has(key)) {
        problems.push({ path: `${path}/${key}`, message: `"${key}" is not a schema extension Pattern Dump knows (${KNOWN_LIST})` });
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
    // A listing's card: not a placement, so it switches on no template check. A list, or a property with no type of
    // its own (page.children, whose shape is Pattern Dump's).
    const card = prop["x-pd-card"];
    if (card !== undefined) {
      const types = typesOf(prop);
      if (types.length && !types.includes("array")) problems.push({ path: `${path}/x-pd-card`, message: `x-pd-card is only for a list: the pages of a listing, each shown as the card` });
      else if (typeof card !== "string") problems.push({ path: `${path}/x-pd-card`, message: `x-pd-card must name a component` });
      else if (!ctx.componentExists(card)) problems.push({ path: `${path}/x-pd-card`, message: `x-pd-card names "${card}", which is not a component` });
      else if (!ctx.hasSchema(card)) problems.push({ path: `${path}/x-pd-card`, message: `x-pd-card names "${card}", which has no schema, so a listing's pages can't be checked against it` });
    }
    // A query (a layout's page.<name>) and a default view (a layout's page.listing): not placements either. Only what
    // needs no site is checked here: the options' names, and that a view is one.
    const isView = (v: unknown) => typeof v === "string" && /^[^/~]+$/.test(v) && ctx.componentExists(`views/${v}`);
    const query = prop["x-pd-query"];
    if (query !== undefined) {
      const at = `${path}/x-pd-query`;
      const options = QUERY_OPTIONS.join(", ");
      if (!isObject(query)) problems.push({ path: at, message: `x-pd-query must be an object of options (${options})` });
      else {
        for (const key of Object.keys(query)) {
          if (!(QUERY_OPTIONS as readonly string[]).includes(key)) problems.push({ path: at, message: `"${key}" is not an option of a query (${options})` });
        }
        if (query["view"] !== undefined && !isView(query["view"])) problems.push({ path: at, message: `view ${JSON.stringify(query["view"])} is not a view (a component in views/)` });
      }
    }
    const view = prop["x-pd-view"];
    if (view !== undefined) {
      if (typeof view !== "string") problems.push({ path: `${path}/x-pd-view`, message: `x-pd-view must name a view` });
      else if (!isView(view)) problems.push({ path: `${path}/x-pd-view`, message: `view "${view}" is not a view (a component in views/)` });
    }
    const image = prop["x-pd-image"];
    if (image !== undefined) {
      if (!typesOf(prop).includes("string")) problems.push({ path: `${path}/x-pd-image`, message: `x-pd-image is only for a string property: the path of an image in the assets` });
      else if (!readSlot(image)) problems.push({ path: `${path}/x-pd-image`, message: `x-pd-image must be { "widths": [...], "sizes": "..." }: widths whole numbers above 0 in ascending order, sizes the <img> sizes value (with no double quote)` });
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

  const exampleHeight = readExampleHeight(schema).problem;
  if (exampleHeight) problems.push({ path: "#/x-pd-example-height", message: exampleHeight });
  const proseImages = readProseSlot(schema).problem;
  if (proseImages) problems.push({ path: "#/x-pd-prose-images", message: proseImages });

  if (template !== undefined) {
    for (const call of imageCalls(template, schema)) if (call.problem) problems.push({ path: "#", message: call.problem });
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
