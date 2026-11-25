import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readTemplates } from "./files.js";
import { defaultName, GENERIC_FOLDER_NAMES, INSTALL_SCRIPTS, PAGEFIND_VERSION, planInit, toPackageName, type ExistingProject, type InitAnswers, type Templates } from "./plan.js";

const templates: Templates = {
  base: [
    { path: "pattern-dump.config.ts", content: 'import { defineConfig } from "__PD_PACKAGE__";\n__PD_STOREFRONT__\nbrand: { title: __PD_BRAND_JSON__ }\n' },
    { path: "README.md", content: "# __PD_NAME__\n__PD_STOREFRONT_README__\n" },
    { path: "_gitignore", content: "node_modules\n__PD_STOREFRONT_GITIGNORE__\n" },
  ],
  examples: [{ path: "src/patterns/atoms/button/button.hbs", content: "<button>{{label}}</button>\n" }],
  storefront: [
    { path: "pages/index.md", content: "---\ntitle: Home\n---\n" },
    { path: "src/patterns/layouts/page/page.hbs", content: "{{#> partials-base }}{{{body}}}{{/partials-base}}\n" },
    { path: "src/patterns/partials/base/base.hbs", content: "<main>{{> @partial-block }}</main>\n" },
    { path: "src/patterns/partials/base/base.json", content: '{ "site": { "title": __PD_BRAND_JSON__ } }\n' },
    { path: "src/styles/partials/base.scss", content: ".site {}\n" },
    { path: "assets/icon.svg", content: "<svg/>\n" },
    { path: "src/patterns/views/list/list.hbs", content: "<ul>{{#each entries}}<li>{{title}}</li>{{/each}}</ul>\n" },
    { path: "src/styles/views/list.scss", content: ".view-list {}\n" },
    { path: "src/patterns/components/note/note.hbs", content: "<aside>{{heading}}</aside>\n" },
    { path: ".github/workflows/pages.yml", content: "name: Pages\n" },
  ],
  storefrontSystem: [
    { path: "themes/system.theme.scss", content: '[data-theme="system"] { color-scheme: light dark; }\n' },
    { path: "src/styles/base/colors.scss", content: ":root { color-scheme: light dark; }\n" },
  ],
  site: [
    { path: "pattern-dump.config.ts", content: 'import { defineConfig } from "__PD_PACKAGE__";\npackages: [__PD_SITE_PACKAGE_JSON__],\nworkbenchUrl: __PD_WORKBENCH_URL_JSON__,\n__PD_SEARCH_NOTE__\nsite: { title: __PD_BRAND_JSON__ }\n' },
    { path: "README.md", content: "# __PD_NAME__ on __PD_SITE_PACKAGE__\n__PD_SITE_PUBLISH_README__\n" },
    { path: "pages/index.md", content: "---\ntitle: Home\n---\n" },
    { path: "_gitignore", content: "node_modules\nsite\n" },
    { path: ".github/workflows/pages.yml", content: "name: Pages\n" },
  ],
  storefrontFills: { config: "storefront: { site: { title: __PD_BRAND_JSON__ } },\n", readme: "## The website\n", gitignore: "site\n_site\n" },
};
const answers: InitAnswers = { name: "my-ds", brand: "My DS", examples: true, storefront: false, search: false, systemTheme: false, dependency: "0.1.0" };
const empty: ExistingProject = { packageJson: null, exists: () => false };
const plan = (a: Partial<InitAnswers> = {}, existing: ExistingProject = empty) => {
  const r = planInit(templates, { ...answers, ...a }, existing, "pattern-dump");
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};
const content = (p: ReturnType<typeof plan>, path: string) => p.writes.find(w => w.path === path)?.content;

