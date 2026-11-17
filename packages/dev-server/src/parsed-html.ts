// A page's HTML parsed once for the checks that read it as a tree: the classes it wears (css-closure.ts, for its
// stylesheets) and its images (image-checks.ts) both parsed the same rendered page. The last parse is kept, by the
// HTML's text, so the second asks for the tree the first made; a different text is parsed anew. Readers only query
// the tree, never change it.
import { parse, type HTMLElement } from "node-html-parser";

let last: { html: string; root: HTMLElement } | undefined;

/** `html` parsed with node-html-parser's defaults; the same tree for the same text as the last call. */
export function parsedHtml(html: string): HTMLElement {
  if (last?.html === html) return last.root;
  const root = parse(html);
  last = { html, root };
  return root;
}
