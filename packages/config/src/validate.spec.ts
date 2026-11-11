import { describe, it, expect } from "vitest";
import { configProblems, sameHostWorkbenchPath, validateConfig } from "./validate.js";
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
  build: { outDir: "./site", basePath: "/docs/", audit: false },
  storefront: {
    pagesDir: "./pages", outDir: "./site-www", host: "docs.localhost", workbenchUrl: "https://workbench.example.com/",
    site: { title: "Docs", footer: "Made here", social: { links: ["a"] } },
  },
};

const storefront = (sf: Record<string, unknown>) => configProblems({ ...valid, storefront: sf });

describe("configProblems", () => {
  it("accepts every documented option", () => {
    expect(configProblems(valid)).toEqual([]);
  });

  it("accepts the minimal config, with no strategy", () => {
    // Also a type check: defineConfig must accept it, so `npm run typecheck` fails if strategy
    // becomes required again.
    const minimal = defineConfig({ sourceDir: "s", patternsDir: "p", outDir: "o", styles: { dir: "d" } });
    expect(configProblems(minimal)).toEqual([]);
  });

  it("names a missing required key, and the typo that probably meant it", () => {
    const { styles, ...rest } = valid;
    expect(configProblems({ ...rest, style: styles }))
      .toEqual([`missing required "styles" (found "style" — did you mean "styles"?)`]);
    expect(configProblems({ ...rest })).toEqual([`missing required "styles"`]);
  });

  it("rejects unknown keys at any depth, with a suggestion when one is close", () => {
    expect(configProblems({ ...valid, dataDirectory: "x", colour: 1 })).toEqual([
      `unknown key "dataDirectory"`,
      `unknown key "colour"`,
    ]);
    expect(configProblems({ ...valid, overview: true })).toEqual([`unknown key "overview" — did you mean "overviews"?`]);
    expect(configProblems({ ...valid, styles: { ...valid.styles, entries: "x" } }))
      .toEqual([`unknown key "styles.entries" — did you mean "styles.entry"?`]);
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
      .toEqual([`"styles.strategy": "co-located" is not supported yet — use "parallel", or leave it out`]);
    expect(configProblems({ ...valid, assets: { strategy: "component-relative" } }))
      .toEqual([`"assets.strategy": "component-relative" is not supported yet — use "central", or leave it out`]);
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
    expect(storefront({ outDir: "./www" })).toEqual([`missing required "storefront.pagesDir"`]);
    expect(storefront({ pageDir: "./pages", outDir: "./www" }))
      .toEqual([`missing required "storefront.pagesDir" (found "storefront.pageDir" — did you mean "storefront.pagesDir"?)`]);
  });

  it("has no layouts key: layouts are the fixed layouts/ folder of the patterns", () => {
    expect(storefront({ pagesDir: "./pages", outDir: "./www", layouts: "skin/layouts" }))
      .toEqual([`unknown key "storefront.layouts"`]);
  });

  it("reports wrong value types by path", () => {
    expect(storefront({ pagesDir: 3, outDir: ["./www"] })).toEqual([
      `"storefront.pagesDir" must be a string`,
      `"storefront.outDir" must be a string`,
    ]);
  });

  it("takes an absolute http(s) URL for the workbench, and nothing else", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["https://workbench.example.com", "http://localhost:4000", "https://example.com/docs/workbench/",
      // A workbench on the storefront's own host: a root-relative path.
      "/workbench/", "/workbench", "/docs/workbench/", "/Docs/v2.1/work_bench~x/"]) {
      expect(storefront({ ...base, workbenchUrl: ok }), ok).toEqual([]);
    }
    const message = `"storefront.workbenchUrl" must be an absolute http(s) URL for a workbench on its own host, such as "https://workbench.example.com/", or a path for one on the storefront's host, such as "/workbench/"`;
    for (const bad of ["workbench.example.com", "ftp://example.com", "javascript:alert(1)", "", 42,
      "https://htwoo.io/workbench/?v=1", "https://htwoo.io/workbench/#top", "https://htwoo.io/workbench?",
      // Paths: "//host/" is another host to a browser; a relative path depends on the page; "/" is the storefront.
      "//evil.test/", "//evil.test/workbench/", "workbench/", "./workbench/", "/", "/workbench?x=1", "/workbench#top",
      "/work bench/", "/workbench//", "/../workbench/"]) {
      expect(storefront({ ...base, workbenchUrl: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes the site's address as an origin only: no path, query or fragment", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["https://example.com", "https://example.com/", "http://localhost:4300", "https://docs.example.com/"]) {
      expect(storefront({ ...base, url: ok }), ok).toEqual([]);
    }
    const message = `"storefront.url" must be the site's absolute http(s) address, with no path, query or fragment, such as "https://example.com/"`;
    for (const bad of ["example.com", "/", "ftp://example.com", "", 42, "https://example.com/docs/", "https://example.com/docs",
      "https://example.com/?v=1", "https://example.com/#top", "https://example.com?"]) {
      expect(storefront({ ...base, url: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes a language tag for lang", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["en", "de", "de-AT", "zh-Hant-TW", "es-419", "sl-rozaj", "de-CH-1901"]) {
      expect(storefront({ ...base, lang: ok }), ok).toEqual([]);
    }
    const message = `"storefront.lang" must be a language tag, such as "en", "de-AT" or "zh-Hant-TW"`;
    for (const bad of ["", "english", "e", "de_AT", "de-", "-de", "de AT", 7]) {
      expect(storefront({ ...base, lang: bad }), String(bad)).toEqual([message]);
    }
  });

  it("takes true or false for index", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, index: false })).toEqual([]);
    expect(storefront({ ...base, index: true })).toEqual([]);
    expect(storefront({ ...base, index: "no" })).toEqual([`"storefront.index" must be true or false`]);
  });

  it("takes a path to a file in the assets for image", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, image: "/assets/images/share.png" })).toEqual([]);
    const message = `"storefront.image" must be a path to a file in the assets, such as "/assets/images/share.png"`;
    for (const bad of ["images/share.png", "/images/share.png", "https://example.com/share.png", "/assets/", "/assets/images/",
      "/assets/share.png?v=1", 3]) {
      expect(storefront({ ...base, image: bad }), String(bad)).toEqual([message]);
    }
  });

  it("accepts a workbench URL with a subpath", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    expect(storefront({ ...base, workbenchUrl: "https://htwoo.io/workbench/" })).toEqual([]);
    expect(storefront({ ...base, workbenchUrl: "https://htwoo.io/workbench" })).toEqual([]);
  });

  // storefront.pagesDir, patternsDir ("./src/patterns" in the fixture) and storefront.outDir must be
  // pairwise disjoint: for each pair, the same folder or either one inside the other is a problem.
  const same = (a: string, va: string, b: string, vb: string) =>
    `"${a}" ("${va}") and "${b}" ("${vb}") are the same folder — each needs a folder of its own`;
  const nested = (a: string, va: string, b: string, vb: string) =>
    `"${a}" ("${va}") is inside "${b}" ("${vb}") — each needs a folder of its own, outside the other`;
  const P = "storefront.pagesDir", T = "patternsDir", O = "storefront.outDir", PATTERNS = "./src/patterns";

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
    const message = `"storefront.site" must be an object of the site's values, such as { title: "My site" }`;
    for (const bad of [[], ["title"], "My site", 3, null, true]) {
      expect(storefront({ ...base, site: bad }), JSON.stringify(bad)).toEqual([message]);
    }
  });

  it("takes a bare host name for the storefront host, and nothing else", () => {
    const base = { pagesDir: "./pages", outDir: "./www" };
    for (const ok of ["live.localhost", "docs.localhost", "localhost", "my-site.example.com"]) {
      expect(storefront({ ...base, host: ok }), ok).toEqual([]);
    }
    const message = `"storefront.host" must be a host name with no scheme, port or path, such as "live.localhost"`;
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

  it("is the path of an absolute workbenchUrl on the origin of storefront.url", () => {
    expect(path("https://example.com/workbench", "https://example.com")).toBe("/workbench/");
    expect(path("https://example.com/", "https://example.com/")).toBe("/");
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

describe("validateConfig — storefront.workbenchUrl is stored with exactly one trailing slash", () => {
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

describe("validateConfig — storefront.url is stored as its origin with one slash", () => {
  const load = (url: string) =>
    validateConfig({ ...valid, storefront: { pagesDir: "./pages", outDir: "./www", url } }, "test").storefront?.url;

  it("adds the root slash, and keeps it when it is there", () => {
    expect(load("https://example.com")).toBe("https://example.com/");
    expect(load("https://example.com/")).toBe("https://example.com/");
    expect(load("http://localhost:4300")).toBe("http://localhost:4300/");
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
      `  - missing required "patternsDir"\n` +
      `  - missing required "outDir"\n` +
      `  - missing required "styles"\n` +
      `  - "sourceDir" must be a string`);
  });

  it("returns a valid config unchanged", () => {
    expect(validateConfig(valid, "x")).toBe(valid);
  });
});
