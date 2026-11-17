// The storefront's layouts, by name: one index per discovery, which every place that asks "is this a layout, and
// which component is it" reads, instead of testing an id for the layouts/ prefix.
//
// A layout is either
//   - a base component directly under layouts/ (`layouts/article`): its folder makes it the layout "article"; or
//   - a pattern in pages/ or templates/ (order prefixes stripped: `04-templates` counts) whose schema sets
//     `"x-pd-layout": "<name>"` at its root (the renderer checks the value: readLayoutMarker).
// A page names a layout by name (`layout: article`, `childLayout`, `childDefaults.layout`), whichever kind it is.
//
// Problems, each on the component (its Diagnostics) and, for a name, on every page that asks for it:
//   - a marker on a pattern outside pages/ and templates/ (it makes no layout);
//   - a marker on a layouts/ component (its folder already names it);
//   - one name for two layouts (a clash): the name is no layout until one is renamed, never a silent winner.
// The index holds absolute paths; messages are written with the caller's display paths (`shown`).

import type { DiscoveryMap } from "@pattern-dump/contracts";
import { stripOrderPrefixes } from "@pattern-dump/discovery";
import { readLayoutMarker } from "@pattern-dump/renderer";
import { designFiles } from "./design-files.js";

/** The folders whose patterns may be marked as layouts. */
const MARKABLE = new Set(["pages", "templates"]);

export interface LayoutEntry {
  name: string;
  /** The component, e.g. "layouts/article" or "templates/article". */
  id: string;
  /** How it is a layout: by its folder (layouts/), or by x-pd-layout in its schema. */
  how: "folder" | "marker";
  /** The file that makes it one: its template (folder) or its schema (marker). Absolute. */
  file: string;
}

/** A component's own layout problem: a marker where none may be. */
interface MarkerProblem { id: string; file: string; kind: "outside" | "second-name"; name: string }

export interface LayoutIndex {
  /** The layouts a page can name, sorted (a clashing name is none). */
  readonly names: readonly string[];
  /** Whether `name` is a layout. */
  has(name: string): boolean;
  /** The component of the layout `name`, when it is one. */
  idOf(name: string): string | undefined;
  /** The layout name of component `id`, when it is a layout (a clashing one is none). */
  nameOf(id: string): string | undefined;
  /** Every layout, by name. */
  entries(): readonly LayoutEntry[];
  /** When `name` names two or more layouts: why it is none, naming each file. */
  clash(name: string, shown: (path: string) => string): string | undefined;
  /** Component `id`'s own layout problems (a misplaced marker, or its name clashing), with display paths. */
  problemsOf(id: string, shown: (path: string) => string): string[];
}

/** The layout index of a discovery: built once (design-files.ts), from the ids and the schemas' x-pd-layout. */
export function layoutIndex(discoveryMap: DiscoveryMap): Promise<LayoutIndex> {
  const files = designFiles(discoveryMap);
  return files.derived("layout index", async () => {
    const all: LayoutEntry[] = [];
    const misplaced: MarkerProblem[] = [];
    for (const [id, entry] of [...discoveryMap].sort(([a], [b]) => a < b ? -1 : 1)) {
      if (id.includes("~")) continue;
      const byFolder = /^layouts\/[^/~]+$/.test(id);
      if (byFolder) all.push({ name: id.slice("layouts/".length), id, how: "folder", file: entry.hbsPath });
      if (!entry.schemaPath) continue;
      const marker = readLayoutMarker((await files.schema(entry.schemaPath)).schema).name;
      if (marker === undefined) continue;
      if (byFolder) misplaced.push({ id, file: entry.schemaPath, kind: "second-name", name: marker });
      else if (MARKABLE.has(stripOrderPrefixes(id.split("/")[0]!))) all.push({ name: marker, id, how: "marker", file: entry.schemaPath });
      else misplaced.push({ id, file: entry.schemaPath, kind: "outside", name: marker });
    }
    const byName = new Map<string, LayoutEntry[]>();
    for (const e of all) byName.set(e.name, [...byName.get(e.name) ?? [], e]);
    const single = new Map([...byName].filter(([, es]) => es.length === 1).map(([n, es]) => [n, es[0]!]));
    const clashes = new Map([...byName].filter(([, es]) => es.length > 1));
    const names = [...single.keys()].sort();
    const describe = (e: LayoutEntry, shown: (p: string) => string) =>
      `${shown(e.file)} (${e.how === "marker" ? "x-pd-layout" : "a layouts/ folder"})`;
    const clash = (name: string, shown: (p: string) => string): string | undefined => {
      const es = clashes.get(name);
      if (!es) return undefined;
      return `layout "${name}" is set ${es.length === 2 ? "twice" : `${es.length} times`}: ${es.map(e => describe(e, shown)).join(" and ")}: rename one`;
    };
    return {
      names,
      has: name => single.has(name),
      idOf: name => single.get(name)?.id,
      nameOf: id => [...single.values()].find(e => e.id === id)?.name,
      entries: () => [...single.values()],
      clash,
      problemsOf: (id, shown) => {
        const out: string[] = [];
        for (const m of misplaced.filter(p => p.id === id)) {
          out.push(m.kind === "outside"
            ? `x-pd-layout makes a page or template pattern a layout; ${id} is in neither pages/ nor templates/, so it is no layout: move it there, or include it in one that is`
            : `${id} is the layout "${id.slice("layouts/".length)}" by its folder, and x-pd-layout would give it a second name ("${m.name}"): remove x-pd-layout`);
        }
        for (const [name, es] of clashes) if (es.some(e => e.id === id)) out.push(clash(name, shown)!);
        return out;
      },
    } satisfies LayoutIndex;
  });
}
