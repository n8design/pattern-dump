// Every attribute baked into the preview document is escaped: escapeAttr is the preview's only
// injection defence, because the preview is deliberately same-origin. Values come from the project
// config (globalScripts, assets.css) and from discovery (component ids, theme names).
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { buildPreviewDocument } from "../src/preview-document.js";

const BREAKOUT = `"><script>alert(1)</script>`;

/** The preview's elements as a parser sees them. Attribute values come back entity-decoded, so an
 *  escaped value reads as the original; an unescaped one is cut at the quote and injects a script. */
function head(doc: string) {
  const root = parse(doc);
  return {
    scripts: root.querySelectorAll("script[src]").map(s => s.getAttribute("src")),
    links: root.querySelectorAll("link[rel=stylesheet]").map(l => l.getAttribute("href")),
    injected: root.querySelectorAll("script:not([src])").filter(s => s.text.includes("alert(1)")).length,
  };
}

describe("preview document attribute escaping", () => {
  it("a URL script from globalScripts cannot break out of src", () => {
    const doc = buildPreviewDocument("<p>x</p>", [], "centered", [], undefined,
      [`https://cdn.example/a.js${BREAKOUT}`]);
    const { scripts, injected } = head(doc);
    expect(injected).toBe(0);
    expect(scripts).toEqual([`https://cdn.example/a.js${BREAKOUT}`]);
  });

  it("an assets.css entry cannot break out of href", () => {
    const doc = buildPreviewDocument("<p>x</p>", [], "centered", [], undefined, undefined, undefined,
      [`site.css${BREAKOUT}`]);
    const { links, injected } = head(doc);
    expect(injected).toBe(0);
    expect(links).toEqual([`/assets/site.css${BREAKOUT}`]);
  });

  it("a component id cannot break out of the component stylesheet href", () => {
    const doc = buildPreviewDocument("<p>x</p>", [`atoms/x${BREAKOUT}`], "centered", []);
    const { links, injected } = head(doc);
    expect(injected).toBe(0);
    expect(links).toEqual([`/_pd/components/atoms/x${BREAKOUT}.css`]);
  });

  it("plain values are unchanged", () => {
    const doc = buildPreviewDocument("<p>x</p>", ["atoms/button"], "centered", ["light"], "light",
      ["https://cdn.example/a.js", "toggle"], undefined, ["site.css"]);
    const { scripts, links } = head(doc);
    expect(scripts).toEqual(["https://cdn.example/a.js", "/_pd/scripts/toggle.js"]);
    expect(links).toEqual(["/assets/site.css", "/_pd/themes/light.css", "/_pd/components/atoms/button.css"]);
  });
});