describe("planInit — a new folder", () => {
  it("writes every template, substituting the package, name and brand", () => {
    const p = plan();
    expect(p.writes.map(w => w.path)).toEqual([
      "pattern-dump.config.ts", "README.md", ".gitignore", "src/patterns/atoms/button/button.hbs",
    ]);
    expect(content(p, "pattern-dump.config.ts")).toBe('import { defineConfig } from "pattern-dump";\nbrand: { title: "My DS" }\n');
    expect(content(p, "README.md")).toBe("# my-ds\n");
    expect(p.skipped).toEqual([]);
  });

  it("leaves Handlebars {{…}} alone", () => {
    expect(content(plan(), "src/patterns/atoms/button/button.hbs")).toBe("<button>{{label}}</button>\n");
  });

  it("writes the brand as a string literal, so quotes cannot break the config", () => {
    expect(content(plan({ brand: 'The "Best" DS' }), "pattern-dump.config.ts")).toContain('title: "The \\"Best\\" DS"');
  });

  it("--no-examples writes the base only", () => {
    expect(plan({ examples: false }).writes.map(w => w.path)).not.toContain("src/patterns/atoms/button/button.hbs");
  });

  it("creates a package.json with the PD and TypeScript scripts, PD and TypeScript as devDependencies", () => {
    const p = plan({ name: "My Design System", dependency: "file:/tmp/pattern-dump-0.1.0.tgz" });
    expect(p.packageJson.created).toBe(true);
    expect(JSON.parse(p.packageJson.content)).toEqual({
      name: "my-design-system", version: "0.1.0", private: true, type: "module",
      scripts: { dev: "pd dev", audit: "pd audit", typecheck: "tsc --noEmit", "build:scripts": "tsc" },
      devDependencies: { "pattern-dump": "file:/tmp/pattern-dump-0.1.0.tgz", typescript: "^5.9.0" },
      allowScripts: { esbuild: true, "@parcel/watcher": true },
      patternDump: {
        patterns: "src/patterns",
        styles: { dir: "src/styles", documentBase: ["base"] },
        themes: { dir: "themes", default: "light", switch: "attribute" },
        scripts: "src/scripts",
        assets: ["assets"],
      },
    });
  });

  it("the patternDump field's default theme is the config's: system with a website that follows the viewer", () => {
    const themes = (a: Partial<InitAnswers>) => JSON.parse(plan(a).packageJson.content).patternDump.themes.default;
    expect(themes({ storefront: true, systemTheme: true })).toBe("system");
    expect(themes({ storefront: true, systemTheme: false })).toBe("light");
    expect(themes({ storefront: false, systemTheme: true })).toBe("light");
  });
});

