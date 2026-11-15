// The one code-block rule for every markdown Pattern Dump renders: the workbench's docs, a storefront page's body, and
// the content of a component placed on a page. Every markdown-it instance is made here (createMarkdown), so each one
// writes a code block the same way, a fence and an indented block alike: highlighted when its language is one the
// highlighter knows, plain otherwise, always focusable (tabindex="0", so a block that scrolls sideways is reached by
// keyboard), with the copy button over it. A caller with fences of its own (markdown.ts: pattern, src-*) replaces the
// fence rule and falls back to codeBlock for every other fence.
//
// guard: test/code-blocks.spec.ts fails on a markdown-it instance made anywhere else.

import MarkdownIt from "markdown-it";
import { highlight, wrapWithCopyButton } from "@pattern-dump/renderer";

/** A code block: highlighted (or a plain, focusable <pre>), with the copy button carrying the raw code. */
export function codeBlock(code: string, lang: string): string {
  return wrapWithCopyButton(highlight(code, lang), code);
}

/** The language a fence names: its info string's first word ("bash" of "bash title=x"), or "". */
export const fenceLanguage = (info: string): string => info.trim().split(/\s+/)[0] ?? "";

/** A markdown-it instance with the code-block rule installed. */
export function createMarkdown(options: ConstructorParameters<typeof MarkdownIt>[0]): MarkdownIt {
  const md = new MarkdownIt(options);
  md.renderer.rules["fence"] = (tokens, idx) => `${codeBlock(tokens[idx]!.content, fenceLanguage(tokens[idx]!.info))}\n`;
  md.renderer.rules["code_block"] = (tokens, idx) => `${codeBlock(tokens[idx]!.content, "")}\n`;
  return md;
}
