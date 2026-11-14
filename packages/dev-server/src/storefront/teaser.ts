// A listing's fallback description: the first paragraph of a page's markdown body that has any text, as plain
// text. Links keep their text, emphasis and code lose their markup, an image's alt text and everything inside a
// `pd-` tag are left out (a paragraph that is only an image or a placed component is skipped), whitespace collapses
// to single spaces, and the result is trimmed. It is never shortened: a skin limits it in CSS (line-clamp).
//
// Every page without a description is read on every request for the page list, so the result is cached by a hash
// of the body's text: an edit is a new key, so a changed first paragraph is never answered from the cache.

import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";

// html on, so a pd- tag is an html token to skip, not text.
const md = new MarkdownIt({ html: true, linkify: false });

type Token = ReturnType<MarkdownIt["parse"]>[number];

function plainText(children: Token[]): string {
  let depth = 0;
  let out = "";
  for (const t of children) {
    if (t.type === "html_inline") {
      if (/^<pd-[a-z0-9-]+(?:\s[^>]*)?(?<!\/)>$/i.test(t.content.trim())) depth++;
      else if (/^<\/pd-/i.test(t.content.trim()) && depth > 0) depth--;
      continue;
    }
    if (depth > 0) continue;
    if (t.type === "text" || t.type === "code_inline") out += t.content;
    else if (t.type === "softbreak" || t.type === "hardbreak") out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The first paragraph of `body` (markdown, without its frontmatter) with any text, or null. */
export function firstParagraph(body: string): string | null {
  const tokens = md.parse(body, {});
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== "paragraph_open") continue;
    const text = plainText(tokens[i + 1]?.children ?? []);
    if (text !== "") return text;
  }
  return null;
}

const cache = new Map<string, string | null>();
const LIMIT = 10_000;
/** Parses run, for tests: a cached body adds none. */
export const teaserStats = { parses: 0 };

/** firstParagraph, cached by a hash of `body`. */
export function teaserOf(body: string): string | null {
  const key = createHash("sha256").update(body).digest("hex");
  if (cache.has(key)) return cache.get(key)!;
  teaserStats.parses++;
  const value = firstParagraph(body);
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
