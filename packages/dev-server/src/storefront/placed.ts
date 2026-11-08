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

import { readFile } from "node:fs/promises";
import MarkdownIt from "markdown-it";
import type { DiscoveryMap, Render } from "@pattern-dump/contracts";
import { unescapedOutputs } from "@pattern-dump/renderer";
import type { CompositionRegistry } from "../composition.js";
import { toPlaced, type PlacedBlock, type PlacedResolver } from "../placed-tags.js";
import { checkPlaced, type ObjectSchema, type PlacedProblem, type PropertySchema } from "./declared-values.js";
import { includeTree } from "./sample-data.js";

/** Content markdown: block markdown, HTML escaped (html: false), markdown-it's link check. */
const contentMd = new MarkdownIt({ html: false, linkify: false });

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
    const source = await readFile(file, "utf8").catch(() => "");
    for (const o of unescapedOutputs(source)) {
      if (!o.helper && allowed.has(o.name)) continue;
      const what = o.helper ? `a helper's result unescaped ({{{${o.name}}}})` : `"${o.name}" unescaped ({{{${o.name}}}})`;
      problems.push({ at, message: `${componentId} outputs ${what} at ${deps.shown(file)}:${o.line}:${o.column}, which only a text/markdown property may be` });
    }
  }
  return problems;
}

/** A claimed `pd-` block: its HTML, or every problem (nothing is rendered when there is one). */
export async function placeBlock(block: PlacedBlock, deps: PlacementDeps): Promise<{ html?: string; problems: PlacedProblem[] }> {
  const problems = [...block.problems];
  if (problems.length || !block.root) return { problems };
  const resolver: PlacedResolver = {
    idOf: handle => deps.handleMap.get(handle),
    handleOf: id => [...deps.handleMap].find(([, v]) => v === id)?.[0] ?? id,
    handles: () => [...deps.handleMap.keys()],
    schemaOf: deps.schemaOf,
  };
  const { id, values } = await toPlaced(block.root, resolver, problems);
  if (!id || !values) return { problems };
  const checked = await checkPlaced(id, values, `<${block.root.name}>`, {
    schemaOf: deps.schemaOf,
    label: kebab,
    markdown: text => contentMd.render(text),
  });
  problems.push(...checked.problems, ...await unsafeOutputs(id, block.root.at, deps));
  if (problems.length) return { problems };
  return { html: (await deps.render({ component: id, data: checked.value })).html, problems };
}
