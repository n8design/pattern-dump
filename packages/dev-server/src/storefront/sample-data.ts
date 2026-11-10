// A layout's sample data, checked so that none of it can reach a real page.
//
// Sample data is what the workbench previews a layout and its partials with. The renderer's data
// cascade puts a component's sample data beneath what it is given — the layout's beneath the page's
// values, and each included partial's beneath the context it is included with. A page's context always
// carries every key the layout declares (null where the page sets none), plus body, nav and site; so a
// sample key outside those would render on every page using the layout. Inside `site`, an object that
// merges key by key, the same holds for each key partials/base does not declare for it. `page` is there
// only when the layout declares it, with only the sub-keys it declares; below them, its shape is
// Pattern Dump's (derived.ts), and every key outside it, at any depth, is refused too.
//
// So every sample file in a layout's include tree — the layout's own and each partial it includes,
// however deep — may only use those keys. Anything else is a problem, fatal to every page using the
// layout. (A variant's data is not checked: a page renders a layout's base, never a variant.)

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "../composition.js";
import { ASSEMBLY_KEYS } from "./frontmatter-contract.js";
import { outsideShape, PAGE_SHAPE } from "./derived.js";
import { SITE_SCHEMA_OWNER } from "./site.js";

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The layout and every component it includes, however deep, in a stable order. */
export function includeTree(layoutId: string, composition: CompositionRegistry): string[] {
  const seen = new Set<string>([layoutId]);
  const queue = [layoutId];
  while (queue.length) {
    for (const child of composition.uses.get(queue.shift()!) ?? []) {
      if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
  }
  return [layoutId, ...[...seen].filter(id => id !== layoutId).sort()];
}

export async function checkSampleData(
  layoutId: string,
  discoveryMap: DiscoveryMap,
  composition: CompositionRegistry,
  layoutDeclared: string[],
  siteDeclared: string[],
  /** The sub-keys of `page` the layout declares; undefined when it does not declare `page`. */
  pageDeclared?: string[],
): Promise<string[]> {
  const problems: string[] = [];
  const allowed = new Set<string>([...layoutDeclared, ...ASSEMBLY_KEYS].filter(k => k !== "page" || pageDeclared !== undefined));
  const shapeFields: Record<string, unknown> = PAGE_SHAPE.fields;
  for (const id of includeTree(layoutId, composition)) {
    const jsonPath = discoveryMap.get(id)?.jsonPath;
    if (!jsonPath) continue;
    const where = `the sample data of ${id} (${basename(jsonPath)})`;
    let data: unknown;
    try { data = JSON.parse(await readFile(jsonPath, "utf8")); }
    catch (e) { problems.push(`${where} cannot be read: ${e instanceof Error ? e.message : String(e)}`); continue; }
    if (!isPlainObject(data)) continue;
    for (const [key, value] of Object.entries(data)) {
      if (!allowed.has(key)) {
        problems.push(`${where} sets "${key}", which ${layoutId} does not declare, so it would show on every page using that layout`);
        continue;
      }
      if (key === "page" && isPlainObject(value)) {
        for (const [sub, v] of Object.entries(value)) {
          const outside = Object.hasOwn(shapeFields, sub)
            ? (pageDeclared ?? []).includes(sub) ? outsideShape(v, PAGE_SHAPE.fields[sub as keyof typeof PAGE_SHAPE.fields], `page.${sub}`) : undefined
            : [`page.${sub}`];
          if (outside === undefined) {
            problems.push(`${where} sets "page.${sub}", which ${layoutId} does not declare for page, so it would show on every page using that layout`);
            continue;
          }
          for (const at of outside) {
            problems.push(`${where} sets "${at}", which is not part of the page data Pattern Dump fills, so it would show on every page using ${layoutId}`);
          }
        }
      }
      if (key === "site" && isPlainObject(value)) {
        for (const sub of Object.keys(value)) {
          if (!siteDeclared.includes(sub)) {
            problems.push(`${where} sets "site.${sub}", which ${SITE_SCHEMA_OWNER} does not declare for site, so it would show on every page using ${layoutId}`);
          }
        }
      }
    }
  }
  return problems;
}
