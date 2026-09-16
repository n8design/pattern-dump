// Shiki-based syntax highlighter — render-time, class-based output, dual light/dark themes.
// M4.1: one shared highlighter + one shared transformerStyleToClass instance so CSS
// accumulates across all highlight() calls and getShikiCSS() returns the complete sheet.
// No inline style= on spans — all colours are class-referenced CSS variables.
import { createHighlighter, type Highlighter } from "shiki";
import { transformerStyleToClass } from "@shikijs/transformers";
import { mcmDark } from "./themes/mcm-dark.js";
import { monokaiLight } from "./themes/monokai-light.js";

// Fixed grammar set (bundle discipline).
const SUPPORTED_LANGS = [
  "handlebars", "html", "json", "scss", "css", "typescript", "javascript", "markdown",
] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

// Short aliases callers (and markdown fence info-strings) commonly use.
const LANG_ALIASES: Record<string, SupportedLang> = {
  hbs: "handlebars",
  ts:  "typescript",
  js:  "javascript",
  md:  "markdown",
};

const LANG_SET = new Set<string>([...SUPPORTED_LANGS, ...Object.keys(LANG_ALIASES)]);

let _highlighter: Highlighter | null = null;

// One shared transformer — accumulates the class→style mapping across all highlight() calls.
// getCSS() stays additive: once a token type is seen it never disappears.
const _transformer = transformerStyleToClass();

// ---- Public API ----

/** Initialise the shared Shiki highlighter. Idempotent — safe to call multiple times. */
export async function initHighlighter(): Promise<void> {
  if (_highlighter) return;
  _highlighter = await createHighlighter({
    // Custom pair: light = Monokai-Light-derived, dark = warm MCM. Dual-variable output via
    // defaultColor:false and the OS-bound @media switch are unchanged (drop-in theme objects).
    themes: [monokaiLight, mcmDark],
    langs: [...SUPPORTED_LANGS],
  });
  // Warm up: run a token-rich sample per grammar so transformerStyleToClass accumulates
  // all colour→class mappings before the first /assets/shiki.css request is served.
  // Single-char "x" only generates a couple of classes; real snippets hit keywords,
  // strings, comments, numbers, operators and punctuation.
  const WARMUP: Partial<Record<SupportedLang, string>> = {
    handlebars: `{{> header}}\n<div class="{{mod}}">\n{{#each items}}<span data-id="{{id}}">{{title}}</span>{{/each}}\n{{#if ok}}yes{{else}}no{{/if}}\n</div>`,
    typescript: `import { x } from "./y";\n// comment\nconst s: string = "hi";\ntype T = { n: number; ok: boolean };\nfunction f(a: number): T | null { return a > 0 ? { n: a, ok: true } : null; }`,
    scss: `.a { color: #fff; font-size: 1rem; &:hover { background: var(--c); } }\n@mixin m($v: 0) { margin: $v; }\n@media (max-width: 768px) { .a { display: none; } }`,
    json: `{"k":"v","n":42,"b":true,"x":null,"a":[1,"two",false]}`,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body class="c"><!-- note --><p data-x="1">hi</p></body></html>`,
  };
  for (const [lang, code] of Object.entries(WARMUP)) {
    _highlightRaw(code, lang);
  }
}

/**
 * Highlight `code` for `lang`. Returns class-based HTML with no inline style= attributes.
 * Unknown / unsupported lang → plain `<pre>`, never an error.
 * Must call initHighlighter() once before first use.
 */
export function highlight(code: string, lang: string): string {
  return _highlightRaw(code, lang);
}

/**
 * The one Shiki stylesheet both the source tab and the docs fences share.
 * Defines CSS variable pairs per class and applies them via prefers-color-scheme.
 * Serve this at `/assets/shiki.css`; the shell links it once in <head>.
 */
export function getShikiCSS(): string {
  const vars = _transformer.getCSS();
  // Base rules that wire the CSS variables to actual colour properties.
  // prefers-color-scheme: dark selects the dark palette — no JS, no sessionStorage.
  const base = [
    ".shiki{background-color:var(--shiki-light-bg);overflow-x:auto}",
    ".shiki code{display:block;padding:.75em 1em;font-family:monospace;font-size:1rem;line-height:1.6;white-space:pre;tab-size:2}",
    ".shiki span{color:var(--shiki-light)}",
    "@media(prefers-color-scheme:dark){",
    ".shiki{background-color:var(--shiki-dark-bg)}",
    ".shiki span{color:var(--shiki-dark)}",
    "}",
  ].join("");
  return vars + base;
}

/**
 * Wrap a highlighted block in a container that carries the raw source text.
 * The shell reads data-raw for the copy button — it never touches the highlighted markup.
 */
export function wrapWithCopyButton(highlightedHtml: string, rawCode: string): string {
  const escaped = rawCode.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<div class="shiki-container" data-raw="${escaped}"><button class="copy-btn" type="button" aria-label="Copy source">Copy</button>${highlightedHtml}</div>`;
}

// ---- Internal ----

function _highlightRaw(code: string, lang: string): string {
  const h = _highlighter;
  if (!h) return _plainPre(code);

  const resolved = (LANG_ALIASES[lang] ?? lang) as SupportedLang;
  if (!LANG_SET.has(lang) && !LANG_SET.has(resolved)) {
    return _plainPre(code); // unknown lang → graceful degradation
  }

  try {
    return h.codeToHtml(code, {
      lang: resolved,
      themes: { light: "pd-monokai-light", dark: "pd-mcm-dark" },
      defaultColor: false,
      transformers: [_transformer],
    });
  } catch {
    return _plainPre(code); // highlight failure → never propagates
  }
}

function _plainPre(code: string): string {
  const esc = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="shiki shiki-plain"><code>${esc}</code></pre>`;
}
