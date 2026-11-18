// One component placed on a page with values (a `pd-` tag block), from its tags to its HTML: read the tags
// into located values (placed-tags.ts), check them against the schemas (declared-values.ts, checkPlaced),
// refuse a template that would output a page's plain value unescaped, and render the component once
// through `render()`, its children passed as data.
//
// Escaping. Attribute values are plain text, never HTML. Content text becomes HTML only through block
// markdown with `html: false` (a `text/markdown` property), before it reaches the template; any other
// value is plain text, which the template escapes. The one way a page's value could still reach the page as
// HTML is a template outputting it unescaped (`{{{x}}}`, `{{& x}}`). So every template in the placed
// component's include tree may output unescaped only names some schema of the placement declares
// `text/markdown`; anything else is a named error, and nothing is rendered. Strict on purpose: a partial
// included with the current context sees the placement's values too.

import { basename } from "node:path";
import { createMarkdown } from "../code-blocks.js";
import type { DiscoveryMap, Render } from "@pattern-dump/contracts";
import { placementSchemaPath } from "../discovery-index.js";
import { checkSchemaExtensions, isHelperNameProblem, unescapedOutputs } from "@pattern-dump/renderer";
import type { CompositionRegistry } from "../composition.js";
import { toPlaced, type PlacedBlock, type PlacedResolver, type PlacedTag } from "../placed-tags.js";
import type { PageHeading } from "./derived.js";
import { defaultRegion } from "./regions.js";
import { TOC_ID, TOC_TAG, tocItems, type TocAnchor, type TocItem } from "./toc.js";
import { checkPlaced, type ObjectSchema, type PlacedProblem, type PropertySchema } from "./declared-values.js";
import { includeTree } from "./sample-data.js";
import { designFiles } from "./design-files.js";

/** Content markdown: block markdown, HTML escaped (html: false), markdown-it's link check. */
const contentMd = createMarkdown({ html: false, linkify: false });

export interface PlacementDeps {
  discoveryMap: DiscoveryMap;
  handleMap: Map<string, string>;
  composition: CompositionRegistry;
  render: Render;
  schemaOf(id: string): Promise<ObjectSchema | undefined>;
  /** A file as messages name it: never an absolute path. */
  shown(path: string): string;
}

const kebab = (k: string): string => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** The components a placement's values can name (`x-pd-component`), the placed one first. */
async function placementComponents(id: string, deps: PlacementDeps): Promise<string[]> {
  const seen = new Set<string>();
  const visit = async (componentId: string): Promise<void> => {
    if (seen.has(componentId)) return;
    seen.add(componentId);
    const walk = async (props: Record<string, PropertySchema> | undefined): Promise<void> => {
      for (const prop of Object.values(props ?? {})) {
        const named = prop["x-pd-component"] ?? prop.items?.["x-pd-component"];
        if (named) await visit(named);
        await walk(prop.properties);
        await walk(prop.items?.properties);
      }
    };
    await walk((await deps.schemaOf(componentId))?.properties);
  };
  await visit(id);
  return [...seen];
}

/** The names any schema of the placement declares `text/markdown`, at any depth. */
async function markdownNames(components: string[], deps: PlacementDeps): Promise<Set<string>> {
  const names = new Set<string>();
  const walk = (props: Record<string, PropertySchema> | undefined): void => {
    for (const [key, prop] of Object.entries(props ?? {})) {
      if (prop.contentMediaType === "text/markdown") names.add(key);
      walk(prop.properties);
      walk(prop.items?.properties);
    }
  };
  for (const id of components) walk((await deps.schemaOf(id))?.properties);
  return names;
}

/** Every unescaped output in the placement's templates that is not a `text/markdown` name. */
async function unsafeOutputs(id: string, at: PlacedProblem["at"], deps: PlacementDeps): Promise<PlacedProblem[]> {
  const components = await placementComponents(id, deps);
  const allowed = await markdownNames(components, deps);
  const templates = new Set(components.flatMap(c => includeTree(c, deps.composition)));
  const problems: PlacedProblem[] = [];
  for (const componentId of [...templates].sort()) {
    const file = deps.discoveryMap.get(componentId)?.hbsPath;
    if (!file) continue;
    const source = await designFiles(deps.discoveryMap).text(file).catch(() => "");
    for (const o of unescapedOutputs(source)) {
      if (!o.helper && allowed.has(o.name)) continue;
      const what = o.helper ? `a helper's result unescaped ({{{${o.name}}}})` : `"${o.name}" unescaped ({{{${o.name}}}})`;
      problems.push({ at, message: `${componentId} outputs ${what} at ${deps.shown(file)}:${o.line}:${o.column}, which only a text/markdown property may be` });
    }
  }
  return problems;
}

