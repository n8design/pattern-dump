// The style checks' readers: what a stylesheet defines and reads (css-vocabulary.ts), and what a template and a
// built page write as classes (class-check.ts).
import { describe, expect, it } from "vitest";
import { inlineProperties, nameMatcher, readCss, sourceVarUses, varUses } from "../src/storefront/css-vocabulary.js";
import { checkClasses, documentClasses, templateClasses } from "../src/storefront/class-check.js";

describe("varUses", () => {
  it("finds a var() without a fallback, inside calc() and inside another's fallback, and skips one with a fallback", () => {
    expect(varUses("calc(var(--a) + var(--b, 1px))").map(u => u.name)).toEqual(["--a"]);
    expect(varUses("var(--x, var(--y))").map(u => u.name)).toEqual(["--y"]);
    expect(varUses("var(--x, var(--y, red))")).toEqual([]);
    expect(varUses(`var( --spaced )`).map(u => u.name)).toEqual(["--spaced"]);
  });

  it("skips a name Sass builds, and a var() in a quoted string", () => {
    expect(varUses("var(--#{$name})")).toEqual([]);
    expect(varUses(`"var(--quoted)" var(--real)`).map(u => u.name)).toEqual(["--real"]);
  });
});

describe("readCss", () => {
  it("names the classes of every selector, the properties defined, and each var() read, by line", () => {
    const v = readCss(".a .b:hover, .c > .d { --x: 1; color: var(--y); }\n@property --z { syntax: '*'; inherits: false; }\n.e { margin:\n  var(--w); }");
    expect([...v.classes].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...v.properties].sort()).toEqual(["--x", "--z"]);
    expect(v.uses).toEqual([{ name: "--y", line: 1, column: 39 }, { name: "--w", line: 4, column: 3 }]);
  });

  it("reads nothing from text that isn't CSS, rather than failing", () => {
    expect(readCss("{{{").classes.size).toBe(0);
  });
});

describe("sourceVarUses", () => {
  it("finds var() in SCSS by line and column, outside comments, and leaves a URL's // alone", () => {
    const scss = [
      "// var(--commented)",
      ".a { /* var(--blocked) */ color: var(--real); }",
      ".b { background: url(https://example.test/x.png); border-color: var(--after-url); }",
    ].join("\n");
    expect(sourceVarUses(scss, true)).toEqual([
      { name: "--real", line: 2, column: 34 },
      { name: "--after-url", line: 3, column: 65 },
    ]);
  });
});

describe("inlineProperties and nameMatcher", () => {
  it("reads the custom properties of a style attribute, and matches names and prefixes", () => {
    expect(inlineProperties("--cols: 3; color: red; --gap:1rem")).toEqual(["--cols", "--gap"]);
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
