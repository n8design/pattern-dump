// The one code-block rule for every markdown Pattern Dump renders: the workbench's docs, a storefront page's body, and
// the content of a component placed on a page. Every markdown-it instance is made here (createMarkdown), so each one
// has the same syntax (definition lists, markdown-it-deflist: `term` then `: definition`, plain <dl>/<dt>/<dd>) and
// writes a code block the same way, a fence and an indented block alike: highlighted when its language is one the
// highlighter knows, plain otherwise, always focusable (tabindex="0", so a block that scrolls sideways is reached by
// keyboard), with the copy button over it. A caller with fences of its own (markdown.ts: pattern, src-*) replaces the
// fence rule and falls back to codeBlock for every other fence.
//
// guard: test/code-blocks.spec.ts fails on a markdown-it instance made anywhere else.

import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";
import { highlight, wrapWithCopyButton } from "@pattern-dump/renderer";

/** Where a code block is written. On a storefront page it has no copy button in its markup: the page's script
 *  (page.ts copyScript) adds one where the browser can copy, so without scripting or a clipboard there is none, and
 *  no skin's CSS can show one that does nothing. The workbench's shell has its own handler. */
export interface CodeBlockPlace { storefront?: boolean }

/** A code block: highlighted (or a plain, focusable <pre>), with the copy button carrying the raw code. */
export function codeBlock(code: string, lang: string, place: CodeBlockPlace = {}): string {
  return wrapWithCopyButton(highlight(code, lang), code, { button: place.storefront !== true });
}

/** The language a fence names: its info string's first word ("bash" of "bash title=x"), or "". */
export const fenceLanguage = (info: string): string => info.trim().split(/\s+/)[0] ?? "";

/** Where a render's code blocks go: markdown-it's env, `{ pdCodeBlocks: { storefront: true } }`. */
export const placeOf = (env: unknown): CodeBlockPlace => (env as { pdCodeBlocks?: CodeBlockPlace } | undefined)?.pdCodeBlocks ?? {};

/** A markdown-it instance with definition lists and the code-block rule installed. */
export function createMarkdown(options: ConstructorParameters<typeof MarkdownIt>[0]): MarkdownIt {
  const md = new MarkdownIt(options).use(deflist);
  md.renderer.rules["fence"] = (tokens, idx, _o, env) => `${codeBlock(tokens[idx]!.content, fenceLanguage(tokens[idx]!.info), placeOf(env))}\n`;
  md.renderer.rules["code_block"] = (tokens, idx, _o, env) => `${codeBlock(tokens[idx]!.content, "", placeOf(env))}\n`;
  return md;
}