// Sample data. The renderer's data cascade puts a component's sample data beneath what it is given, and an
// included partial's beneath the context it is included with; objects merge key by key (lists replace).
// The null-fill (checkPlaced) covers every declared key, so what could still reach the page is a sample key
// the schema does not declare, at any depth of a declared object. So for each component of the placement,
// its own sample and that of every other template in its include tree may set only keys it declares. A
// partial reachable from two components is held to both.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function undeclaredSampleKeys(sample: Record<string, unknown>, props: Record<string, PropertySchema> | undefined, prefix: string): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(sample)) {
    const prop = props && Object.hasOwn(props, key) ? props[key] : undefined;
    if (!prop) { out.push(`${prefix}${key}`); continue; }
    if (isObject(value) && prop.properties) out.push(...undeclaredSampleKeys(value, prop.properties, `${prefix}${key}.`));
  }
  return out;
}

async function sampleDataProblems(id: string, at: PlacedProblem["at"], deps: PlacementDeps): Promise<PlacedProblem[]> {
  const components = await placementComponents(id, deps);
  const problems: PlacedProblem[] = [];
  for (const owner of components) {
    const declared = (await deps.schemaOf(owner))?.properties;
    for (const template of includeTree(owner, deps.composition)) {
      // Another component of the placement has its own context, checked as its own owner.
      if (template !== owner && components.includes(template)) continue;
      const jsonPath = deps.discoveryMap.get(template)?.jsonPath;
      if (!jsonPath) continue;
      let sample: unknown;
      try { sample = await designFiles(deps.discoveryMap).data(jsonPath); } catch { continue; } // reported as DATA_INVALID
      if (!isObject(sample)) continue;
      for (const key of undeclaredSampleKeys(sample, declared, "")) {
        problems.push({ at, message: `the sample data of ${template} (${basename(jsonPath)}) sets "${key}", which ${owner} does not declare, so it would show wherever ${owner} is placed` });
      }
    }
  }
  return problems;
}

/** A schema of the placement that misuses the placement extensions (the workbench shows the same, as
 *  SCHEMA_INVALID on that component): it cannot be placed. */
async function schemaProblems(id: string, at: PlacedProblem["at"], deps: PlacementDeps): Promise<PlacedProblem[]> {
  const problems: PlacedProblem[] = [];
  for (const component of await placementComponents(id, deps)) {
    const entry = deps.discoveryMap.get(component);
    const schemaPath = placementSchemaPath(component, deps.discoveryMap);
    if (!entry || !schemaPath) continue; // no schema: checkPlaced says it cannot be placed with values
    const template = entry.hbsPath ? await designFiles(deps.discoveryMap).text(entry.hbsPath).catch(() => undefined) : undefined;
    for (const p of checkSchemaExtensions(await deps.schemaOf(component), template, {
      componentExists: c => deps.discoveryMap.has(c),
      hasSchema: c => placementSchemaPath(c, deps.discoveryMap) !== undefined,
    })) {
      problems.push({ at, message: `${component} cannot be placed: its schema (${deps.shown(schemaPath)}, ${p.path}): ${p.message}` });
    }
    // A field named like a registered helper (the render's own check, schema-helper-names.ts): its value could
    // never show, so the component can't be placed, as a layout with one fails its pages.
    const rendered = await deps.render({ component }).catch(() => undefined);
    for (const d of rendered?.meta?.diagnostics ?? []) {
      if (d.kind !== "SCHEMA_INVALID" || !isHelperNameProblem(d.message)) continue;
      problems.push({ at, message: `${component} cannot be placed: its schema (${deps.shown(schemaPath)}, ${d.path ?? "#"}): ${d.message}` });
    }
  }
  return problems;
}

/** A placed block, rendered: its HTML (none when it has a problem), the region it asks for, and what asks. */
export interface PlacedResult {
  html?: string;
  problems: PlacedProblem[];
  /** The region its tag names (region="..."), else its component's default (x-pd-region); undefined for the body. */
  region?: string;
  /** How messages name where the region came from: the tag, or the component's default. */
  regionFrom?: string;
  /** A <pd-toc>: the page's table of contents. */
  toc?: boolean;
  /** A <pd-toc>'s #anchors, checked once the page's headings are final. */
  tocAnchors?: TocAnchor[];
}

/** A claimed `pd-` block: its HTML, or every problem (nothing is rendered when there is one). `headings`: the page's,
 *  for a <pd-toc>. */
