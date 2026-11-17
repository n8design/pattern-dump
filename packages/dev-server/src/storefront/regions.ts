// Regions: named places in a layout, besides the body, that a page's placed components can go into.
//
//   - A layout declares them on page.regions: `"regions": { "x-pd-regions": ["sidebar"], "x-pd-toc": true }`, and
//     writes each as `{{{page.regions.sidebar}}}`: its HTML, or null when the page puts nothing there, so `{{#if}}` can
//     leave the element out. `x-pd-toc` shows the table of contents on its pages (toc.ts) unless a page says
//     `toc: false`. A page whose layout declares regions says which hold something on its <body>:
//     `data-pd-regions="sidebar"`, so a skin can switch its grid without :has().
//   - A component names its default region at its schema's root (`"x-pd-region": "sidebar"`); `region="sidebar"` on a
//     placed root tag wins over it. In a region, components keep the page's order.
//   - A region another layout of the skin has, and this one doesn't, is left out without a message: some layouts have
//     a sidebar, some don't. A region no layout has is a typo, and the page fails with a "did you mean".
//   - The landmarks outside the content are the layout's own: header, footer, nav and main can't be regions (RESERVED),
//     and a region's content can't bring a main, banner or contentinfo of its own.

import { suggest } from "@pattern-dump/config";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { readSchema } from "./declared-values.js";
import { designFiles } from "./design-files.js";

/** The layout's own landmarks: never a region a page can fill. One list, to be opened up deliberately. */
export const RESERVED_REGIONS: readonly string[] = ["header", "footer", "nav", "main"];

/** The page sub-key that holds a layout's regions. */
export const REGIONS_KEY = "regions";
const NAME = /^[a-z][a-z0-9-]*$/;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a layout declares on page.regions. */
export interface LayoutRegions {
  /** Its regions, in its order; empty when it declares none. */
  regions: string[];
  /** Whether its pages show the table of contents by default (x-pd-toc). */
  toc: boolean;
  problems: string[];
}

/** page.regions of a layout's schema (`schema`), read; `layoutId` names it in messages. */
export function layoutRegions(schema: unknown, layoutId: string): LayoutRegions {
  const page = isObject(schema) && isObject(schema["properties"]) ? (schema["properties"] as Obj)["page"] : undefined;
  const declared = isObject(page) && isObject(page["properties"]) ? (page["properties"] as Obj)[REGIONS_KEY] : undefined;
  if (declared === undefined) return { regions: [], toc: false, problems: [] };
  const at = `${layoutId} (page.${REGIONS_KEY})`;
  if (!isObject(declared)) return { regions: [], toc: false, problems: [`${at}: declare the layout's regions as { "x-pd-regions": ["sidebar"] }`] };
  const problems: string[] = [];
  const list = declared["x-pd-regions"];
  const regions: string[] = [];
  if (!Array.isArray(list) || list.some(r => typeof r !== "string")) {
    problems.push(`${at}: "x-pd-regions" is a list of region names, such as ["sidebar"]`);
  } else {
    for (const name of list as string[]) {
      if (RESERVED_REGIONS.includes(name)) problems.push(`${at}: ${name} is reserved for the layout's own landmark: write it in the layout, and name the region otherwise`);
      else if (!NAME.test(name)) problems.push(`${at}: "${name}" is not a region name: lowercase letters, digits and hyphens, starting with a letter`);
      else if (regions.includes(name)) problems.push(`${at}: "${name}" is listed twice`);
      else regions.push(name);
    }
  }
  const toc = declared["x-pd-toc"];
  if (toc !== undefined && typeof toc !== "boolean") problems.push(`${at}: "x-pd-toc" is true or false`);
  const other = Object.keys(declared).filter(k => k !== "x-pd-regions" && k !== "x-pd-toc" && k !== "description");
  if (other.length) problems.push(`${at}: ${other.map(k => `"${k}"`).join(", ")}: page.${REGIONS_KEY} declares only "x-pd-regions" and "x-pd-toc" (the regions' shape is Pattern Dump's)`);
  return { regions, toc: toc === true, problems };
}

