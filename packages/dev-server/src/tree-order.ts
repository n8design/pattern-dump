// Sibling order in the component tree — and therefore in the Nav Rail and in folder overviews,
// which both follow the tree.
//
// One rank scale. Siblings sort by, highest precedence first:
//   1. Rank — a child's own numeric `order:` (a component's `.md`, or a folder's `index.md`), `0`
//      when it has none. Lower first: `order: -100` goes to the top, `order: 100` to the bottom.
//   2. Among equal ranks, the parent folder's `index.md` list — `order: [button, badge]` or a block
//      list. Named children in list order; `...` stands for every child the list does not name, and
//      without it those children follow the named ones. Unknown names are ignored.
//   3. Alphabetical by path segment, numeric-aware, so `item2` precedes `item10`.
//
// So a folder can place itself — first, last, anywhere — without its parent's list being edited,
// and a list orders everything that doesn't. A number always takes effect; no list can silence it.
// Roots are ordered the same way by `patterns/index.md`.

import type { FrontmatterValue } from "./frontmatter.js";

export type OrderSpec = { list: string[] } | { weight: number };

/** Interpret an `order:` frontmatter value: a number is a rank, anything else a list of names. */
export function parseOrder(value: FrontmatterValue | undefined): OrderSpec | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return { list: value };
  if (/^-?\d+(\.\d+)?$/.test(value)) return { weight: Number(value) };
  const list = value.split(",").map(s => s.trim()).filter(Boolean);
  return list.length ? { list } : undefined;
}

export interface Orderable {
  /** Last path segment — what a folder list names. */
  segment: string;
  /** The child's own `order:` rank; absent means 0. */
  weight?: number;
}

const collator = new Intl.Collator("en", { numeric: true });

/** In a folder list: every child the list does not name. */
export const REST = "...";

/** Sort siblings by the rule above. Stable, and total: ties fall back to a code-unit compare. */
export function orderSiblings<T extends Orderable>(items: T[], list?: string[]): T[] {
  const position = new Map<string, number>();
  list?.forEach((name, i) => { if (!position.has(name)) position.set(name, i); });
  // Children the list leaves out share one position: the rest marker's, or after everything.
  const restPosition = position.get(REST) ?? Infinity;
  const positionOf = (item: T): number => list ? (position.get(item.segment) ?? restPosition) : 0;

  return [...items].sort((a, b) => {
    const ra = a.weight ?? 0;
    const rb = b.weight ?? 0;
    if (ra !== rb) return ra - rb;
    const pa = positionOf(a);
    const pb = positionOf(b);
    if (pa !== pb) return pa - pb;
    return collator.compare(a.segment, b.segment) || (a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0);
  });
}