export async function placeBlock(block: PlacedBlock, deps: PlacementDeps, page: { headings?: readonly PageHeading[] } = {}): Promise<PlacedResult> {
  const problems = [...block.problems];
  if (problems.length || !block.root) return { problems };
  // region="..." on the root tag is Pattern Dump's: where the component goes, never one of its values.
  const regionAttr = block.root.attrs.find(a => a.name === "region");
  const root = { ...block.root, attrs: block.root.attrs.filter(a => a.name !== "region") };
  if (regionAttr && (regionAttr.value === null || regionAttr.value === "")) {
    return { problems: [{ at: regionAttr.at, message: `<${block.root.name}>: region names a region of the layout, such as region="sidebar"` }] };
  }
  const tagRegion = regionAttr?.value ?? undefined;
  const fromTag = `<${block.root.name} region="${tagRegion}">`;
  if (block.root.name === TOC_TAG) return placeToc(block.root, deps, page.headings ?? [], tagRegion, fromTag);
  const resolver: PlacedResolver = {
    idOf: handle => deps.handleMap.get(handle),
    handleOf: id => [...deps.handleMap].find(([, v]) => v === id)?.[0] ?? id,
    handles: () => [...deps.handleMap.keys()],
    schemaOf: deps.schemaOf,
  };
  const { id, values } = await toPlaced(root, resolver, problems);
  if (!id || !values) return { problems };
  const schema = await deps.schemaOf(id);
  if (regionAttr && schema?.properties && Object.hasOwn(schema.properties, "region")) {
    return { problems: [{ at: regionAttr.at, message: `<${block.root.name}>: region="..." is Pattern Dump's (the layout's region the component goes into), `
      + `and ${id} declares a property "region" as well: rename that property to place it in a region` }] };
  }
  const own = defaultRegion(schema, id);
  if (own.problem) return { problems: [{ at: block.root.at, message: own.problem }] };
  const region = tagRegion ?? own.region;
  const regionFrom = tagRegion !== undefined ? fromTag : `<${block.root.name}> (${id}'s default region, x-pd-region)`;
  const broken = await schemaProblems(id, block.root.at, deps);
  if (broken.length) return { problems: [...problems, ...broken] };
  const checked = await checkPlaced(id, values, `<${block.root.name}>`, {
    schemaOf: deps.schemaOf,
    label: kebab,
    // Placed content is a storefront page's: its code blocks get their copy buttons from the page's script (code-blocks.ts).
    markdown: text => contentMd.render(text, { pdCodeBlocks: { storefront: true } }),
  });
  problems.push(...checked.problems, ...await unsafeOutputs(id, block.root.at, deps), ...await sampleDataProblems(id, block.root.at, deps));
  const where = region !== undefined ? { region, regionFrom } : {};
  if (problems.length) return { problems, ...where };
  // A placement that fails to render (an image that can't be served as variants, a helper that isn't registered)
  // is a problem of the page at the tag, listed and escaped like any other, never an unhandled 500.
  try {
    return { html: (await deps.render({ component: id, data: checked.value })).html, problems, ...where };
  } catch (e) {
    return { problems: [{ at: block.root.at, message: `<${block.root.name}>: ${e instanceof Error ? e.message : String(e)}` }] };
  }
}

/** The table of contents (toc.ts), placed with `items`: from the tag's links, or derived from the page's headings. */
export async function placeTocItems(items: TocItem[], at: PlacedProblem["at"], what: string, deps: PlacementDeps, tagRegion?: string, fromTag?: string): Promise<PlacedResult> {
  if (!deps.discoveryMap.has(TOC_ID)) {
    return { problems: [{ at, message: `${what} places the table of contents, which is the skin's ${TOC_ID}, and the skin has none: add it (it gets items: [{ text, href, level }])` }] };
  }
  const schema = await deps.schemaOf(TOC_ID);
  const problems: PlacedProblem[] = [];
  if (!schema?.properties?.["items"]) problems.push({ at, message: `${TOC_ID}: its schema declares no "items", the list of { text, href, level } it shows` });
  const own = defaultRegion(schema, TOC_ID);
  if (own.problem) problems.push({ at, message: own.problem });
  problems.push(...await unsafeOutputs(TOC_ID, at, deps), ...await sampleDataProblems(TOC_ID, at, deps));
  const region = tagRegion ?? own.region;
  const where = region !== undefined ? { region, regionFrom: tagRegion !== undefined ? fromTag! : `${what} (${TOC_ID}'s default region, x-pd-region)` } : {};
  if (problems.length) return { problems, toc: true, ...where };
  try {
    return { html: (await deps.render({ component: TOC_ID, data: { items } })).html, problems, toc: true, ...where };
  } catch (e) {
    return { problems: [{ at, message: `${TOC_ID}: ${e instanceof Error ? e.message : String(e)}` }], toc: true };
  }
}

async function placeToc(tag: PlacedTag, deps: PlacementDeps, headings: readonly PageHeading[], tagRegion: string | undefined, fromTag: string): Promise<PlacedResult> {
  const read = tocItems(tag, headings);
  if (read.problems.length) return { problems: read.problems, toc: true };
  return { ...await placeTocItems(read.items, tag.at, `<${TOC_TAG}>`, deps, tagRegion, fromTag), tocAnchors: read.anchors };
}
