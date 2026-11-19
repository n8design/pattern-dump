import { describe, it, expect } from "vitest";
import { configProblems, configWarnings, sameHostWorkbenchPath, storefrontBasePath, validateConfig } from "./validate.js";
import { defineConfig } from "./index.js";

const valid = {
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles", entry: "styles.scss" },
  themes: { dir: "./themes", default: "light", switch: "attribute", swatch: { slots: ["--a"] } },
  assets: { strategy: "central", dir: ["./assets/images", "./assets/css"], css: ["css/fonts.css"] },
  scriptsDir: "./src/scripts", globalScripts: ["nav", "https://cdn.example/x.js"],
  dataDir: "./src/data", helpers: "./src/helpers", documentBase: ["base"], overviews: false,
  shell: { brand: { title: "T", logo: { light: "/a.svg", dark: "/b.svg" }, logoAlt: "T", href: "/" } },
  packages: ["pkg-a", { name: "pkg-b", exclude: ["x/**"] }, { name: "pkg-c", styles: false }], exclude: ["drafts/**"],
  build: { outDir: "./site", basePath: "/docs/", audit: false, skipChecks: ["a11y"], workbench: true },
  images: { quality: 75, effort: 4 },
  storefront: {
    pagesDir: "./pages", outDir: "./site-www", host: "docs.localhost", workbenchUrl: "https://workbench.example.com/",
    site: { title: "Docs", footer: "Made here", social: { links: ["a"] } },
    images: { quality: 80 },
  },
};

const storefront = (sf: Record<string, unknown>) => configProblems({ ...valid, storefront: sf });

