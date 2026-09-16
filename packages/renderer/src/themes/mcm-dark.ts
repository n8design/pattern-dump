// pd-mcm-dark — warm Mid-Century-Modern syntax theme on a deepened slate ground (#22292E).
// Authored in OKLCH (see ./oklch.ts), computed to sRGB hex at load, gamut-checked (fail-loud).
//
// The three convergence-risk warm tokens sit on a DELIBERATE lightness ladder so they stay
// separable under deuteranopia (where their hues merge): terracotta ~0.68 → gold ~0.78 →
// olive ~0.88. Khaki (attributes, the quiet low-chroma one) sits at ~0.72 between terracotta and
// gold. Cool anchors — teal (tags) and periwinkle (constants/numbers) — give hue contrast away
// from the warm family and from each other. error-red (#CD0B0B) and warning-orange (#E78C08) are
// deliberately absent: those channels stay reserved even inside the code block.
import { computePalette, type Oklch } from "./oklch.js";

// OKLCH source of truth for the dark palette.
const INTENTS: Record<string, Oklch> = {
  tag:      { l: 0.76, c: 0.11,  h: 190 }, // teal      — HTML tag names
  keyword:  { l: 0.78, c: 0.145, h: 78  }, // gold-amber — keywords/storage + Handlebars #each/#if/else
  attr:     { l: 0.72, c: 0.09,  h: 100 }, // khaki     — attribute names (the quiet rung)
  string:   { l: 0.88, c: 0.15,  h: 122 }, // olive     — strings (brightest, the CVD "up" rung)
  hbExpr:   { l: 0.68, c: 0.155, h: 48  }, // terracotta — {{expression}} identifier
  constant: { l: 0.74, c: 0.10,  h: 265 }, // periwinkle — constants/numbers (distinct cool rung)
  comment:  { l: 0.55, c: 0.025, h: 70  }, // warm-grey  — comments
  base:     { l: 0.86, c: 0.015, h: 80  }, // warm off-white — base fg / punctuation / muted
};

const c = computePalette("pd-mcm-dark", INTENTS);

export const mcmDark = {
  name: "pd-mcm-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#22292E",
    "editor.foreground": c.base,
  },
  // Ordered least→most specific; Shiki resolves by longest matching scope, so the Handlebars
  // overrides below win over the general `support.constant` / `variable` rules.
  tokenColors: [
    { scope: ["comment", "comment.block.handlebars", "punctuation.definition.comment"], settings: { foreground: c.comment } },
    { scope: ["string", "punctuation.definition.string", "string.quoted"], settings: { foreground: c.string } },
    { scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"], settings: { foreground: c.keyword } },
    { scope: ["constant", "constant.numeric", "constant.language", "support.constant", "variable.other.constant", "constant.character"], settings: { foreground: c.constant } },
    { scope: ["entity.name.tag", "entity.name.tag.html", "entity.name.tag.block.any.html", "entity.name.tag.inline.any.html"], settings: { foreground: c.tag } },
    { scope: ["entity.other.attribute-name", "entity.other.attribute-name.html"], settings: { foreground: c.attr } },
    { scope: ["variable", "support.other.variable"], settings: { foreground: c.base } },
    { scope: ["punctuation.definition.tag", "meta.tag", "keyword.operator", "punctuation.separator", "punctuation.terminator"], settings: { foreground: c.base } },
    // Handlebars {{expression}} identifier — the terracotta token (more specific than `variable`).
    { scope: ["variable.parameter.handlebars"], settings: { foreground: c.hbExpr } },
    // Handlebars {{ }} delimiters — muted to base (more specific than `support.constant`).
    { scope: ["support.constant.handlebars"], settings: { foreground: c.base } },
  ],
};

/** The computed hex per intent — exported for the verify/report step. */
export const mcmDarkHex = c;
