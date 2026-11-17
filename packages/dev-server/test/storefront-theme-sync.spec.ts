// The theme sync of a site page's embedded previews (theme-sync.ts), run against fake documents: which page value
// reaches a preview, what is restored, and the two theme switches. The rendered behaviour, in pd dev and in a
// pd build, is storefront-bench/e2e/theme-sync.spec.ts; the bench's themes switch by attribute, so the stylesheet
// switch is pinned here.
import { afterEach, describe, expect, it } from "vitest";
import { syncPreviewThemes, themeSyncScript } from "../src/storefront/theme-sync.js";

/** An element with attributes only. */
class FakeEl {
  attrs = new Map<string, string>();
  constructor(init: Record<string, string> = {}) { for (const [k, v] of Object.entries(init)) this.attrs.set(k, v); }
  hasAttribute(n: string): boolean { return this.attrs.has(n); }
  getAttribute(n: string): string | null { return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string): void { this.attrs.set(n, v); }
  removeAttribute(n: string): void { this.attrs.delete(n); }
}

/** A preview document: its body (data-component-id, the built data-theme) and its one theme link. */
function preview(theme: string | null, link?: string): { body: FakeEl; link: FakeEl | null; querySelector(s: string): FakeEl | null } {
  const body = new FakeEl({ "data-component-id": "components/callout", ...(theme ? { "data-theme": theme } : {}) });
  const l = link ? new FakeEl({ href: link, "data-pd-theme": theme ?? "" }) : null;
  return { body, link: l, querySelector: s => (s === "link[data-pd-theme]" ? l : null) };
}

interface Frame { contentDocument: unknown; load?: () => void; addEventListener(t: string, fn: () => void): void }
const frame = (doc: unknown): Frame => {
  const f: Frame = { contentDocument: doc, addEventListener: (t, fn) => { if (t === "load") f.load = fn; } };
  return f;
};

let observed: (() => void) | undefined;
const realObserver = globalThis.MutationObserver;
afterEach(() => { globalThis.MutationObserver = realObserver; observed = undefined; });

/** A page with these frames; returns its <html>, <body> and a way to say "the page's data-theme changed". */
function page(frames: Frame[], names: string[], mode: "attribute" | "stylesheet") {
  (globalThis as { MutationObserver: unknown }).MutationObserver = class {
    constructor(fn: () => void) { observed = fn; }
    observe(): void {}
  };
  const html = new FakeEl(), body = new FakeEl();
  const doc = { documentElement: html, body, querySelectorAll: () => frames };
  syncPreviewThemes(doc as unknown as Document, names, mode, "figure.doc-example iframe");
  return { html, body, changed: () => observed!() };
}

describe("theme sync, attribute switch", () => {
  it("a page theme that names a preview theme reaches the preview; another value or none restores the built one", () => {
    const p = preview("light");
    const { html, changed } = page([frame(p)], ["light", "dark"], "attribute");
    expect(p.body.getAttribute("data-theme")).toBe("light");
    html.setAttribute("data-theme", "dark"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("dark");
    html.setAttribute("data-theme", "sepia"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("light");
    html.setAttribute("data-theme", "dark"); changed();
    html.removeAttribute("data-theme"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("light");
  });

  it("<html> wins over <body>; <body> counts when <html> has none", () => {
    const p = preview("light");
    const { html, body, changed } = page([frame(p)], ["light", "dark", "contrast"], "attribute");
    body.setAttribute("data-theme", "dark"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("dark");
    html.setAttribute("data-theme", "contrast"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("contrast");
  });

  it("a frame that has not loaded its preview is left alone, and themed when it loads", () => {
    const blank = { body: new FakeEl(), querySelector: () => null };
    const f = frame(blank);
    const { html } = page([f], ["light", "dark"], "attribute");
    html.setAttribute("data-theme", "dark");
    expect(blank.body.hasAttribute("data-theme")).toBe(false);
    const p = preview("light");
    f.contentDocument = p;
    f.load!();
    expect(p.body.getAttribute("data-theme")).toBe("dark");
  });

  it("a preview built without a theme goes back to none", () => {
    const p = preview(null);
    const { html, changed } = page([frame(p)], ["light", "dark"], "attribute");
    html.setAttribute("data-theme", "dark"); changed();
    expect(p.body.getAttribute("data-theme")).toBe("dark");
    html.removeAttribute("data-theme"); changed();
    expect(p.body.hasAttribute("data-theme")).toBe(false);
  });
});

describe("theme sync, stylesheet switch", () => {
  it("points the preview's theme link at the page theme's file, keeping its base path, and back", () => {
    const p = preview("light", "/docs/_pd/themes/light.css");
    const { html, changed } = page([frame(p)], ["light", "dark"], "stylesheet");
    html.setAttribute("data-theme", "dark"); changed();
    expect([p.link!.getAttribute("href"), p.link!.getAttribute("data-pd-theme")]).toEqual(["/docs/_pd/themes/dark.css", "dark"]);
    expect(p.body.getAttribute("data-theme")).toBe("light"); // the attribute is not this switch's
    html.setAttribute("data-theme", "sepia"); changed();
    expect([p.link!.getAttribute("href"), p.link!.getAttribute("data-pd-theme")]).toEqual(["/docs/_pd/themes/light.css", "light"]);
  });

  it("a stamp on the address stays", () => {
    const p = preview("light", "/_pd/themes/light.css?v=3");
    const { html, changed } = page([frame(p)], ["light", "dark"], "stylesheet");
    html.setAttribute("data-theme", "dark"); changed();
    expect(p.link!.getAttribute("href")).toBe("/_pd/themes/dark.css?v=3");
  });
});

describe("themeSyncScript", () => {
  const page = '<figure class="doc-example">\n<iframe src="/preview/x"></iframe></figure>';
  it("is written only for a page with a theme set that embeds a preview", () => {
    expect(themeSyncScript([], "attribute", page)).toBe("");
    expect(themeSyncScript(["light"], "attribute", "<p>no example</p>")).toBe("");
    expect(themeSyncScript(["light", "dark"], "attribute", page)).toMatch(/^<script>\(function syncPreviewThemes\(/);
  });

  it("can't be closed by a theme name", () => {
    const script = themeSyncScript(["</script><b>"], "attribute", page);
    expect(script.match(/<\/script>/g)).toHaveLength(1);
  });
});
