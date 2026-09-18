// Content-fit width for `centered` previews: the iframe is sized to what its content needs, and the
// Stage centres it (margin-inline: auto). The preview document is never restyled to make this work —
// it only measures itself and posts `pd-width` (see CONTENT_WIDTH_SCRIPT in dev-server's
// preview-document.ts). A `full` preview posts no width and keeps the full width.
//
// THE LOOP THIS MODULE EXISTS TO PREVENT. Measuring at the frame's current width and then narrowing it
// to the result feeds back: wrapped text re-wraps at every narrower width and would walk the frame
// down step by step. So a frame is MEASURED only at the full width available to it, and the result is
// then applied once:
//   1. measureContentWidth(frame) drops any fitted width, so the frame is at full width, and records
//      that width.
//   2. The document posts pd-width with `at` = the width it measured at.
//   3. acceptContentWidth applies the width only while the frame is measuring and only if `at` is the
//      recorded full width. Every other pd-width is ignored until the next measurement.
// Measurements start on a new document (load), a restyle (css-link-swap, theme change) and when the
// main frame enters fit or content mode. A fitted frame whose content then overflows is widened once to
// the content's scroll width; if it still overflows it gets the full width and keeps it. Re-measuring
// instead would produce the same too-narrow width again.
//
// Which frames fit their content: the main preview in fit and content modes (presets and disco set
// their own width), and gallery tiles. The full-page dialog shows the page at full width.
//
// NARROWING THE FRAME NARROWS THE VIEWPORT. The iframe's width is what the component's media queries
// (and its container queries) see, so a responsive component fitted to its content would switch to its
// narrow-screen styles. Before narrowing, the preview's own stylesheets are read (same-origin, never
// changed): if a width condition that changes between the full and the fitted width styles an element
// of this preview, the frame keeps the full width and the component shows as it does at that width.

import { dom } from "../core/dom.js";
import { store } from "../core/store.js";
import { setVpProp } from "./preview-sizing.js";

/** Frames measuring right now → the full width they are being measured at. */
const measuring = new WeakMap<HTMLIFrameElement, number>();
/** Frames narrowed since their last measurement: to the measured width, or widened once after an
 *  overflow. */
const fitted = new WeakMap<HTMLIFrameElement, "measured" | "widened">();

function fitsContent(frame: HTMLIFrameElement): boolean {
  if (frame === dom.iframe) {
    const vp = store.url.viewport;
    return (vp === "fit" || vp === "content") && dom.stageView.dataset.layout !== "full";
  }
  return frame.closest(".gallery-item") !== null;
}

/** Start a measurement: full width, no transition, and wait for a pd-width taken at that width. */
export function measureContentWidth(frame: HTMLIFrameElement): void {
  if (!fitsContent(frame)) { stopMeasuring(frame); return; }
  frame.classList.add("vp-measuring");
  frame.style.removeProperty("--vp-w");
  fitted.delete(frame);
  measuring.set(frame, frame.clientWidth); // reading it lays the frame out at full width
}

/** Leave the frame's width to whoever sets it now (a preset, disco, full layout). */
export function stopMeasuring(frame: HTMLIFrameElement): void {
  measuring.delete(frame);
  fitted.delete(frame);
  frame.classList.remove("vp-measuring");
}

/** Measure every frame that fits its content: after a restyle that did not reload the documents. */
export function remeasureAll(): void {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("#preview-frame, .gallery-item iframe")) {
    measureContentWidth(frame);
  }
}

/**
 * The width thresholds, in px, in a media or container condition: `(min-width: 40em)`, `(max-width:
 * 600px)` and the range forms (`width >= 600px`, `400px < width < 800px`). em and rem count as 16px, as
 * they do in media queries. A `print`-only query has none: it never applies to the Stage.
 */
export function widthThresholds(condition: string): number[] {
  const out: number[] = [];
  const px = (n: string, unit: string) => parseFloat(n) * (unit.toLowerCase() === "px" ? 1 : 16);
  for (const query of condition.split(",")) {
    if (/^\s*(only\s+)?print\b/i.test(query)) continue;
    // (min-width: 40em), (max-inline-size: 600px)
    for (const m of query.matchAll(/(?:min|max)-(?:width|inline-size)\s*:\s*(-?[\d.]+)(px|r?em)\b/gi)) out.push(px(m[1], m[2]));
    // (width >= 600px), and the upper bound of (400px < width < 800px)
    for (const m of query.matchAll(/(?:width|inline-size)\s*[<>]=?\s*(-?[\d.]+)(px|r?em)\b/gi)) out.push(px(m[1], m[2]));
    // (600px <= width), and the lower bound of a range
    for (const m of query.matchAll(/(-?[\d.]+)(px|r?em)\s*[<>]=?\s*(?:width|inline-size)\b/gi)) out.push(px(m[1], m[2]));
  }
  return out;
}