describe("configProblems", () => {
  it("accepts every documented option", () => {
    expect(configProblems(valid)).toEqual([]);
  });

  it("build.skipChecks: a list of the checks pd build may skip", () => {
    const build = (skipChecks: unknown) => configProblems({ ...valid, build: { skipChecks } });
    expect(build([])).toEqual([]);
    expect(build(["a11y", "html"])).toEqual([]);
    const said = `"build.skipChecks" must be a list of the checks pd build may skip: "a11y", "html"`;
    expect(build(["links"])).toEqual([said]);
    expect(build("a11y")).toEqual([said]);
  });

  it("build.workbench: a boolean", () => {
    expect(configProblems({ ...valid, build: { workbench: false } })).toEqual([]);
    expect(configProblems({ ...valid, build: { workbench: "no" } })).toEqual([`"build.workbench" must be true or false`]);
  });

  it("images: quality a whole number from 1 to 100, effort from 0 to 6, for the project and per site", () => {
    expect(configProblems({ ...valid, images: { quality: 1, effort: 0 } })).toEqual([]);
    expect(configProblems({ ...valid, images: { quality: 100, effort: 6 } })).toEqual([]);
    expect(configProblems({ ...valid, images: { quality: 0, effort: 7 } })).toEqual([
      `"images.quality" must be a whole number from 1 to 100 (WebP quality)`,
      `"images.effort" must be a whole number from 0 to 6 (WebP effort: 0 fastest, 6 smallest)`,
    ]);
    expect(configProblems({ ...valid, images: { quality: 75.5, effort: "4" } })).toEqual([
      `"images.quality" must be a whole number from 1 to 100 (WebP quality)`,
      `"images.effort" must be a whole number from 0 to 6 (WebP effort: 0 fastest, 6 smallest)`,
    ]);
    expect(storefront({ ...valid.storefront, images: { quality: 101 } })).toEqual([
      `"site.images.quality" must be a whole number from 1 to 100 (WebP quality)`,
    ]);
    expect(configProblems({ ...valid, images: { qualty: 80 } })[0]).toMatch(/"images\.qualty"/);
  });

  it("accepts the minimal config, with no strategy", () => {
    // Also a type check: defineConfig must accept it, so `npm run typecheck` fails if strategy
    // becomes required again.
    const minimal = defineConfig({ sourceDir: "s", patternsDir: "p", outDir: "o", styles: { dir: "d" } });
    expect(configProblems(minimal)).toEqual([]);
  });

  it("names a missing required key, and the typo that probably meant it", () => {
    const { outDir, ...rest } = valid;
    expect(configProblems({ ...rest, outdir: outDir }))
      .toEqual([`missing required "outDir" (found "outdir": did you mean "outDir"?)`]);
    expect(configProblems({ ...rest })).toEqual([`missing required "outDir"`]);
    // styles is optional, so a typo of it is an unknown key.
    const { styles, ...noStyles } = valid;
    expect(configProblems({ ...noStyles, style: styles })).toEqual([`unknown key "style": did you mean "styles"?`]);
  });

  it("sourceDir, patternsDir and styles are optional: a site whose patterns all come from packages names none", () => {
    expect(configProblems({ outDir: "o" })).toEqual([]);
    const defaults = { sourceDir: "./src", patternsDir: "./src/patterns", styles: { strategy: "parallel", dir: "./src/styles" } };
    expect(validateConfig({ outDir: "o" }, "test")).toEqual({ outDir: "o", ...defaults });
    // defineConfig fills none of them: a default is not a folder the config names (withOwnManifest).
    const written = { outDir: "o" };
    expect(defineConfig(written)).toBe(written);
    expect(defineConfig(written)).toEqual({ outDir: "o" });
    // The other two follow sourceDir.
    expect(validateConfig({ outDir: "o", sourceDir: "./site" }, "test")).toMatchObject({ patternsDir: "./site/patterns", styles: { dir: "./site/styles" } });
    // What is given is kept, and still checked.
    expect(validateConfig({ outDir: "o", patternsDir: "./p", styles: { dir: "./s" } }, "test")).toMatchObject({ sourceDir: "./src", patternsDir: "./p", styles: { dir: "./s" } });
    expect(configProblems({ outDir: "o", patternsDir: 3 })).toEqual([`"patternsDir" must be a string`]);
  });

  it("rejects unknown keys at any depth, with a suggestion when one is close", () => {
    expect(configProblems({ ...valid, dataDirectory: "x", colour: 1 })).toEqual([
      `unknown key "dataDirectory"`,
      `unknown key "colour"`,
    ]);
    expect(configProblems({ ...valid, overview: true })).toEqual([`unknown key "overview": did you mean "overviews"?`]);
    expect(configProblems({ ...valid, styles: { ...valid.styles, entries: "x" } }))
      .toEqual([`unknown key "styles.entries": did you mean "styles.entry"?`]);
  });

  it("reports wrong value types by path", () => {
    expect(configProblems({ ...valid, overviews: "no", assets: { dir: 3 }, themes: { dir: "t" } })).toEqual([
      `missing required "themes.default"`,
      `"assets.dir" must be a string or a list of strings`,
      `"overviews" must be true or false`,
    ]);
  });

  it("accepts themes with only a default, for a theme a package provides", () => {
    expect(configProblems({ ...valid, themes: { default: "blue" } })).toEqual([]);
  });

  it("rejects a package option of the wrong type", () => {
    expect(configProblems({ ...valid, packages: [{ name: "pkg-a", styles: "no" }] })).toEqual([
      `"packages" must be a list of package names or { name, exclude, styles } objects`,
    ]);
  });

  it("rejects the strategies that are not implemented, instead of ignoring them", () => {
    expect(configProblems({ ...valid, styles: { ...valid.styles, strategy: "co-located" } }))
      .toEqual([`"styles.strategy": "co-located" is not supported yet: use "parallel", or leave it out`]);
    expect(configProblems({ ...valid, assets: { strategy: "component-relative" } }))
      .toEqual([`"assets.strategy": "component-relative" is not supported yet: use "central", or leave it out`]);
    expect(configProblems({ ...valid, styles: { ...valid.styles, strategy: "flat" } }))
      .toEqual([`"styles.strategy" must be "parallel"`]);
  });

  it("rejects a config that is not an object", () => {
    expect(configProblems(undefined)).toHaveLength(1);
    expect(configProblems([])).toHaveLength(1);
  });
});