describe("planInit — the storefront", () => {
  const SKIN = ["src/patterns/layouts/page/page.hbs", "src/patterns/partials/base/base.hbs", "src/patterns/partials/base/base.json",
    "src/styles/partials/base.scss", "assets/icon.svg", "src/patterns/views/list/list.hbs", "src/styles/views/list.scss"];
  const REST = ["pages/index.md", "src/patterns/components/note/note.hbs", ".github/workflows/pages.yml"];
  const existing = (files: string[]): ExistingProject => ({ packageJson: null, exists: p => files.includes(p) });

  it("without it: no storefront file, and every placeholder line gone", () => {
    const p = plan();
    expect(p.writes.map(w => w.path)).toEqual(["pattern-dump.config.ts", "README.md", ".gitignore", "src/patterns/atoms/button/button.hbs"]);
    expect(content(p, "pattern-dump.config.ts")).toBe('import { defineConfig } from "pattern-dump";\nbrand: { title: "My DS" }\n');
    expect(content(p, "README.md")).toBe("# my-ds\n");
    expect(content(p, ".gitignore")).toBe("node_modules\n");
    expect(JSON.parse(p.packageJson.content).scripts.build).toBeUndefined();
  });

  it("with it: every storefront file, the placeholders filled (and substituted), and a build script", () => {
    const p = plan({ storefront: true });
    expect(new Set(p.writes.map(w => w.path))).toEqual(new Set(["pattern-dump.config.ts", "README.md", ".gitignore",
      "src/patterns/atoms/button/button.hbs", ...SKIN, ...REST]));
    expect(content(p, "pattern-dump.config.ts")).toBe('import { defineConfig } from "pattern-dump";\nstorefront: { site: { title: "My DS" } },\nbrand: { title: "My DS" }\n');
    expect(content(p, "README.md")).toBe("# my-ds\n## The website\n");
    expect(content(p, ".gitignore")).toBe("node_modules\nsite\n_site\n");
    expect(content(p, "src/patterns/partials/base/base.json")).toBe('{ "site": { "title": "My DS" } }\n');
    expect(JSON.parse(p.packageJson.content).scripts.build).toBe("pd build");
    expect(p.skipped).toEqual([]);
  });

  it("with it and without the examples: the storefront needs none of them", () => {
    const paths = plan({ storefront: true, examples: false }).writes.map(w => w.path);
    expect(paths).not.toContain("src/patterns/atoms/button/button.hbs");
    expect(paths).toEqual(expect.arrayContaining([...SKIN, ...REST]));
  });

  it("leaves the whole skin out when one skin file is already there, and says which", () => {
    const p = plan({ storefront: true }, existing(["src/patterns/partials/base/base.hbs"]));
    const paths = p.writes.map(w => w.path);
    for (const s of SKIN) expect(paths, s).not.toContain(s);
    expect(paths).toEqual(expect.arrayContaining(REST));
    expect(p.skipped).toEqual([{ path: "src/patterns/partials/base/base.hbs", reason: "already exists: the site skin (7 files in src/patterns/layouts, "
      + "src/patterns/partials, src/patterns/views and their styles) was left out as a whole, so it isn't mixed with the skin already here" }]);
  });

  it("counts the views as the skin: a project with views of its own keeps them, and gets none of the starter's skin", () => {
    const p = plan({ storefront: true }, existing(["src/patterns/views/list/list.hbs"]));
    for (const s of SKIN) expect(p.writes.map(w => w.path), s).not.toContain(s);
    expect(p.skipped.map(s => s.path)).toEqual(["src/patterns/views/list/list.hbs"]);
  });

  it("writes the skin beside the project's own other layouts and partials", () => {
    const p = plan({ storefront: true }, existing(["src/patterns/layouts/hero/hero.hbs", "src/patterns/partials/card/card.hbs"]));
    expect(p.writes.map(w => w.path)).toEqual(expect.arrayContaining(SKIN));
    expect(p.skipped).toEqual([]);
  });

  it("skips the rest file by file, as every other template", () => {
    const p = plan({ storefront: true }, existing(["pages/index.md"]));
    expect(p.writes.map(w => w.path)).toEqual(expect.arrayContaining([...SKIN, ...REST.slice(1)]));
    expect(p.writes.map(w => w.path)).not.toContain("pages/index.md");
    expect(p.skipped).toEqual([{ path: "pages/index.md", reason: "already exists, left untouched" }]);
  });

  it("adds pd:build beside a project's own build script", () => {
    const r = planInit(templates, { ...answers, storefront: true }, { packageJson: { name: "x", scripts: { build: "vite build" } }, exists: () => false }, "pattern-dump");
    if (!r.ok) throw new Error(r.reason);
    expect(JSON.parse(r.plan.packageJson.content).scripts).toMatchObject({ build: "vite build", "pd:build": "pd build" });
  });
});

