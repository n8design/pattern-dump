// The table of contents: the skin's components/toc, placed with its items.
//
//   - `toc: true` in a page's frontmatter, or `x-pd-toc` on its layout's page.regions (regions.ts), places it with the
//     derived items: the page's headings of level 2 and 3. `toc: false` keeps it out. A page with no such heading gets
//     none.
//   - `<pd-toc>` in a page's markdown places it where the tag is (or in its region): with no content, the derived
//     items; with content, the links it lists, a markdown list whose nesting gives the level:
//
//       <pd-toc>
//       - [Install](#install)
//         - [Options](#options)
//       </pd-toc>
//
//     An item is one link and nothing else. An `#anchor` must be a heading of the page; any other link is the link
//     check's, as on any page. A page with a <pd-toc> gets no derived one besides.
//   - The component gets `items: [{ text, href, level }]` and goes where its schema's x-pd-region says.

import { suggest } from "@pattern-dump/config";
import { createMarkdown } from "../code-blocks.js";
import type { PlacedTag } from "../placed-tags.js";
import type { PlacedProblem } from "./declared-values.js";
import type { PageHeading } from "./derived.js";

/** The skin's table of contents. */
export const TOC_ID = "components/toc";
/** Its tag in a page's markdown. */
export const TOC_TAG = "pd-toc";

export interface TocItem { text: string; href: string; level: number }

/** The derived items: the headings of level 2 and 3. */
export function derivedToc(headings: readonly PageHeading[]): TocItem[] {
  return headings.filter(h => h.level === 2 || h.level === 3).map(h => ({ text: h.text, href: `#${h.anchor}`, level: h.level }));
}

const md = createMarkdown({ html: false, linkify: false });

/** An #anchor a <pd-toc> links to, where it is written: checked once the page's anchors are final (tocAnchorProblems). */
export interface TocAnchor { anchor: string; href: string; at: PlacedProblem["at"] }

/** A <pd-toc>'s items: the derived ones without content, else the links its content lists, each one link; its
 *  #anchors are returned to be checked against the page's final headings (a heading's anchor can still be suffixed). */
export function tocItems(tag: PlacedTag, headings: readonly PageHeading[]): { items: TocItem[]; problems: PlacedProblem[]; anchors: TocAnchor[] } {
  const anchorsUsed: TocAnchor[] = [];
  const problems: PlacedProblem[] = [];
  for (const a of tag.attrs) if (a.name !== "region") problems.push({ at: a.at, message: `<${TOC_TAG}> takes no "${a.name}": only region, and its links as content` });
  if (tag.children.length) problems.push({ at: tag.children[0]!.at, message: `<${TOC_TAG}> holds a list of links, not <${tag.children[0]!.name}>` });
  const text = tag.text.map(t => t.s).join("");
  if (!text.trim()) return { items: derivedToc(headings), problems, anchors: anchorsUsed };
  const lines = text.split("\n");
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => /^ */.exec(l)![0].length));
  const tokens = md.parse(lines.map(l => l.slice(indent)).join("\n"), {});
  const first = tag.text[0]!.at.line;
  const at = (map: [number, number] | null | undefined): PlacedProblem["at"] => ({ line: first + (map?.[0] ?? 0), column: indent + 1 });
  const items: TocItem[] = [];
  let depth = 0;
  for (const [i, t] of tokens.entries()) {
    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") { depth++; continue; }
    if (t.type === "bullet_list_close" || t.type === "ordered_list_close") { depth--; continue; }
    if (depth === 0 && t.block && t.level === 0 && t.nesting !== -1) {
      problems.push({ at: at(t.map), message: `<${TOC_TAG}>'s content is a list of links, such as "- [Install](#install)"` });
      break;
    }
    if (t.type !== "inline" || tokens[i - 1]?.type !== "paragraph_open") continue;
    const kids = t.children ?? [];
    const open = kids[0], close = kids.at(-1);
    const oneLink = open?.type === "link_open" && close?.type === "link_close" && kids.filter(k => k.type === "link_open").length === 1;
    if (!oneLink) { problems.push({ at: at(t.map), message: `<${TOC_TAG}>: "${t.content}" is not one link: write each item as "[text](#anchor)"` }); continue; }
    const href = open.attrGet("href") ?? "";
    const label = kids.slice(1, -1).map(k => k.content).join("");
    if (href.startsWith("#")) anchorsUsed.push({ anchor: decodeURIComponent(href.slice(1)), href, at: at(t.map) });
    items.push({ text: label, href, level: depth + 1 });
  }
  return { items, problems, anchors: anchorsUsed };
}

/** Each #anchor a <pd-toc> links to that is no heading of the page, with a "did you mean". */
export function tocAnchorProblems(used: readonly TocAnchor[], headings: readonly PageHeading[]): PlacedProblem[] {
  const anchors = headings.map(h => h.anchor);
  return used.filter(u => !anchors.includes(u.anchor)).map(u => {
    const near = suggest(u.anchor, anchors);
    return { at: u.at, message: `<${TOC_TAG}>: ${u.href} is no heading of this page`
      + (near ? `: did you mean "#${near}"?` : anchors.length ? ` (its headings are ${anchors.map(a => `#${a}`).join(", ")})` : " (it has no headings)") };
  });
}