/**
 * Whether narrowing the frame from `wide` to `narrow` would change how the preview is styled: some
 * media or container rule has a width condition that changes in that range AND styles an element that
 * is in this preview. A rule for markup the preview does not contain (a design system's grid or nav
 * breakpoints, seen from a button) cannot change it.
 */
function widthConditionsChange(frame: HTMLIFrameElement, narrow: number, wide: number): boolean {
  const doc = frame.contentDocument;
  if (!doc) return false;
  const between = (t: number) => t >= narrow && t <= wide;
  const matches = (selector: string): boolean => {
    try { return doc.querySelector(selector) !== null; } catch { return true; } // unknown syntax: assume it applies
  };
  // By shape, not instanceof: the rules belong to the preview's realm, whose CSSMediaRule is not
  // this window's, so `rule instanceof CSSMediaRule` is always false here.
  type AnyRule = CSSRule & { media?: MediaList; conditionText?: string; containerName?: string;
    styleSheet?: CSSStyleSheet | null; cssRules?: CSSRuleList; selectorText?: string };
  /** Whether any style rule in `rules` (at any depth) styles an element of the preview. */
  const stylesThePreview = (rules: CSSRuleList | undefined): boolean => {
    for (const rule of rules ?? []) {
      const r = rule as AnyRule;
      if (r.selectorText !== undefined && matches(r.selectorText)) return true;
      if (r.cssRules !== undefined && stylesThePreview(r.cssRules)) return true;
    }
    return false;
  };
  const visit = (rules: CSSRuleList | undefined): boolean => {
    for (const rule of rules ?? []) {
      const r = rule as AnyRule;
      const condition = r.styleSheet === undefined && r.media !== undefined ? r.media.mediaText
        : r.containerName !== undefined ? r.conditionText ?? null
        : null;
      if (condition !== null && widthThresholds(condition).some(between) && stylesThePreview(r.cssRules)) return true;
      if (r.styleSheet !== undefined) {
        // An @import with a width media condition applies its whole sheet conditionally.
        const imported = sheetRules(r.styleSheet);
        if (r.media && widthThresholds(r.media.mediaText).some(between) && stylesThePreview(imported)) return true;
        if (visit(imported)) return true;
      } else if (r.cssRules !== undefined && visit(r.cssRules)) return true;
    }
    return false;
  };
  return [...doc.styleSheets].some(sheet => visit(sheetRules(sheet)));
}

/** A sheet's rules, or none when they cannot be read (another origin's stylesheet). */
function sheetRules(sheet: CSSStyleSheet | null): CSSRuleList | undefined {
  try { return sheet?.cssRules; } catch { return undefined; }
}

/** Change a frame's width without the viewport animation, then give the transition back. */
function setWidthNow(frame: HTMLIFrameElement, width: number | null): void {
  frame.classList.add("vp-measuring");
  if (width === null) frame.style.removeProperty("--vp-w");
  else setVpProp(frame, "--vp-w", width);
  requestAnimationFrame(() => requestAnimationFrame(() => frame.classList.remove("vp-measuring")));
}

/**
 * Apply a pd-width from `frame`'s document. Returns true when the frame's width changed.
 * `at` is the viewport width it was measured at; `scroll` is the document's scroll width there, which
 * is larger than `at` when the content overflows.
 */
export function acceptContentWidth(frame: HTMLIFrameElement, width: number, at: number, scroll: number): boolean {
  const full = measuring.get(frame);
  if (full === undefined) {
    // Settled. A fitted frame whose content overflows was measured too narrow for it.
    const state = fitted.get(frame);
    if (state === undefined || scroll <= at + 1) return false;
    const parentWidth = frame.parentElement?.clientWidth ?? Infinity;
    if (state === "measured" && scroll < parentWidth) {
      fitted.set(frame, "widened");
      setWidthNow(frame, scroll);
    } else {
      fitted.delete(frame);
      setWidthNow(frame, null);
    }
    return true;
  }
  if (Math.abs(at - full) > 1) return false; // measured before the frame reached full width
  measuring.delete(frame);
  const narrower = width < full - 1 && !widthConditionsChange(frame, width, full);
  if (narrower) fitted.set(frame, "measured");
  setWidthNow(frame, narrower ? width : null);
  return true;
}

/** Measure again whenever the theme changes: a theme can change how wide the content is. */
export function initContentWidth(): void {
  let theme = store.local.theme;
  store.subscribe(() => {
    if (store.local.theme === theme) return;
    theme = store.local.theme;
    remeasureAll();
  });
}