describe("planInit — an existing folder", () => {
  const existing = (files: string[], packageJson: Record<string, unknown> | null = null): ExistingProject =>
    ({ packageJson, exists: p => files.includes(p) });

  it("refuses when the folder already has a Pattern Dump config", () => {
    expect(planInit(templates, answers, existing(["pattern-dump.config.ts"]), "pattern-dump"))
      .toEqual({ ok: false, reason: expect.stringContaining("already a Pattern Dump project") });
  });

  it("never overwrites a file; it reports the skip", () => {
    const p = plan({}, existing(["README.md", ".gitignore"]));
    expect(p.writes.map(w => w.path)).toEqual(["pattern-dump.config.ts", "src/patterns/atoms/button/button.hbs"]);
    expect(p.skipped.map(s => s.path)).toEqual(["README.md", ".gitignore"]);
  });

  it("merges into package.json, keeping every existing field", () => {
    const current = { name: "acme-ui", version: "3.2.1", type: "commonjs", scripts: { build: "tsc" }, devDependencies: { typescript: "^5" } };
    const p = plan({}, existing(["package.json"], current));
    expect(p.packageJson.created).toBe(false);
    expect(JSON.parse(p.packageJson.content)).toEqual({
      name: "acme-ui", version: "3.2.1", type: "commonjs",
      scripts: { build: "tsc", dev: "pd dev", audit: "pd audit", typecheck: "tsc --noEmit", "build:scripts": "tsc" },
      devDependencies: { typescript: "^5", "pattern-dump": "0.1.0" },
      allowScripts: { esbuild: true, "@parcel/watcher": true },
    });
  });

  it("keeps the project's own TypeScript version — another toolchain may pin it — and says so", () => {
    const p = plan({}, existing(["package.json"], { dependencies: { typescript: "~5.8.0" } }));
    const pkg = JSON.parse(p.packageJson.content);
    expect(pkg.dependencies).toEqual({ typescript: "~5.8.0" });
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(p.packageJson.notes).toEqual([expect.stringContaining("typescript is already a dependency (~5.8.0)")]);
  });

  it("does not replace the project's own typecheck script; adds pd:typecheck beside it", () => {
    const p = plan({}, existing(["package.json"], { scripts: { typecheck: "vue-tsc --noEmit" } }));
    expect(JSON.parse(p.packageJson.content).scripts).toMatchObject({ typecheck: "vue-tsc --noEmit", "pd:typecheck": "tsc --noEmit" });
  });

  it("does not replace the project's own dev script; adds pd:dev beside it", () => {
    const p = plan({}, existing(["package.json"], { scripts: { dev: "vite" } }));
    expect(JSON.parse(p.packageJson.content).scripts).toEqual({
      dev: "vite", "pd:dev": "pd dev", audit: "pd audit", typecheck: "tsc --noEmit", "build:scripts": "tsc",
    });
    expect(p.packageJson.notes).toEqual(['script "dev" already exists: added "pd:dev" instead']);
  });

  it("leaves an existing PD dependency at its version", () => {
    const p = plan({}, existing(["package.json"], { devDependencies: { "pattern-dump": "^0.0.9" } }));
    expect(JSON.parse(p.packageJson.content).devDependencies).toEqual({ "pattern-dump": "^0.0.9", typescript: "^5.9.0" });
    expect(p.packageJson.notes[0]).toContain("already a devDependency");
  });
});

describe("toPackageName", () => {
  it("turns a folder name into a valid npm name", () => {
    expect(toPackageName("My Design System")).toBe("my-design-system");
    expect(toPackageName("acme_ui.v2")).toBe("acme_ui.v2");
    expect(toPackageName("  !!  ")).toBe("design-system");
  });

  it("keeps a scope a scope", () => {
    expect(toPackageName("@Acme Web/Style Guide")).toBe("@acme-web/style-guide");
    expect(toPackageName("@/x")).toBe("x");
  });
});

