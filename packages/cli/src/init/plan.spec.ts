import { describe, expect, it } from "vitest";
import { planInit, toPackageName, type ExistingProject, type InitAnswers, type TemplateFile } from "./plan.js";

const templates: { base: TemplateFile[]; examples: TemplateFile[] } = {
  base: [
    { path: "pattern-dump.config.ts", content: 'import { defineConfig } from "__PD_PACKAGE__";\nbrand: { title: __PD_BRAND_JSON__ }\n' },
    { path: "README.md", content: "# __PD_NAME__\n" },
    { path: "_gitignore", content: "node_modules\n" },
  ],
  examples: [{ path: "src/patterns/atoms/button/button.hbs", content: "<button>{{label}}</button>\n" }],
};
const answers: InitAnswers = { name: "my-ds", brand: "My DS", examples: true, dependency: "^0.1.0" };
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
