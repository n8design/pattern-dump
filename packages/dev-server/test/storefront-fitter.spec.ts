// The storefront's fitter glue (page.ts, fitterScript), run from its own source against fake frames: a frame
// with a declared height (its `height` attribute, from x-pd-example-height) starts there; a frame without one
// starts at 1px, since a frame left at the UA's 150px could never be measured down to a shorter preview.
// Either way the fitter then follows the pd-height its preview posts.
import { describe, expect, it } from "vitest";
import { fitterScript } from "../src/storefront/page.js";

interface FakeFrame { style: { height: string }; contentWindow: object; hasAttribute(name: string): boolean }

const fakeFrame = (height?: number): FakeFrame => ({
  style: { height: "" },
  contentWindow: {},
  hasAttribute: name => name === "height" && height !== undefined,
});

/** Runs the glue against `frames`, as a page would on load; returns the page's message listener. */
function run(frames: FakeFrame[]): (event: { data: unknown; source: unknown }) => void {
  const source = /^<script>([\s\S]*)<\/script>$/.exec(fitterScript())![1]!;
  let listener: ((event: { data: unknown; source: unknown }) => void) | undefined;
  const document = { querySelectorAll: () => frames };
  const addEventListener = (type: string, fn: typeof listener) => { if (type === "message") listener = fn; };
  new Function("document", "addEventListener", source)(document, addEventListener);
  return listener!;
}

describe("the storefront's fitter glue", () => {
  it("leaves a frame with a declared height at it, and starts one without at 1px", () => {
    const declared = fakeFrame(112), undeclared = fakeFrame();
    run([declared, undeclared]);
    expect(declared.style.height).toBe("");
    expect(undeclared.style.height).toBe("1px");
  });

  it("then fits both to the height their previews post", () => {
    const declared = fakeFrame(112), undeclared = fakeFrame();
    const post = run([declared, undeclared]);
    post({ data: { type: "pd-height", height: 136 }, source: declared.contentWindow });
    post({ data: { type: "pd-height", height: 48 }, source: undeclared.contentWindow });
    expect([declared.style.height, undeclared.style.height]).toEqual(["136px", "48px"]);
  });
});