/** Every region a layout of the skin declares, with the layouts that have it. */
export async function skinRegions(discoveryMap: DiscoveryMap): Promise<ReadonlyMap<string, string[]>> {
  // From the layouts' schemas alone: once per discovery (design-files.ts).
  const files = designFiles(discoveryMap);
  return files.derived("skin regions", async () => {
    const out = new Map<string, string[]>();
    for (const [id, entry] of [...discoveryMap].sort(([a], [b]) => a < b ? -1 : 1)) {
      if (!/^layouts\/[^/~]+$/.test(id)) continue;
      for (const r of layoutRegions((await readSchema(entry.schemaPath, files)).schema, id).regions) out.set(r, [...out.get(r) ?? [], id]);
    }
    return out;
  });
}

/** Where a placed component goes: the body, a region of the page's layout, or nowhere (another layout's region). */
export type RegionChoice = { to: "body" } | { to: "region"; region: string } | { to: "none" } | { to: "problem"; message: string };

/** Where `name` (a tag's region, else the component's default; undefined for neither) puts a component on a page
 *  whose layout is `layoutId` with `regions`, in a skin whose layouts have `skin`. `what` names the tag or default. */
export function chooseRegion(name: string | undefined, what: string, layoutId: string, regions: readonly string[], skin: ReadonlyMap<string, string[]>): RegionChoice {
  if (name === undefined) return { to: "body" };
  const offers = regions.length ? `${layoutId} offers ${regions.map(r => `"${r}"`).join(", ")}` : `${layoutId} has no regions`;
  if (RESERVED_REGIONS.includes(name)) {
    return { to: "problem", message: `${what}: the ${name} belongs to the layout, so no component goes into it (${offers})` };
  }
  if (regions.includes(name)) return { to: "region", region: name };
  if (skin.has(name)) return { to: "none" };
  const known = [...skin.keys()].sort();
  const near = suggest(name, known);
  return { to: "problem", message: `${what}: region "${name}" is no layout's region${near ? `: did you mean "${near}"?` : ""} `
    + `(${known.length ? `the skin's regions are ${known.map(r => `"${r}"`).join(", ")}` : "the skin's layouts declare none"})` };
}

/** The region names a component's schema gives as its default (`x-pd-region`), or a problem. */
export function defaultRegion(schema: unknown, componentId: string): { region?: string; problem?: string } {
  if (!isObject(schema) || schema["x-pd-region"] === undefined) return {};
  const r = schema["x-pd-region"];
  return typeof r === "string" ? { region: r } : { problem: `${componentId}: "x-pd-region" is a region's name, such as "sidebar"` };
}

const SECTIONING = new Set(["article", "aside", "nav", "section"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The landmarks `html` (a region's content) would bring to the page: a main, a banner or a contentinfo. */
export function regionLandmarks(html: string): string[] {
  const found: string[] = [];
  const open: string[] = [];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, close, rawName, attrs] = m;
    const name = rawName!.toLowerCase();
    if (close) { const i = open.lastIndexOf(name); if (i >= 0) open.length = i; continue; }
    const role = /\srole\s*=\s*["']?([a-z]+)/i.exec(attrs!)?.[1]?.toLowerCase();
    const scoped = open.some(t => SECTIONING.has(t));
    if (name === "main" || role === "main") found.push("a main landmark");
    else if (role === "banner" || (name === "header" && !scoped && role === undefined)) found.push("a banner (a <header> outside article, aside, nav and section)");
    else if (role === "contentinfo" || (name === "footer" && !scoped && role === undefined)) found.push("a contentinfo (a <footer> outside article, aside, nav and section)");
    if (!VOID.has(name) && !/\/\s*$/.test(attrs!)) open.push(name);
  }
  return [...new Set(found)];
}
