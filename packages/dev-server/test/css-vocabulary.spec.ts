// The class check's readers: the classes a stylesheet names (css-vocabulary.ts), and what a template and a built
// page write as classes (class-check.ts).
import { describe, expect, it } from "vitest";
import { nameMatcher, readCss } from "../src/storefront/css-vocabulary.js";
import { checkClasses, documentClasses, templateClasses } from "../src/storefront/class-check.js";

describe("readCss and nameMatcher", () => {
  it("names the classes of every selector, and reads nothing from text that isn't CSS, rather than failing", () => {
    expect([...readCss(".a .b:hover, .c > .d { color: red; }\n@media (width > 1px) { .e { margin: 0; } }").classes].sort())
      .toEqual(["a", "b", "c", "d", "e"]);
    expect(readCss("{{{").classes.size).toBe(0);
  });

  it("matches names and prefixes", () => {
    const m = nameMatcher(["exact", "pre-*"]);
    expect([m("exact"), m("pre-fix"), m("pre"), m("exactly")]).toEqual([true, true, false, false]);
  });
});

describe("templateClasses", () => {
  it("takes a class attribute's static words, a family by the start of a word built from a value, and a block's words", () => {
    const t = `<aside class="callout{{#if tone}} callout-{{tone}}{{/if}}"><li class="doc-toc-h{{level}}"><p class='{{x}}-y z'>`
      + `<b class="{{#if open}}is-open{{else}}is-shut{{/if}}">`;
    expect(templateClasses(t)).toEqual({ classes: ["callout", "z", "is-open", "is-shut"], prefixes: ["callout-", "doc-toc-h"] });
  });
});

describe("documentClasses and checkClasses", () => {
  it("reads a built page's classes, but not from its scripts or comments", () => {
    expect(documentClasses(`<p class="a b"><!-- <i class="c"> --><script>x = '<i class="d">'</script><i class='e'>`)).toEqual(["a", "b", "e"]);
  });

  it("names a class nothing defines by its page's file and line; counts styles, templates, families, the page's own <style>", () => {
    const warnings = checkClasses({
      pages: [{
        route: "/about/",
        html: `<style>.own{}</style><p class="styled written family-2 own pd-x is-open stray">`,
        file: { path: "about.md", text: "---\ntitle: About\n---\n\n<pd-badge look=\"stray\"></pd-badge>\n" },
      }, { route: "/tags/x/", html: `<p class="stray">` }],
      stylesheets: [".styled { color: red }"],
      templates: [`<p class="written family-{{n}}">`],
    });
    expect(warnings).toEqual([
      `about.md:5: class "stray" isn't defined by any component or style`,
      `/tags/x/: class "stray" isn't defined by any component or style`,
    ]);
  });
});