describe("configProblems — storefront", () => {
  it("needs only pagesDir and outDir", () => {
    expect(storefront({ pagesDir: "./pages", outDir: "./www" })).toEqual([]);
  });

  it("names a missing required key, and the typo that probably meant it", () => {
    expect(storefront({ outDir: "./www" })).toEqual([`missing required "site.pagesDir"`]);
    expect(storefront({ pageDir: "./pages", outDir: "./www" }))
      .toEqual([`missing required "site.pagesDir" (found "site.pageDir": did you mean "site.pagesDir"?)`]);
  });

  it("has no layouts key: layouts are the fixed layouts/ folder of the patterns", () => {
    expect(storefront({ pagesDir: "./pages", outDir: "./www", layouts: "skin/layouts" }))
      .toEqual([`unknown key "site.layouts"`]);
  });

  it("reports wrong value types by path", () => {
    expect(storefront({ pagesDir: 3, outDir: ["./www"] })).toEqual([
      `"site.pagesDir" must be a string`,
      `"site.outDir" must be a string`,
    ]);
  });

  it("takes an absolute http(s) URL for the workbench, and nothing else", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["https://workbench.example.com", "http://localhost:4000", "https://example.com/docs/workbench/",
      // A workbench on the storefront's own host: a root-relative path.
      "/workbench/", "/workbench", "/docs/workbench/", "/Docs/v2.1/work_bench~x/"]) {
      expect(storefront({ ...base, workbenchUrl: ok }), ok).toEqual([]);
    }
    const message = `"site.workbenchUrl" must be an absolute http(s) URL for a workbench on its own host, such as "https://workbench.example.com/", or a path for one on the storefront's host, such as "/workbench/"`;
    for (const bad of ["workbench.example.com", "ftp://example.com", "javascript:alert(1)", "", 42,
      "https://htwoo.io/workbench/?v=1", "https://htwoo.io/workbench/#top", "https://htwoo.io/workbench?",
      // Paths: "//host/" is another host to a browser; a relative path depends on the page; "/" is the storefront.
      "//evil.test/", "//evil.test/workbench/", "workbench/", "./workbench/", "/", "/workbench?x=1", "/workbench#top",
      "/work bench/", "/workbench//", "/../workbench/"]) {
      expect(storefront({ ...base, workbenchUrl: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes the site's address, with or without a path, and no query or fragment", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["https://example.com", "https://example.com/", "http://localhost:4300", "https://docs.example.com/",
      "https://example.com/docs/", "https://example.com/docs", "https://n8design.github.io/pattern-dump-demo/", "https://example.com/a/b/"]) {
      expect(storefront({ ...base, url: ok }), ok).toEqual([]);
    }
    const message = `"site.url" must be the site's absolute http(s) address, with no query or fragment, such as "https://example.com/", or "https://example.github.io/project/" for a site published under a path`;
    for (const bad of ["example.com", "/", "/docs/", "ftp://example.com", "", 42, "https://example.com/?v=1", "https://example.com/#top",
      "https://example.com?", "https://example.com/docs/?v=1", "https://example.com/docs#top", "https://example.com/a//b/"]) {
      expect(storefront({ ...base, url: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes a Handlebars file relative to the root for head", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["./head.hbs", "head.hbs", "site/head.hbs"]) expect(storefront({ ...base, head: ok }), ok).toEqual([]);
    const message = `"site.head" must be a Handlebars file relative to the project's root, such as "./head.hbs"`;
    for (const bad of ["./head.html", "/abs/head.hbs", "", 42]) expect(storefront({ ...base, head: bad }), String(bad)).toEqual([message]);
  });

  it("takes a language tag for lang", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["en", "de", "de-AT", "zh-Hant-TW", "es-419", "sl-rozaj", "de-CH-1901"]) {
      expect(storefront({ ...base, lang: ok }), ok).toEqual([]);
    }
    const message = `"site.lang" must be a language tag, such as "en", "de-AT" or "zh-Hant-TW"`;
    for (const bad of ["", "english", "e", "de_AT", "de-", "-de", "de AT", 7]) {
      expect(storefront({ ...base, lang: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes a colour token's name for assets.symbols.currentColor", () => {
    const symbols = (currentColor: unknown) => configProblems({ ...valid, assets: { symbols: { currentColor } } });
    for (const ok of ["--color-text", "--color-on_dark-2"]) expect(symbols(ok), ok).toEqual([]);
    const message = `"assets.symbols.currentColor" must be a colour token's name, such as "--color-text"`;
    for (const bad of ["color-text", "--text", "var(--color-text)", "#000", "", 7]) expect(symbols(bad), String(bad)).toEqual([message]);
    expect(configProblems({ ...valid, assets: { symbols: { currentColour: "--color-text" } } })[0]).toMatch(/currentColour.*currentColor/);
  });

  it("takes true or false for index", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, index: false })).toEqual([]);
    expect(storefront({ ...base, index: true })).toEqual([]);
    expect(storefront({ ...base, index: "no" })).toEqual([`"site.index" must be true or false`]);
  });

  it("takes a path to a file in the assets for image", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, image: "/assets/images/share.png" })).toEqual([]);
    const message = `"site.image" must be a path to a file in the assets, such as "/assets/images/share.png"`;
    for (const bad of ["images/share.png", "/images/share.png", "https://example.com/share.png", "/assets/", "/assets/images/",
      "/assets/share.png?v=1", 3]) {
      expect(storefront({ ...base, image: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes categories: each key a URL segment, with a label, an optional description and old keys (aliases)", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, categories: {
      guides: { label: "Guides" },
      "design-systems": { label: "Design systems", description: "How they are built", aliases: ["ds", "systems"] },
    } })).toEqual([]);
    expect(storefront({ ...base, categories: {} })).toEqual([]);
    expect(storefront({ ...base, categories: ["guides"] })).toEqual([
      `"site.categories" must be an object of categories by key, such as { guides: { label: "Guides" } }`,
    ]);
    expect(storefront({ ...base, categories: {
      Guides: { label: "Guides" },
      news: {},
      css: { label: 3, description: false, aliases: "style" },
      tools: { label: "Tools", title: "Tools" },
    } })).toEqual([
      `"site.categories.Guides": a category's key is part of a URL, so it is lowercase letters, digits and hyphens only`,
      `missing required "site.categories.news.label"`,
      `"site.categories.css.label" must be a string`,
      `"site.categories.css.description" must be a string`,
      `"site.categories.css.aliases" must be a list of strings`,
      `unknown key "site.categories.tools.title"`,
    ]);
  });

  it("refuses an alias that is not a URL segment, is a category's own key, or is claimed by two categories", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, categories: {
      guides: { label: "Guides", aliases: ["How To", "news"] },
      news: { label: "News", aliases: ["updates"] },
      blog: { label: "Blog", aliases: ["updates"] },
    } })).toEqual([
      `"site.categories.guides.aliases": "How To" is not a key: an old key is lowercase letters, digits and hyphens, as a key is`,
      `"site.categories.guides.aliases": "news" is a category of its own, so it can't be an old key of "guides"`,
      `"site.categories.blog.aliases": "updates" is an old key of "news" already: one old key leads to one category`,
    ]);
  });

  it("takes tags as categories are: each key a URL segment, with a label, an optional description and old keys", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, tags: { css: { label: "CSS", aliases: ["styles"] }, "design-tokens": { label: "Design tokens" } } })).toEqual([]);
    expect(storefront({ ...base, tags: ["css"] })).toEqual([
      `"site.tags" must be an object of tags by key, such as { css: { label: "CSS" } }`,
    ]);
    expect(storefront({ ...base, tags: { CSS: { label: "CSS" }, js: {}, html: { label: "HTML", aliases: ["js"] } } })).toEqual([
      `"site.tags.CSS": a tag's key is part of a URL, so it is lowercase letters, digits and hyphens only`,
      `missing required "site.tags.js.label"`,
      `"site.tags.html.aliases": "js" is a tag of its own, so it can't be an old key of "html"`,
    ]);
  });

  it("takes search: true or false", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, search: true })).toEqual([]);
    expect(storefront({ ...base, search: false })).toEqual([]);
    expect(storefront({ ...base, search: "pagefind" })).toEqual([`"site.search" must be true or false`]);
  });

  it("takes llms: true or false", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, llms: false })).toEqual([]);
    expect(storefront({ ...base, llms: "no" })).toEqual([`"site.llms" must be true or false`]);
  });

  it("takes checks: classes warning, error or off, and lists of allowed classes and properties", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, checks: { classes: "error", allowClasses: ["chart-*"], allowProperties: ["--x"] } })).toEqual([]);
    expect(storefront({ ...base, checks: { classes: "strict", allowClasses: "chart-*", allowProperty: [] } })).toEqual([
      `unknown key "site.checks.allowProperty": did you mean "site.checks.allowProperties"?`,
      `"site.checks.classes" must be "warning" or "error" or "off"`,
      `"site.checks.allowClasses" must be a list of strings`,
    ]);
  });

  it("takes tagPages and categoryPages: true, false, or { path, title }", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of [true, false, {}, { path: "topics" }, { title: "Topics" }, { path: "t2", title: "All tags" }]) {
      expect(storefront({ ...base, tagPages: ok }), JSON.stringify(ok)).toEqual([]);
      expect(storefront({ ...base, categoryPages: ok }), JSON.stringify(ok)).toEqual([]);
    }
    expect(storefront({ ...base, tagPages: "yes" })).toEqual([
      `"site.tagPages" must be true, false, or { path, title }, such as { path: "topics" }`,
    ]);
    expect(storefront({ ...base, categoryPages: { path: "Topics/x", slug: 1 } })).toEqual([
      `"site.categoryPages.path": the pages' first URL segment, so lowercase letters, digits and hyphens only, such as "topics"`,
      `unknown key "site.categoryPages.slug"`,
    ]);
    expect(storefront({ ...base, tagPages: { path: "topics" }, categoryPages: { path: "topics" } })).toEqual([
      `"site.tagPages.path" and "site.categoryPages.path" are both "topics": tag pages and category pages need a path each`,
    ]);
    expect(storefront({ ...base, categoryPages: { path: "tags" } })).toEqual([
      `"site.tagPages.path" and "site.categoryPages.path" are both "tags": tag pages and category pages need a path each`,
    ]);
  });

  it("accepts a workbench URL with a subpath", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, workbenchUrl: "https://htwoo.io/workbench/" })).toEqual([]);
    expect(storefront({ ...base, workbenchUrl: "https://htwoo.io/workbench" })).toEqual([]);
  });

  // site.pagesDir, patternsDir ("./src/patterns" in the fixture) and site.outDir must be
  // pairwise disjoint: for each pair, the same folder or either one inside the other is a problem.
  const same = (a: string, va: string, b: string, vb: string) =>
    `"${a}" ("${va}") and "${b}" ("${vb}") are the same folder: each needs a folder of its own`;
  const nested = (a: string, va: string, b: string, vb: string) =>
    `"${a}" ("${va}") is inside "${b}" ("${vb}"): each needs a folder of its own, outside the other`;
  const P = "site.pagesDir", T = "patternsDir", O = "site.outDir", PATTERNS = "./src/patterns";

  const cases: Array<[label: string, pagesDir: string, outDir: string, problem: string]> = [
    // pagesDir and patternsDir
    ["pages = patterns",        "./src/patterns",       "./www",              same(P, "./src/patterns", T, PATTERNS)],
    ["pages inside patterns",   "./src/patterns/pages", "./www",              nested(P, "./src/patterns/pages", T, PATTERNS)],
    ["patterns inside pages",   "./src",                "./www",              nested(T, PATTERNS, P, "./src")],
    // pagesDir and outDir
    ["pages = out",             "./pages",              "./pages",            same(P, "./pages", O, "./pages")],
    ["out inside pages",        "./pages",              "./pages/out",        nested(O, "./pages/out", P, "./pages")],
    ["pages inside out",        "./www/pages",          "./www",              nested(P, "./www/pages", O, "./www")],
    // patternsDir and outDir
    ["out = patterns",          "./pages",              "./src/patterns",     same(T, PATTERNS, O, "./src/patterns")],
    ["out inside patterns",     "./pages",              "./src/patterns/www", nested(O, "./src/patterns/www", T, PATTERNS)],
    ["patterns inside out",     "./pages",              "./src",              nested(T, PATTERNS, O, "./src")],
  ];
  for (const [label, pagesDir, outDir, problem] of cases) {
    it(`rejects ${label}, with the exact problem`, () => {
      expect(storefront({ pagesDir, outDir })).toEqual([problem]);
    });
  }

  it("compares folders as resolved paths, however they are spelled", () => {
    for (const pagesDir of ["./src/patterns", "src/patterns", "src/patterns/", "./src/./patterns"]) {
      expect(storefront({ pagesDir, outDir: "./www" }), pagesDir).toEqual([same(P, pagesDir, T, PATTERNS)]);
    }
  });

  it("reports every overlapping pair", () => {
    expect(storefront({ pagesDir: "./src/patterns", outDir: "src/patterns/" })).toEqual([
      same(P, "./src/patterns", T, PATTERNS),
      same(P, "./src/patterns", O, "src/patterns/"),
      same(T, PATTERNS, O, "src/patterns/"),
    ]);
  });

  it("accepts disjoint folders, including siblings whose names share a start", () => {
    const ok: Array<[pagesDir: string, outDir: string]> = [
      ["./pages", "./www"], ["./src/pages", "./src/www"], ["./src/patterns-site", "./src/patterns-www"],
      ["./pages-src", "./pages-out"], ["../site/pages", "../site/www"],
    ];
    for (const [pagesDir, outDir] of ok) expect(storefront({ pagesDir, outDir }), `${pagesDir} | ${outDir}`).toEqual([]);
  });

  it("takes the site's values as an object, of any keys: they are checked against the layouts, not here", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of [{}, { title: "A" }, { title: "A", nested: { x: [1, 2] }, flag: true }]) {
      expect(storefront({ ...base, site: ok }), JSON.stringify(ok)).toEqual([]);
    }
    const message = `"site.globals" must be an object of the site's values, such as { title: "My site" }`;
    for (const bad of [[], ["title"], "My site", 3, null, true]) {
      expect(storefront({ ...base, site: bad }), JSON.stringify(bad)).toEqual([message]);
    }
  });

  it("takes a bare host name for the storefront host, and nothing else", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["live.localhost", "docs.localhost", "localhost", "my-site.example.com"]) {
      expect(storefront({ ...base, host: ok }), ok).toEqual([]);
    }
    const message = `"site.host" must be a host name with no scheme, port or path, such as "live.localhost"`;
    for (const bad of ["http://live.localhost", "live.localhost:4000", "live.localhost/x", "-live.localhost", "", "live..localhost", 7]) {
      expect(storefront({ ...base, host: bad }), String(bad)).toEqual([message]);
    }
  });
});

