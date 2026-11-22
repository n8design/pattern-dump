// axe on a whole page (page.ts): the page rule tiers are what the classifier says for the installed axe-core (so an
// axe bump without a re-run fails here), the severity mapping, and the findings on a page with known faults.
import { describe, expect, it } from "vitest";
import { classifyPages } from "../src/page-classifier.js";
import { page } from "../src/page-fixtures.js";
import { pageRuleTiers, runAxeOnPage, runPageA11y, severityOf } from "../src/page.js";

describe("the page rule tiers", () => {
  it("are what the classifier says for the installed axe-core: re-run classify-pages after an axe bump", async () => {
    const now = await classifyPages();
    expect({ axeVersion: pageRuleTiers.axeVersion, jsdom: pageRuleTiers.jsdom, browser: pageRuleTiers.browser })
      .toEqual({ axeVersion: now.axeVersion, jsdom: now.jsdom, browser: now.browser });
  }, 120_000);

  it("leave what jsdom can't decide to the browser: contrast, one main, one h1", () => {
    for (const id of ["color-contrast", "landmark-one-main", "page-has-heading-one"]) expect(pageRuleTiers.browser).toContain(id);
    expect(pageRuleTiers.jsdom).toContain("image-alt");
  });
});

describe("severityOf", () => {
  it("a WCAG rule found critical or serious is an error; moderate, minor and every best-practice rule warn", () => {
    expect(severityOf("critical", ["wcag2a", "wcag111"])).toBe("error");
    expect(severityOf("serious", ["wcag2aa"])).toBe("error");
    expect(severityOf("moderate", ["wcag2a"])).toBe("warning");
    expect(severityOf("minor", ["wcag2a"])).toBe("warning");
    expect(severityOf("critical", ["best-practice"])).toBe("warning");
    expect(severityOf(null, ["wcag2a"])).toBe("warning");
  });
});

describe("runPageA11y", () => {
  it("passes a sound page", async () => {
    expect(await runPageA11y(page(`<p>Text</p>`))).toEqual([]);
  });

  it("finds an image without alt text (an error) and a heading level skipped (a best-practice warning)", async () => {
    const found = await runPageA11y(page(`<img src="a.png"><h3>Too deep</h3>`));
    expect(found.map(f => [f.ruleId, f.severity, f.nodes.map(n => n.target)])).toEqual([
      ["heading-order", "warning", ["h3"]],
      ["image-alt", "error", ["img"]],
    ]);
  });

  it("never reports what needs a browser", async () => {
    const found = await runPageA11y(page(`<p style="color:#bbb;background:#fff">Low contrast</p>`));
    expect(found).toEqual([]);
  });
});

// A live example embeds a preview in an iframe (figure.doc-example). axe pinged each frame and waited half a second
// for an answer jsdom's frame never gives (CR-016). It runs with iframes: false now, as the browser tier does; the
// findings are the same (pinned below from the run before the change), frame-title included: it reads the element.
describe("a page that embeds live examples", () => {
  const html = `<!DOCTYPE html><html lang="en"><head><title>Examples</title></head><body><main><h1>Examples</h1>
    <figure class="doc-example"><iframe src="/preview/a" title="Button, live"></iframe></figure>
    <figure class="doc-example"><iframe src="/preview/b"></iframe></figure></main></body></html>`;

  it("is checked without asking its frames", async () => {
    expect((await runAxeOnPage(html, pageRuleTiers.jsdom)).toolOptions.iframes).toBe(false);
  });

  it("has the same findings: frame-title on the iframe without a title, nothing else", async () => {
    const findings = await runPageA11y(html);
    expect(findings.map(f => [f.ruleId, f.nodes.map(n => n.target)])).toEqual([["frame-title", [`iframe[src$="preview/b"]`]]]);
  });
});
