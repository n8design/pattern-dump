// pd-monokai-light — light syntax theme derived from the real "Monokai Light" VS Code theme.
//
// Source: zoxon/vscode-theme-monokai-light, themes/"Monokai Light Theme-color-theme.json".
// License: MIT © 2017 Velichko Konstantin (https://github.com/zoxon/vscode-theme-monokai-light).
// The faithful token colours below are transcribed from that JSON.
//
// Two deliberate deviations, both OKLCH-authored + gamut-checked (see ./oklch.ts):
//   1. variable.parameter (function args) is lightened #cf7000 → #ec9247 (oklch 0.74 0.14 58).
//      Faithful Monokai packs strings (#998f2f), args (#cf7000) and function/type/attribute
//      names (#679c00) into overlapping warm yellow-green territory that COLLAPSES under
//      deuteranopia (args~names ΔE 0.0025). Lightening args onto a higher lightness rung breaks
//      the collapse on the CVD-robust axis (deut ΔE → ~0.10). Residual: protanopia args~string
//      stays tight (~0.044) — a full fix needs the deferred warm-tune (see NOTE).
//   2. variable.parameter.handlebars ({{expression}} identifier) — Monokai has no Handlebars
//      scope; assign the light terracotta #cc6526 (oklch 0.62 0.15 48), the dark theme's
//      terracotta lowered for the #fafafa ground (the dark #E0824E is too light here).
//
// NOTE (deferred, not this build): the hot-pink #f9005a tags/keywords are loud and cool-identity
// (a magenta-pink, distinct from error-red #CD0B0B — reserved channel kept clean). A later
// warm-tune pass shifts this theme toward the dark's warm MCM family and resolves the residual
// protanopia tightness holistically. Font styles (Monokai's italics/underlines) are omitted —
// colour-only, matching pd-mcm-dark.
import { computePalette, type Oklch } from "./oklch.js";

// The two tokens we author (OKLCH → gamut-checked hex). Everything else is faithful literal.
// Every colour reaches 4.5:1 (WCAG AA) on white and on the block's #fafafa: the ones below it were darkened, hue and
// chroma kept, lightness lowered (0.8.0). The args' lightness rung (0.74) did not survive: at 4.5:1 they sit beside
// strings and names again, so the deuteranopia collapse described above is back. Follow-up: "Code colours: separate
// the warm kinds by lightness under deuteranopia", with every colour kept at 4.5:1 or above.
const CONTROLLED = {
  varParam: { l: 0.564, c: 0.135, h: 57.5 }, // args: was 0.74 (#ec9247), darkened for AA → #af5d02
  hbExpr:   { l: 0.568, c: 0.15, h: 48 },    // {{expression}} terracotta: was 0.62 (#cc6526), darkened for AA → #ba550c
} satisfies Record<string, Oklch>;
const c = computePalette("pd-monokai-light", CONTROLLED);

// Monokai Light values (from the MIT JSON), four of them darkened for AA (the faithful value in each comment).
const M = {
  base:       "#49483e", // base/global fg + variables + punctuation + {{ }} delimiters
  comment:    "#75715E",
  string:     "#7f7403", // faithful #998f2f
  constant:   "#684d99", // numeric / language / other constants
  keyword:    "#e40052", // keyword / storage / tag (hot pink, flagged for warm-tune); faithful #f9005a
  support:    "#007ca3", // storage.type / support.function/constant/type (teal-blue); faithful #0089b3
  name:       "#537f00", // class/type/function names + attribute names (olive-green); faithful #679c00
} as const;

export const monokaiLight = {
  name: "pd-monokai-light",
  type: "light" as const,
  colors: {
    "editor.background": "#fafafa",
    "editor.foreground": M.base,
  },
  // Ordered least→most specific; the Handlebars overrides win by longest-scope match.
  tokenColors: [
    { scope: ["comment", "comment.block.handlebars", "punctuation.definition.comment"], settings: { foreground: M.comment } },
    { scope: ["string", "punctuation.definition.string", "string.quoted"], settings: { foreground: M.string } },
    { scope: ["keyword", "keyword.control", "storage", "storage.modifier", "entity.name.tag", "entity.name.tag.html", "entity.name.tag.block.any.html", "entity.name.tag.inline.any.html"], settings: { foreground: M.keyword } },
    { scope: ["storage.type", "support", "support.function", "support.constant", "support.type", "support.class"], settings: { foreground: M.support } },
    { scope: ["constant", "constant.numeric", "constant.language", "constant.character", "variable.other.constant"], settings: { foreground: M.constant } },
    { scope: ["entity.name.class", "entity.name.type", "entity.name.function", "entity.other.attribute-name", "entity.other.attribute-name.html"], settings: { foreground: M.name } },
    { scope: ["variable.parameter"], settings: { foreground: c.varParam } }, // lightened (CVD)
    { scope: ["variable", "support.other.variable"], settings: { foreground: M.base } },
    { scope: ["punctuation.definition.tag", "meta.tag", "keyword.operator", "punctuation.separator", "punctuation.terminator"], settings: { foreground: M.base } },
    // Handlebars {{expression}} identifier — light terracotta (more specific than variable.parameter).
    { scope: ["variable.parameter.handlebars"], settings: { foreground: c.hbExpr } },
    // Handlebars {{ }} delimiters — muted to base (more specific than support.constant).
    { scope: ["support.constant.handlebars"], settings: { foreground: M.base } },
  ],
};

/** Computed hex for the two OKLCH-authored tokens — exported for the verify/report step. */
export const monokaiLightHex = c;

/** Every intent's colour, by name: the code kinds' light defaults (highlight.ts) are read from here. */
export const monokaiLightPalette = { ...M, varParam: c.varParam, hbExpr: c.hbExpr };