describe("planInit — search, install scripts, the system theme", () => {
  const pkg = (p: ReturnType<typeof plan>) => JSON.parse(p.packageJson.content) as Record<string, Record<string, unknown>>;

  it("search adds Pagefind, pinned exactly; without it, or without a website, there is none", () => {
    expect(pkg(plan({ storefront: true, search: true })).devDependencies!.pagefind).toBe(PAGEFIND_VERSION);
    expect(pkg(plan({ storefront: true, search: false })).devDependencies!.pagefind).toBeUndefined();
    expect(pkg(plan({ storefront: false, search: true })).devDependencies!.pagefind).toBeUndefined();
  });

  it("keeps a project's own Pagefind, and says so", () => {
    const p = plan({ storefront: true, search: true }, { packageJson: { name: "x", devDependencies: { pagefind: "^1.0.0" } }, exists: () => false });
    expect(pkg(p).devDependencies!.pagefind).toBe("^1.0.0");
    expect(p.packageJson.notes).toContain("pagefind is already a dependency (^1.0.0), left as is");
  });

  it("allows Pattern Dump's own install scripts, by name, and keeps a denial the project wrote", () => {
    expect(pkg(plan()).allowScripts).toEqual({ esbuild: true, "@parcel/watcher": true });
    const p = plan({}, { packageJson: { name: "x", allowScripts: { esbuild: false, sharp: true } }, exists: () => false });
    expect(pkg(p).allowScripts).toEqual({ esbuild: false, sharp: true, "@parcel/watcher": true });
    expect(p.packageJson.notes).toContain("allowScripts denies esbuild, left as is: Pattern Dump needs its install script");
  });

  it("the lists are the repository's: Pagefind's version is the one locked, each install script is one", async () => {
    const lock = JSON.parse(await readFile(fileURLToPath(new URL("../../../../package-lock.json", import.meta.url)), "utf8")) as
      { packages: Record<string, { version: string; hasInstallScript?: boolean }> };
    expect(lock.packages["node_modules/pagefind"]!.version).toBe(PAGEFIND_VERSION);
    for (const name of INSTALL_SCRIPTS) expect(lock.packages[`node_modules/${name}`]!.hasInstallScript, name).toBe(true);
  });

  it("a system theme with a website: the theme and the skin's colours written, the config's default system", () => {
    const shippedConfig = { path: "pattern-dump.config.ts", content: 'themes: { default: "__PD_THEME_DEFAULT__" }\n' };
    const withConfig: Templates = { ...templates, base: [shippedConfig] };
    const run = (a: Partial<InitAnswers>) => { const r = planInit(withConfig, { ...answers, ...a }, empty, "pattern-dump"); if (!r.ok) throw new Error(r.reason); return r.plan; };
    const on = run({ storefront: true, systemTheme: true });
    expect(on.writes.map(w => w.path)).toEqual(expect.arrayContaining(["themes/system.theme.scss", "src/styles/base/colors.scss"]));
    expect(content(on, "pattern-dump.config.ts")).toBe('themes: { default: "system" }\n');
    for (const off of [run({ storefront: true, systemTheme: false }), run({ storefront: false, systemTheme: true })]) {
      expect(off.writes.map(w => w.path)).not.toContain("themes/system.theme.scss");
      expect(content(off, "pattern-dump.config.ts")).toBe('themes: { default: "light" }\n');
    }
  });

  it("the skin's colours belong to the skin: a skin already there leaves them out with it", () => {
    const p = plan({ storefront: true, systemTheme: true }, { packageJson: null, exists: f => f === "src/patterns/partials/base/base.hbs" });
    expect(p.writes.map(w => w.path)).not.toContain("src/styles/base/colors.scss");
    expect(p.writes.map(w => w.path)).toContain("themes/system.theme.scss");
  });
});

