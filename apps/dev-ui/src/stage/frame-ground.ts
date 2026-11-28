// The preview frame's ground follows the document's. The frame's padding is the inset around a component (shell.inset,
// _stage.scss), and it shows the frame's own background; the document's viewport shows its canvas, which a theme
// colours on the root or on body (CSS carries body's background to the canvas when the root has none). So the frame
// takes that colour, read from the same-origin document, and the inset is the component's own page around it, not a
// white ring. The shell styles its own element only; nothing is written into the document. Without a colour of the
// document's own, the frame keeps Canvas.

import { dom } from "../core/dom.js";

const transparent = (color: string): boolean => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

/** The colour the document paints its canvas with, or null when it paints none. */
export function documentGround(doc: Document): string | null {
  const root = getComputedStyle(doc.documentElement).backgroundColor;
  if (!transparent(root)) return root;
  const body = doc.body ? getComputedStyle(doc.body).backgroundColor : "transparent";
  return transparent(body) ? null : body;
}

/** Give the Stage's frame the ground of the document it shows now. */
export function syncFrameGround(frame: HTMLIFrameElement = dom.iframe): void {
  let ground: string | null;
  try { ground = frame.contentDocument ? documentGround(frame.contentDocument) : null; } catch { ground = null; }
  if (ground) frame.style.backgroundColor = ground;
  else frame.style.removeProperty("background-color");
}

/** When the system switches light and dark, a document that follows it changes its ground; so does a new theme (the
 *  theme picker's event on the frame, rail/theme.ts). */
export function followSchemeChanges(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => syncFrameGround());
  dom.iframe.addEventListener("pd-theme-applied", () => syncFrameGround());
}
