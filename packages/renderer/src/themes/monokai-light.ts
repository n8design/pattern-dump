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
const CONTROLLED: Record<string, Oklch> = {
  varParam: { l: 0.74, c: 0.14, h: 58 }, // lightened args — breaks the deuteranopia collapse → #ec9247
  hbExpr:   { l: 0.62, c: 0.15, h: 48 }, // {{expression}} light terracotta → #cc6526
};
const c = computePalette("pd-monokai-light", CONTROLLED);

// Faithful Monokai Light values (from the MIT JSON).
const M = {
  base:       "#49483e", // base/global fg + variables + punctuation + {{ }} delimiters
  comment:    "#75715E",
  string:     "#998f2f",
  constant:   "#684d99", // numeric / language / other constants
  keyword:    "#f9005a", // keyword / storage / tag (hot pink — loud, cool; flagged for warm-tune)
  support:    "#0089b3", // storage.type / support.function/constant/type (teal-blue)
  name:       "#679c00", // class/type/function names + attribute names (olive-green)
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