describe("sameHostWorkbenchPath — a workbench published on the storefront's own host", () => {
  const path = (workbenchUrl: string | undefined, url?: string) => {
    const config = validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www",
      ...(workbenchUrl !== undefined ? { workbenchUrl } : {}), ...(url !== undefined ? { url } : {}) } }, "test");
    return sameHostWorkbenchPath(config.storefront);
  };

  it("is the path of a root-relative workbenchUrl, normalised to one trailing slash", () => {
    expect(path("/workbench/")).toBe("/workbench/");
    expect(path("/docs/workbench")).toBe("/docs/workbench/");
    expect(path("/workbench/", "https://example.com/")).toBe("/workbench/");
  });

  it("is the path of an absolute workbenchUrl on the origin of site.url", () => {
    expect(path("https://example.com/workbench", "https://example.com")).toBe("/workbench/");
    expect(path("https://example.com/", "https://example.com/")).toBe("/");
  });

  it("is the workbench's full path on a site published under a path", () => {
    expect(path("https://example.github.io/project/styleguide/", "https://example.github.io/project/")).toBe("/project/styleguide/");
    expect(path("/project/styleguide/", "https://example.github.io/project/")).toBe("/project/styleguide/");
    // Same origin, outside the site's path: still the same host.
    expect(path("https://example.github.io/other/", "https://example.github.io/project/")).toBe("/other/");
  });

  it("is undefined for a workbench on a host of its own, or with no workbenchUrl", () => {
    expect(path("https://workbench.example.com/", "https://example.com/")).toBeUndefined();
    expect(path("https://example.com:8443/workbench/", "https://example.com/")).toBeUndefined();
    expect(path("http://example.com/workbench/", "https://example.com/")).toBeUndefined();
    expect(path("https://example.com/workbench/")).toBeUndefined();
    expect(path(undefined, "https://example.com/")).toBeUndefined();
    expect(sameHostWorkbenchPath(undefined)).toBeUndefined();
  });
});

