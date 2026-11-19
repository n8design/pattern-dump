// Shiki-based syntax highlighter: render-time, class-based output, light and dark.
// Each token is highlighted with both of PD's themes, then named by the kind its two colours stand for
// (`pd-code-keyword`): a fixed class per kind, coloured by a custom property of the same name (--pd-code-keyword)
// in /_pd/code.css (getCodeCSS). PD's colours are the properties' defaults, in their own cascade layer, so a site
// sets every kind from its own tokens and any rule of its wins. No inline style= on spans.
import { createHighlighter, type Highlighter, type ShikiTransformer } from "shiki";
import { mcmDark, mcmDarkPalette } from "./themes/mcm-dark.js";
import { monokaiLight, monokaiLightPalette } from "./themes/monokai-light.js";

// Fixed grammar set (bundle discipline). Shell: `shellscript` for scripts and commands, `shellsession` for a prompt
// with its output. `text` (and any other name) stays a plain block on purpose.
const SUPPORTED_LANGS = [
  "handlebars", "html", "json", "scss", "css", "typescript", "javascript", "markdown", "shellscript", "shellsession",
] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

// Short aliases callers (and markdown fence info-strings) commonly use.
const LANG_ALIASES: Record<string, SupportedLang> = {
  hbs: "handlebars",
  ts:  "typescript",
  js:  "javascript",
  md:  "markdown",
  bash: "shellscript",
  sh: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  console: "shellsession",
  "shell-session": "shellsession",
};

const LANG_SET = new Set<string>([...SUPPORTED_LANGS, ...Object.keys(LANG_ALIASES)]);

let _highlighter: Highlighter | null = null;

// ---- Public API ----

/** Initialise the shared Shiki highlighter. Idempotent — safe to call multiple times. */
export async function initHighlighter(): Promise<void> {
  if (_highlighter) return;
  _highlighter = await createHighlighter({
    // Custom pair: light = Monokai-Light-derived, dark = warm MCM. Both colour every token (defaultColor: false);
    // kindClasses turns the two into the token's kind.
    themes: [monokaiLight, mcmDark],
    langs: [...SUPPORTED_LANGS],
  });
}

/**
 * Highlight `code` for `lang`. Returns class-based HTML with no inline style= attributes.
 * Unknown / unsupported lang → plain `<pre>`, never an error.
 * Must call initHighlighter() once before first use.
 */
export function highlight(code: string, lang: string): string {
  return _highlightRaw(code, lang);
}

/** The kinds of token a code block names, each a class `pd-code-<kind>` and a custom property `--pd-code-<kind>`.
 *  `text` is the block's own colour: its tokens carry no class. */
export const CODE_KINDS = [
  "text", "comment", "string", "keyword", "storage", "constant", "value", "tag", "attribute", "function", "support",
  "property", "parameter", "expression",
] as const;
export type CodeKind = typeof CODE_KINDS[number];

type LightIntent = keyof typeof monokaiLightPalette;
type DarkIntent = Exclude<keyof typeof mcmDarkPalette, "background">;

/** Each kind as the intents it has in PD's light and dark themes: its default colours. */
const KIND_INTENTS: Record<CodeKind, [LightIntent, DarkIntent]> = {
  text: ["base", "base"],
  comment: ["comment", "comment"],
  string: ["string", "string"],
  keyword: ["keyword", "keyword"],
  storage: ["support", "keyword"],    // const, function, interface
  constant: ["constant", "constant"],
  value: ["support", "constant"],     // CSS keyword values: auto, none, system-ui
  tag: ["keyword", "tag"],
  attribute: ["name", "attr"],
  function: ["name", "base"],
  support: ["support", "base"],       // CSS property names, built-in types
  property: ["support", "string"],    // JSON keys
  parameter: ["varParam", "base"],
  expression: ["hbExpr", "hbExpr"],   // a Handlebars {{expression}}
};
/** Pairs the two themes give that no kind has: the kind each is shown as, measured over the repository's own code:
 *  a function name is dark "constant" where declared as a const and "string" in some calls; a JSDoc type
 *  is dark "comment". */
const OTHER_PAIRS: Array<[LightIntent, DarkIntent, CodeKind]> = [
  ["name", "constant", "function"],
  ["name", "string", "function"],
  ["name", "comment", "comment"],
];

