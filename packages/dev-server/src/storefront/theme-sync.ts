// Embedded previews follow the page's theme.
//
// A site page's light and dark belong to its skin (DECISION-STOREFRONT-SKIN, point 4): PD never sets a theme on a
// page. A live example on the page is a preview of the workbench, built with the theme set's default theme. This
// script, written by PD into every page that has a theme set, carries the page's theme into those previews:
//
//   - The page's theme is the `data-theme` of <html>, else of <body>: where a skin's toggle writes it.
//   - Only a value that names one of the theme set's themes reaches a preview. Any other value, or none, leaves
//     each preview at the theme it was built with (restored, if the page named a theme before).
//   - `themes.switch: "attribute"` sets `data-theme` on the preview's <body>; `"stylesheet"` points the preview's
//     one theme link (`link[data-pd-theme]`) at the page theme's stylesheet. Both are what the workbench's theme
//     picker does (applyThemeToIframe). Nothing else in the preview document is touched.
//   - A preview is themed when it loads, and again whenever the page's `data-theme` changes.
//
// Without scripting a preview keeps its built theme; it follows the viewer when that theme does (a default theme
// with `color-scheme: light dark`). The previews are same-origin: the page and its previews are served together.

import type { ThemeSwitch } from "@pattern-dump/contracts";

/** The previews on a page: live examples (markdown.ts writes them as `figure.doc-example`). */
const FRAMES = "figure.doc-example iframe";

/**
 * Keep the page's previews on the page's theme. Runs in the page, from its own source (themeSyncScript): it must
 * not reference anything outside itself.
 */
export function syncPreviewThemes(doc: Document, names: readonly string[], mode: ThemeSwitch, frames: string): void {
  const known = new Set(names);
  /** The page's theme when it names a theme of the set, else null. */
  const pageTheme = (): string | null => {
    const html = doc.documentElement;
    const value = html.hasAttribute("data-theme") ? html.getAttribute("data-theme")
      : doc.body ? doc.body.getAttribute("data-theme") : null;
    return value !== null && known.has(value) ? value : null;
  };
  /** Each preview's built theme, read the first time it is themed: what it goes back to. */
  const built = new WeakMap<Document, string | null>();

  const apply = (frame: HTMLIFrameElement): void => {
    let preview: Document | null = null;
    try { preview = frame.contentDocument; } catch { return; }
    // Only a preview document (it names its component), never the blank one a frame has before it loads.
    if (!preview || !preview.body || !preview.body.hasAttribute("data-component-id")) return;
    const theme = pageTheme();
    if (mode === "stylesheet") {
      const link = preview.querySelector<HTMLLinkElement>("link[data-pd-theme]");
      if (!link) return;
      if (!built.has(preview)) built.set(preview, link.getAttribute("data-pd-theme"));
      const target = theme ?? built.get(preview) ?? null;
      if (target === null || link.getAttribute("data-pd-theme") === target) return;
      // The same address with the theme's file name: the base path and the folder stay as the preview wrote them.
      link.setAttribute("href", (link.getAttribute("href") ?? "").replace(/[^/?#]*\.css(?=[?#]|$)/, `${encodeURIComponent(target)}.css`));
      link.setAttribute("data-pd-theme", target);
      return;
    }
    if (!built.has(preview)) built.set(preview, preview.body.getAttribute("data-theme"));
    const target = theme ?? built.get(preview) ?? null;
    if (target === null) preview.body.removeAttribute("data-theme");
    else if (preview.body.getAttribute("data-theme") !== target) preview.body.setAttribute("data-theme", target);
  };

  const all = (): void => { doc.querySelectorAll<HTMLIFrameElement>(frames).forEach(apply); };
  doc.querySelectorAll<HTMLIFrameElement>(frames).forEach(frame => {
    frame.addEventListener("load", () => apply(frame));
    apply(frame);
  });
  const watch = new MutationObserver(all);
  watch.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (doc.body) watch.observe(doc.body, { attributes: true, attributeFilter: ["data-theme"] });
}

/** The script, for a page with a theme set: the function above with the set's theme names and switch. Empty when
 *  the project has no themes, or the page embeds no preview. */
export function themeSyncScript(names: readonly string[], mode: ThemeSwitch, html: string): string {
  if (names.length === 0 || !html.includes(`class="doc-example"`)) return "";
  // JSON in a script: "<" is escaped so a theme name can never close the element.
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<script>(${syncPreviewThemes.toString()})(document,${json([...names])},${json(mode)},${json(FRAMES)});</script>`;
}
