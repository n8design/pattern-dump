// Diagnostics presentation — ordering constants, the small element builders, and the
// source -> category classifier.
//
// Mixed on purpose, and safe: the three `diag*` builders call document.createElement, but only
// inside their bodies, so importing this module in a node environment stays safe and the pure half
// (categoryFromSource, the two ordering constants) is unit-testable without jsdom. Same shape as
// html-util.ts.
//
// The builders exist as separate ELEMENTS rather than as one interpolated string because each
// carries its own class and therefore its own ink: the severity word is bold and uncoloured, and
// the separator is muted. Folding them into a template literal would make both inherit the row's
// styling, which is the thing they were split apart to avoid.

import { svgIcon } from "../icons/index.js";

export const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };
export const CATEGORY_ORDER = ["Render/Template", "Schema/Data", "HTML validation", "A11y", "Other"];

// Severity word as its own element so it can be labelled (bold, no colour). Capitalised, no
// brackets — "Error"/"Warning". Colour stays row ink: the head marker + row dot already spend the
// severity colour channel; bolding the word labels it without flooding red/orange a third time.
export function diagSevLabel(severity: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "diag-sev";
  s.textContent = severity.charAt(0).toUpperCase() + severity.slice(1);
  return s;
}

// Quiet divider between the bold severity label and the message — muted ink, normal weight (its own
// element so it never inherits the label's bold or the body ink).
export function diagSep(): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "diag-sep";
  s.textContent = " · ";
  return s;
}

// Docs link — leading shared external-link glyph + "See docs" (no brackets). Keeps the axe helpUrl.
export function diagDocsLink(helpUrl: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "diag-docs";
  link.href = helpUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.innerHTML = `${svgIcon("external-link")}<span>See docs</span>`;
  return link;
}

export function categoryFromSource(source: string): string {
  if (source === "render" || source === "highlight") return "Render/Template";
  if (source === "schema" || source === "cascade") return "Schema/Data";
  if (source === "html") return "HTML validation";
  if (source === "axe") return "A11y";
  return "Other";
}
