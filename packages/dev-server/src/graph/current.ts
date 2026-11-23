// The current graph of a running pd dev, kept under the inputs it was built from. Each input is a cache of its own
// that the watcher keeps current (discovery, the include graph, the style data, the page model), so a new object for
// any of them means something changed; the watch generation (server-state.ts) covers the files no input object
// stands for (a component's docs, assets.css). The graph is built again when any of them differs, never patched:
// building it is a walk over data the server already has.

import type { ProjectGraph } from "./build.js";

export interface GraphCache {
  /** The graph for `keys`: the one kept when every key is the same object (or value) as when it was built, else a
   *  new `build()`. Callers with the same keys share one build; a build that fails is not kept. */
  get(keys: readonly unknown[], build: () => Promise<ProjectGraph>): Promise<ProjectGraph>;
}

export function createGraphCache(): GraphCache {
  let held: { keys: readonly unknown[]; graph: Promise<ProjectGraph> } | null = null;
  const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);
  return {
    get(keys, build) {
      if (held && same(held.keys, keys)) return held.graph;
      const entry = { keys: [...keys], graph: build() };
      held = entry;
      entry.graph.catch(() => { if (held === entry) held = null; });
      return entry.graph;
    },
  };
}
