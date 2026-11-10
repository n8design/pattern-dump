// Heading anchors against the ids a page's layout already has.
//
// A heading's anchor is its slug (slug.ts), made before the layout renders, so it can't know the layout's
// ids: `## Main` is #main, and the base partial has <main id="main">. So after the layout renders, every
// id in the page is counted; an id a heading has that also occurs elsewhere is taken, and the body is
// rendered again with those ids given out already, so the heading gets the next free suffix (`main-1`).
// Same page, same suffix. Each suffix is a note, not an error.

import type { PageHeading } from "./derived.js";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decode = (v: string): string => v.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]!);

/** Every id attribute in `html`, in document order, repeats kept. Only inside tags, never in text. */
export function idsIn(html: string): string[] {
  const ids: string[] = [];
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const m of tag[0].matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      ids.push(decode(m[1] ?? m[2] ?? m[3] ?? ""));
    }
  }
  return ids;
}

/** The ids `html` has besides the headings' own: each heading's anchor counted out once. */
export function idsBesides(html: string, headings: readonly PageHeading[]): string[] {
  const count = new Map<string, number>();
  for (const id of idsIn(html)) count.set(id, (count.get(id) ?? 0) + 1);
  for (const h of headings) count.set(h.anchor, (count.get(h.anchor) ?? 0) - 1);
  return [...count].filter(([, n]) => n > 0).map(([id]) => id);
}

/** The headings whose anchor is one of `ids`. */
export const collidingHeadings = (headings: readonly PageHeading[], ids: readonly string[]): PageHeading[] =>
  headings.filter(h => ids.includes(h.anchor));