describe("planInit — a content-only site (--site)", () => {
  const site = (spec: string, a: Partial<InitAnswers> = {}) =>
    plan({ examples: false, search: true, ...a, site: { name: "@acme/styleguide", spec, workbenchUrl: "https://wb.example.com/" } });

  it("writes the site's files only: config, pages, README, .gitignore, and a workflow for a style guide from the registry", () => {
    const p = site("1.2.0");
    expect(p.writes.map(w => w.path)).toEqual(["pattern-dump.config.ts", "README.md", "pages/index.md", ".gitignore", ".github/workflows/pages.yml"]);
    expect(p.dirs).toEqual([]);
    expect(content(p, "pattern-dump.config.ts")).toBe('import { defineConfig } from "pattern-dump";\npackages: ["@acme/styleguide"],\n'
      + 'workbenchUrl: "https://wb.example.com/",\n    // Search: pd build indexes every page with Pagefind (a devDependency of this site); components/search is the\n'
      + '    // search field. search: true makes a build without Pagefind stop, false turns it off.\nsite: { title: "My DS" }\n');
    expect(content(p, "README.md")).toMatch(/^# my-ds on @acme\/styleguide\n\n## Publish it\n\n`\.github\/workflows\/pages\.yml` builds the website/);
  });

  it("a style guide in a folder: no workflow (the repository's root publishes both), and the README says so", () => {
    const p = site("file:../styleguide");
    expect(p.writes.map(w => w.path)).not.toContain(".github/workflows/pages.yml");
    expect(content(p, "README.md")).toContain("The style guide is a folder next to this one, so the repository's root builds and publishes both");
  });

  it("package.json: dev and build, Pattern Dump, the style guide and Pagefind pinned, no TypeScript", () => {
    expect(JSON.parse(site("file:../styleguide").packageJson.content)).toEqual({
      name: "my-ds", version: "0.1.0", private: true, type: "module",
      scripts: { dev: "pd dev", build: "pd build" },
      devDependencies: { "pattern-dump": "0.1.0", "@acme/styleguide": "file:../styleguide", pagefind: PAGEFIND_VERSION },
      allowScripts: { esbuild: true, "@parcel/watcher": true },
    });
    expect(JSON.parse(site("1.2.0", { search: false }).packageJson.content).devDependencies).toEqual({ "pattern-dump": "0.1.0", "@acme/styleguide": "1.2.0" });
  });

  it("keeps a project's own dependency on the style guide, and says so", () => {
    const r = planInit(templates, { ...answers, site: { name: "@acme/styleguide", spec: "2.0.0", workbenchUrl: "/workbench/" } },
      { packageJson: { name: "x", devDependencies: { "@acme/styleguide": "^1.0.0" } }, exists: () => false }, "pattern-dump");
    if (!r.ok) throw new Error(r.reason);
    expect(JSON.parse(r.plan.packageJson.content).devDependencies["@acme/styleguide"]).toBe("^1.0.0");
    expect(r.plan.packageJson.notes).toContain("@acme/styleguide is already a dependency (^1.0.0), left as is");
  });
});

describe("defaultName", () => {
  it("a generic folder name is scoped by its parent, which also titles it", () => {
    expect(defaultName("styleguide", "acme-web")).toEqual({ name: "@acme-web/styleguide", brand: "acme-web" });
    expect(defaultName("site", "Acme Web")).toEqual({ name: "@acme-web/site", brand: "Acme Web" });
    for (const generic of GENERIC_FOLDER_NAMES) expect(defaultName(generic, "acme").name).toBe(`@acme/${generic}`);
  });

  it("any other folder name stays as it was, and a generic one without a usable parent too", () => {
    expect(defaultName("Acme DS", "work")).toEqual({ name: "acme-ds", brand: "acme-ds" });
    expect(defaultName("styleguide", "")).toEqual({ name: "styleguide", brand: "styleguide" });
    expect(defaultName("site", "!!")).toEqual({ name: "site", brand: "site" });
  });
});

describe("planInit — the shipped templates", () => {
  const shipped = readTemplates(fileURLToPath(new URL("../../templates", import.meta.url)));
  for (const spec of ["1.2.0", "file:../styleguide"]) {
    for (const search of [false, true]) {
      it(`leaves no placeholder in a site's files (${spec}, search ${search})`, async () => {
        const r = planInit(await shipped, { ...answers, search, site: { name: "@acme/styleguide", spec, workbenchUrl: "/workbench/" } }, empty, "pattern-dump");
        if (!r.ok) throw new Error(r.reason);
        for (const w of r.plan.writes) expect(w.content, w.path).not.toMatch(/__PD_[A-Z_]+__/);
        const config = r.plan.writes.find(w => w.path === "pattern-dump.config.ts")!.content;
        expect(config).toContain(`packages: ["@acme/styleguide"]`);
        expect(config).toContain(`build: { workbench: false }`);
        expect(config).toContain(`    lang: "en",\n`);
        expect(r.plan.writes.some(w => w.path.startsWith("src/") || w.path.startsWith("themes/"))).toBe(false);
      });
    }
  }
  for (const storefront of [false, true]) {
    for (const examples of [false, true]) {
      it(`leaves no placeholder in any file it writes (storefront ${storefront}, examples ${examples})`, async () => {
        const r = planInit(await shipped, { ...answers, storefront, examples, search: storefront, systemTheme: storefront }, empty, "pattern-dump");
        if (!r.ok) throw new Error(r.reason);
        for (const w of r.plan.writes) expect(w.content, w.path).not.toMatch(/__PD_[A-Z_]+__/);
        expect(r.plan.packageJson.content).not.toMatch(/__PD_/);
        const config = r.plan.writes.find(w => w.path === "pattern-dump.config.ts")!.content;
        expect(config.includes(`workbenchUrl: "/workbench/"`)).toBe(storefront);
        expect(config.includes(`    lang: "en",\n`)).toBe(storefront);
        expect(r.plan.writes.some(w => w.path === ".github/workflows/pages.yml")).toBe(storefront);
      });
    }
  }
});