const hex = (s: string) => s.toLowerCase();
const KIND_OF_PAIR = new Map<string, CodeKind>();
for (const [kind, [l, d]] of Object.entries(KIND_INTENTS) as Array<[CodeKind, [LightIntent, DarkIntent]]>) {
  KIND_OF_PAIR.set(`${hex(monokaiLightPalette[l])} ${hex(mcmDarkPalette[d])}`, kind);
}
for (const [l, d, kind] of OTHER_PAIRS) {
  const key = `${hex(monokaiLightPalette[l])} ${hex(mcmDarkPalette[d])}`;
  if (!KIND_OF_PAIR.has(key)) KIND_OF_PAIR.set(key, kind);
}
/** A pair no rule names (a grammar change could make one): the kind its light colour has, else text. */
const KIND_OF_LIGHT = new Map<string, CodeKind>();
for (const [kind, [l]] of Object.entries(KIND_INTENTS) as Array<[CodeKind, [LightIntent, DarkIntent]]>) {
  if (!KIND_OF_LIGHT.has(hex(monokaiLightPalette[l]))) KIND_OF_LIGHT.set(hex(monokaiLightPalette[l]), kind);
}

/** The kind a token's light and dark colours stand for. */
export function codeKindOf(light: string | undefined, dark: string | undefined): CodeKind {
  if (!light || !dark) return "text";
  return KIND_OF_PAIR.get(`${hex(light)} ${hex(dark)}`) ?? KIND_OF_LIGHT.get(hex(light)) ?? "text";
}

/** Each token's two colours become its kind's class; the block's inline colours and theme classes go. */
const kindClasses: ShikiTransformer = {
  name: "pd-code-kinds",
  pre(node) {
    node.properties["class"] = "shiki";
    delete node.properties["style"];
  },
  span(node) {
    const style = String(node.properties["style"] ?? "");
    delete node.properties["style"];
    const kind = codeKindOf(/--shiki-light:\s*(#[0-9a-f]+)/i.exec(style)?.[1], /--shiki-dark:\s*(#[0-9a-f]+)/i.exec(style)?.[1]);
    if (kind !== "text") node.properties["class"] = `pd-code-${kind}`;
  },
};

/**
 * /_pd/code.css: every kind's colour. PD's defaults are custom properties on :root, light-dark() of the two themes'
 * colours, so they follow the color-scheme of the element that shows them; they and the rules that apply them are in
 * the `pd-code` cascade layer, so any rule of a site's (unlayered, or in a layer declared before this sheet is
 * linked) wins. A site sets `--pd-code-string: var(--color-code-string)` and the like on :root.
 */
export function getCodeCSS(): string {
  const props = CODE_KINDS.map(kind => {
    const [l, d] = KIND_INTENTS[kind];
    return `--pd-code-${kind}:light-dark(${hex(monokaiLightPalette[l])},${hex(mcmDarkPalette[d])});`;
  }).join("");
  const rules = CODE_KINDS.filter(k => k !== "text").map(k => `.pd-code-${k}{color:var(--pd-code-${k})}`).join("");
  return `@layer pd-code{:root{${props}}.shiki{color:var(--pd-code-text)}${rules}}\n`;
}

/**
 * /_pd/shiki.css: the workbench's code-block frame, which site pages never link (a site styles its own blocks).
 * Its blocks follow the OS's light or dark (color-scheme: light dark), as before the shell's own dark pass, while the
 * shell itself is pinned light.
 */
export function getShikiCSS(): string {
  return [
    `.shiki{color-scheme:light dark;background-color:light-dark(${hex(monokaiLight.colors["editor.background"])},${hex(mcmDarkPalette.background)});overflow-x:auto}`,
    ".shiki code{display:block;padding:.75em 1em;font-family:monospace;font-size:1rem;line-height:1.6;white-space:pre;tab-size:2}",
  ].join("") + "\n";
}

/**
 * Wrap a highlighted block in a container that carries the raw source text.
 * The shell reads data-raw for the copy button; it never touches the highlighted markup. `button: false`: no button
 * in the markup, for a page whose own script adds one where the browser can copy (a storefront page), so a skin's CSS
 * can never show a button that does nothing.
 */
export function wrapWithCopyButton(highlightedHtml: string, rawCode: string, o: { button?: boolean } = {}): string {
  const escaped = rawCode.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const button = o.button === false ? "" : `<button class="copy-btn" type="button" aria-label="Copy source">Copy</button>`;
  return `<div class="shiki-container" data-raw="${escaped}">${button}${highlightedHtml}</div>`;
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
      transformers: [kindClasses],
    });
  } catch {
    return _plainPre(code); // highlight failure → never propagates
  }
}

// tabindex="0", as Shiki writes on every block it highlights: a block wider than its column scrolls, and a scrolling
// region must be reachable by keyboard (axe scrollable-region-focusable). axe asks for nothing more on a <pre>.
function _plainPre(code: string): string {
  const esc = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="shiki shiki-plain" tabindex="0"><code>${esc}</code></pre>`;
}
