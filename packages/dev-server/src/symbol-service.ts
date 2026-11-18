// The server's symbol images (symbols.ts): the index every storefront page and the standalone route read, and what
// it has to say. In pd dev each warning (content removed from a source) and each symbol hidden by one of the same
// name in an earlier asset root is said once in the terminal, the first time the index finds it, as a component that
// overrides a package's of the same handle is. pd build asks for all of it at once (report) for its build report.

import { createSymbolIndexer, type SymbolIndex } from "./symbols.js";

export interface SymbolReport {
  /** Every symbol that can be used, by stem, in name order. */
  stems: string[];
  /** A source that can't be used, one line each: the build fails on these. */
  problems: string[];
  /** What was removed from a source, one line per file. */
  warnings: string[];
  /** A source hidden by one of the same name in an earlier asset root. */
  infos: string[];
}

export interface SymbolService {
  index(): Promise<SymbolIndex>;
  report(): Promise<SymbolReport>;
}

export function createSymbolService(o: {
  assetRoots: readonly string[]; live: boolean; shown: (path: string) => string;
}): SymbolService {
  const indexer = createSymbolIndexer();
  const said = new Set<string>();
  const lines = (index: SymbolIndex): SymbolReport => {
    const all = [...index.entries.keys()].sort();
    const stems = all.filter(stem => index.entries.get(stem)!.ok);
    const problems: string[] = [], warnings: string[] = [];
    for (const stem of all) {
      const e = index.entries.get(stem)!;
      if (!e.ok) problems.push(`${o.shown(e.problem.file)}: ${e.problem.problems.join("; ")}`);
      else if (e.source.warning) warnings.push(`${o.shown(e.source.file)}: ${e.source.warning}`);
    }
    const infos = index.shadowed.map(s => `${o.shown(s.by)} overrides ${o.shown(s.file)}, a symbol of the same name ("${s.stem}")`);
    return { stems, problems, warnings, infos };
  };
  return {
    async index() {
      const index = await indexer.index(o.assetRoots);
      if (o.live) {
        const r = lines(index);
        for (const w of r.warnings) if (!said.has(w)) { said.add(w); console.warn(`[dev-server] ${w}`); }
        for (const i of r.infos) if (!said.has(i)) { said.add(i); console.log(`[dev-server] ${i}`); }
      }
      return index;
    },
    async report() {
      return lines(await indexer.index(o.assetRoots, { fresh: true }));
    },
  };
}