describe("validateConfig: site.workbenchUrl is stored with exactly one trailing slash", () => {
  const load = (workbenchUrl: string) =>
    validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www", workbenchUrl } }, "test").storefront?.workbenchUrl;

  it("adds the slash to a subpath without one, and keeps the one that is there", () => {
    expect(load("https://htwoo.io/workbench")).toBe("https://htwoo.io/workbench/");
    expect(load("https://htwoo.io/workbench/")).toBe("https://htwoo.io/workbench/");
  });

  it("collapses several trailing slashes to one", () => {
    expect(load("https://htwoo.io/workbench//")).toBe("https://htwoo.io/workbench/");
    expect(load("https://htwoo.io/workbench///")).toBe("https://htwoo.io/workbench/");
  });

  it("gives an origin-only URL its root slash", () => {
    expect(load("https://workbench.example.com")).toBe("https://workbench.example.com/");
    expect(load("https://workbench.example.com/")).toBe("https://workbench.example.com/");
  });

  it("returns a copy when it normalizes, and never changes the config it was given", () => {
    const raw = { ...valid, storefront: { pagesDir: "./pages", outDir: "./www", workbenchUrl: "https://htwoo.io/workbench" } };
    const before = JSON.stringify(raw);
    const config = validateConfig(raw, "test");
    expect(config).not.toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("leaves the rest of the config, and a storefront without workbenchUrl, as it was", () => {
    const config = validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www" } }, "test");
    expect(config.storefront).toEqual({ pagesDir: "./pages", outDir: "./www" });
    const { storefront: _sf, ...rest } = validateConfig(valid, "test");
    const { storefront: _vsf, ...validRest } = valid;
    expect(rest).toEqual(validRest);
  });
});

describe("validateConfig: site.url is stored as its origin and path with one trailing slash", () => {
  const load = (url: string) =>
    validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www", url } }, "test").storefront?.url;

  it("adds the root slash, and keeps it when it is there", () => {
    expect(load("https://example.com")).toBe("https://example.com/");
    expect(load("https://example.com/")).toBe("https://example.com/");
    expect(load("http://localhost:4300")).toBe("http://localhost:4300/");
  });

  it("keeps a path, with exactly one trailing slash", () => {
    expect(load("https://example.github.io/project")).toBe("https://example.github.io/project/");
    expect(load("https://example.github.io/project/")).toBe("https://example.github.io/project/");
    expect(load("https://example.github.io/project//")).toBe("https://example.github.io/project/");
    expect(load("https://example.com/a/b")).toBe("https://example.com/a/b/");
  });

  it("returns a copy when it normalizes, and never changes the config it was given", () => {
    const raw = { ...valid, storefront: { pagesDir: "./pages", outDir: "./www", url: "https://example.com" } };
    const before = JSON.stringify(raw);
    expect(validateConfig(raw, "test")).not.toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("validateConfig", () => {
  it("throws one error listing every problem, prefixed with the file", () => {
    expect(() => validateConfig({ sourceDir: 1 }, "pattern-dump.config.json")).toThrow(
      `pattern-dump.config.json: invalid config\n` +
      `  - missing required "outDir"\n` +
      `  - "sourceDir" must be a string`);
  });

  it("returns a valid config unchanged", () => {
    expect(validateConfig(valid, "x")).toBe(valid);
  });
});

describe("site: the website's settings, and their names before 0.8.0 (storefront)", () => {
  const { storefront: old, ...rest } = valid;
  const { site: globals, ...keys } = old!;
  const renamed = { ...rest, site: { ...keys, globals } };

  it("with the new names: loads silently, as the same config the old names give", () => {
    expect(configWarnings(renamed)).toEqual([]);
    expect(configProblems(renamed)).toEqual([]);
    expect(validateConfig(renamed, "x")).toEqual(validateConfig(valid, "x"));
    expect(validateConfig(renamed, "x").storefront?.site).toEqual({ title: "Docs", footer: "Made here", social: { links: ["a"] } });
  });

  it("with the old names: loads, with one warning per old key", () => {
    expect(configProblems(valid)).toEqual([]);
    expect(configWarnings(valid)).toEqual([
      "storefront.pagesDir is now site.pagesDir", "storefront.outDir is now site.outDir", "storefront.host is now site.host",
      "storefront.workbenchUrl is now site.workbenchUrl", "storefront.site is now site.globals", "storefront.images is now site.images",
    ]);
  });

  it("with both: a config problem", () => {
    const both = { ...renamed, storefront: old };
    expect(configProblems(both)).toEqual([`both "site" and "storefront" are set: storefront is the old name of site, keep site only`]);
    expect(() => validateConfig(both, "x")).toThrow(/both "site" and "storefront" are set/);
  });

  it("names a problem by the new path, whichever name the config uses", () => {
    expect(configProblems({ ...rest, site: { pagesDir: "./pages", outDir: 3 } })).toEqual([`"site.outDir" must be a string`]);
    expect(configProblems({ ...rest, storefront: { pagesDir: "./pages", outDir: 3 } })).toEqual([`"site.outDir" must be a string`]);
    expect(configProblems({ ...rest, site: { pagesDir: "./pages", outDir: "./www", site: {} } })).toEqual([`unknown key "site.site"`]);
    expect(configProblems({ ...rest, site: { pagesDir: "./pages", outDir: "./www", globals: 1 } }))
      .toEqual([`"site.globals" must be an object of the site's values, such as { title: "My site" }`]);
  });

  it("refuses storefront.globals: the new key under the old name", () => {
    expect(configProblems({ ...rest, storefront: { pagesDir: "./pages", outDir: "./www", globals: {} } }))
      .toEqual([`"storefront.globals" is not a key of the old storefront: write the website under site, and its globals there`]);
  });
});

describe("storefrontBasePath — the path the site is published under", () => {
  const base = (url?: string) => storefrontBasePath(validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www",
    ...(url !== undefined ? { url } : {}) } }, "test").storefront);

  it("is the path of site.url, with one trailing slash", () => {
    expect(base("https://example.github.io/project")).toBe("/project/");
    expect(base("https://example.com/a/b/")).toBe("/a/b/");
  });

  it("is / at the root of a host, for a site with no address, and with no storefront", () => {
    expect(base("https://example.com")).toBe("/");
    expect(base()).toBe("/");
    expect(storefrontBasePath(undefined)).toBe("/");
  });
});
