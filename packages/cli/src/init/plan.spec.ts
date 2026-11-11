import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readTemplates } from "./files.js";
import { planInit, toPackageName, type ExistingProject, type InitAnswers, type Templates } from "./plan.js";

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
    { path: "src/patterns/components/note/note.hbs", content: "<aside>{{heading}}</aside>\n" },
    { path: ".github/workflows/pages.yml", content: "name: Pages\n" },
  ],
  storefrontFills: { config: "storefront: { site: { title: __PD_BRAND_JSON__ } },\n", readme: "## The website\n", gitignore: "site\n_site\n" },
};
const answers: InitAnswers = { name: "my-ds", brand: "My DS", examples: true, storefront: false, dependency: "^0.1.0" };
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
    });
  });
});

describe("planInit — the storefront", () => {
  const SKIN = ["src/patterns/layouts/page/page.hbs", "src/patterns/partials/base/base.hbs", "src/patterns/partials/base/base.json",
    "src/styles/partials/base.scss", "assets/icon.svg"];
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
    expect(p.skipped).toEqual([{ path: "src/patterns/partials/base/base.hbs", reason: "already exists — the storefront skin (5 files in src/patterns/layouts, "
      + "src/patterns/partials and their styles) was left out as a whole, so it isn't mixed with the skin already here" }]);
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
    expect(p.skipped).toEqual([{ path: "pages/index.md", reason: "already exists — left untouched" }]);
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
      devDependencies: { typescript: "^5", "pattern-dump": "^0.1.0" },
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
    expect(p.packageJson.notes).toEqual(['script "dev" already exists — added "pd:dev" instead']);
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
});

describe("planInit — the shipped templates", () => {
  const shipped = readTemplates(fileURLToPath(new URL("../../templates", import.meta.url)));
  for (const storefront of [false, true]) {
    for (const examples of [false, true]) {
      it(`leaves no placeholder in any file it writes (storefront ${storefront}, examples ${examples})`, async () => {
        const r = planInit(await shipped, { ...answers, storefront, examples }, empty, "pattern-dump");
        if (!r.ok) throw new Error(r.reason);
        for (const w of r.plan.writes) expect(w.content, w.path).not.toMatch(/__PD_[A-Z_]+__/);
        expect(r.plan.packageJson.content).not.toMatch(/__PD_/);
        const config = r.plan.writes.find(w => w.path === "pattern-dump.config.ts")!.content;
        expect(config.includes(`workbenchUrl: "/workbench/"`)).toBe(storefront);
        expect(r.plan.writes.some(w => w.path === ".github/workflows/pages.yml")).toBe(storefront);
      });
    }
  }
});
