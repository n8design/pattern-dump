// The whole `pd init` flow against a real temp folder, with scripted answers and a recorded process
// runner — nothing is installed and no repository is created.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dependencySpec, runInit, type InitIO } from "./run.js";
import { PD_VERSION } from "../distribution.js";
import { PAGEFIND_VERSION } from "./plan.js";
import { save } from "../../../../test-support/save.js";

const templatesDir = fileURLToPath(new URL("../../templates/", import.meta.url));
let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

function fakeIO(over: Partial<InitIO> & { answers?: Record<string, string | boolean>; exitCodes?: Record<string, number> } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const asked: string[] = [];
  const io: InitIO = {
    cwd: root, templatesDir, interactive: false,
    ask: async (q, fallback) => { asked.push(q); return (over.answers?.[q] as string | undefined) ?? fallback; },
    confirm: async (q, fallback) => { asked.push(q); return (over.answers?.[q] as boolean | undefined) ?? fallback; },
    log: m => { logs.push(m); },
    run: async (command, args) => {
      const key = [command, ...args].join(" ");
      calls.push(key);
      return over.exitCodes?.[key] ?? (key.startsWith("git rev-parse") ? 128 : 0);
    },
    ...over,
  };
  return { io, calls, logs, asked };
}

const init = (target: string, extra: Record<string, unknown> = {}) =>
  ({ kind: "init" as const, target, yes: false, ...extra });

describe("runInit", () => {
  it("scaffolds a new folder non-interactively with defaults, then git init and npm install", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const target = join(root, "Acme DS");
    const { io, calls, logs } = fakeIO();
    expect(await runInit(init(target), io)).toBe(0);

    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "acme-ds", scripts: { dev: "pd dev" }, devDependencies: { "pattern-dump": PD_VERSION } });
    expect(await readFile(join(target, "pattern-dump.config.ts"), "utf8")).toContain('title: "acme-ds"');
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    expect(existsSync(join(target, "src/patterns/atoms/button/button.hbs"))).toBe(true);
    expect(existsSync(join(target, "assets"))).toBe(true);
    expect(calls).toEqual(["git rev-parse --is-inside-work-tree", "git init -q", "npm install"]);
    expect(logs.at(-1)).toContain("npm run dev");
  });

  it("names a generic folder by its parent: suggested in the prompt, used with --yes, and printed", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const target = join(root, "acme-web", "styleguide");
    const asked = fakeIO({ interactive: true });
    const defaults: Record<string, string> = {};
    asked.io.ask = async (q, fallback) => { defaults[q] = fallback; return fallback; };
    expect(await runInit(init(target, { install: false, git: false, examples: false, storefront: false }), asked.io)).toBe(0);
    expect(defaults).toEqual({ "Project name": "@acme-web/styleguide", "Title in the Nav Rail": "acme-web" });
    expect(asked.logs).toContain(`✓ package.json created: @acme-web/styleguide, with pattern-dump ${PD_VERSION}`);

    const yes = fakeIO();
    const other = join(root, "acme-web", "site");
    expect(await runInit(init(other, { yes: true, install: false, git: false }), yes.io)).toBe(0);
    expect(JSON.parse(await readFile(join(other, "package.json"), "utf8")).name).toBe("@acme-web/site");
    expect(await readFile(join(other, "pattern-dump.config.ts"), "utf8")).toContain('title: "acme-web"');
    expect(yes.logs).toContain(`✓ package.json created: @acme-web/site, with pattern-dump ${PD_VERSION}`);
  });

  it("asks only for what flags did not answer, and honours the answers", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const target = join(root, "ds");
    const { io, asked, calls } = fakeIO({
      interactive: true,
      answers: { "Title in the Nav Rail": "Acme", "Include starter components": false, "Initialise a git repository": false },
    });
    expect(await runInit(init(target, { name: "acme", install: false }), io)).toBe(0);
    expect(asked).toEqual(["A website on an existing style guide package? Its npm name or folder (empty: a new design system)",
      "Title in the Nav Rail", "Include starter components", "Include a website (storefront)", "Initialise a git repository"]);
    expect(await readFile(join(target, "pattern-dump.config.ts"), "utf8")).toContain('title: "Acme"');
    expect(existsSync(join(target, "src/patterns/atoms"))).toBe(false);
    expect(calls).toEqual(["git rev-parse --is-inside-work-tree"]);
  });

  it("asks about the website after the starter components, default no, and writes it on a yes", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const asked = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "no"), { install: false, git: false }), asked.io)).toBe(0);
    expect(asked.asked.slice(3, 5)).toEqual(["Include starter components", "Include a website (storefront)"]);
    expect(existsSync(join(root, "no", "pages"))).toBe(false);

    const yes = fakeIO({ interactive: true, answers: { "Include a website (storefront)": true } });
    expect(await runInit(init(join(root, "yes"), { install: false, git: false }), yes.io)).toBe(0);
    expect(existsSync(join(root, "yes", "pages", "index.md"))).toBe(true);
    expect(await readFile(join(root, "yes", "pattern-dump.config.ts"), "utf8")).toContain(`workbenchUrl: "/workbench/"`);
  });

  it("--storefront writes the website without asking, and the next steps name both addresses", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, asked, logs } = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "ds"), { storefront: true, install: false, git: false }), io)).toBe(0);
    expect(asked).not.toContain("Include a website (storefront)");
    expect(existsSync(join(root, "ds", ".github", "workflows", "pages.yml"))).toBe(true);
    expect(logs.at(-1)).toBe("  npm run dev      # the website at http://live.localhost:4000/, the workbench at http://pd.localhost:4000/");
    // Search and the system theme are asked for with the website, both yes by default.
    expect(asked).toEqual(expect.arrayContaining(["Include site search (Pagefind)", "Follow the viewer's light or dark setting (a system theme as the default)"]));
    const pkg = JSON.parse(await readFile(join(root, "ds", "package.json"), "utf8"));
    expect(pkg.devDependencies.pagefind).toBe(PAGEFIND_VERSION);
    expect(await readFile(join(root, "ds", "pattern-dump.config.ts"), "utf8")).toContain('default: "system"');
  });

  it("--no-search and --no-system-theme answer both questions; the Pagefind hint comes back without search", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, asked, logs } = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "ds"), { storefront: true, search: false, systemTheme: false, install: false, git: false }), io)).toBe(0);
    expect(asked.filter(q => /Pagefind|light or dark/.test(q))).toEqual([]);
    expect(JSON.parse(await readFile(join(root, "ds", "package.json"), "utf8")).devDependencies.pagefind).toBeUndefined();
    expect(await readFile(join(root, "ds", "pattern-dump.config.ts"), "utf8")).toContain('default: "light"');
    expect(existsSync(join(root, "ds", "themes", "system.theme.scss"))).toBe(false);
    expect(logs.at(-1)).toBe("  npm install --save-dev pagefind   # for the site's search: pd build then writes its index");
  });

  it("--search or --system-theme without a website is refused, writing nothing", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    for (const extra of [{ search: true }, { systemTheme: false }]) {
      const { io, logs } = fakeIO();
      expect(await runInit(init(join(root, "ds"), { yes: true, ...extra }), io)).toBe(1);
      expect(logs.at(-1)).toMatch(/^✗ --(no-)?(search|system-theme) is a choice for a website: add --storefront\. Nothing was written\.$/);
      expect(existsSync(join(root, "ds"))).toBe(false);
    }
  });

  it("--yes leaves the website out, and the next steps name the workbench only", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, logs } = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "ds"), { yes: true, install: false, git: false }), io)).toBe(0);
    expect(existsSync(join(root, "ds", "pages"))).toBe(false);
    expect(logs.at(-1)).toBe("  npm run dev      # http://localhost:4000");
  });

  it("warns, with a website, that a local-file dependency can't install on GitHub's runners", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const tgz = join(root, "pattern-dump-0.1.0.tgz");
    await save(tgz, "");
    const warning = (logs: string[]) => logs.find(l => l.includes("npm ci"));
    const withSite = fakeIO();
    expect(await runInit(init(join(root, "a"), { storefront: true, pdSource: tgz, install: false, git: false }), withSite.io)).toBe(0);
    expect(warning(withSite.logs)).toBe(`  ! pattern-dump is installed from a local file (file:${tgz}). The GitHub Pages workflow installs `
      + "with npm ci, which can't reach it: depend on the published pattern-dump before you push.");
    const noSite = fakeIO();
    expect(await runInit(init(join(root, "b"), { pdSource: tgz, install: false, git: false }), noSite.io)).toBe(0);
    expect(warning(noSite.logs)).toBeUndefined();
    const registry = fakeIO();
    expect(await runInit(init(join(root, "c"), { storefront: true, install: false, git: false }), registry.io)).toBe(0);
    expect(warning(registry.logs)).toBeUndefined();
  });

  it("--yes never prompts, even on a TTY", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, asked } = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "ds"), { yes: true, install: false, git: false }), io)).toBe(0);
    expect(asked).toEqual([]);
  });

  it("does not offer git init inside an existing repository", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, calls } = fakeIO({ exitCodes: { "git rev-parse --is-inside-work-tree": 0 } });
    expect(await runInit(init(join(root, "ds"), { install: false }), io)).toBe(0);
    expect(calls).not.toContain("git init -q");
  });

  it("adds to an existing project without overwriting its files", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await save(join(root, "package.json"), JSON.stringify({ name: "acme-ui", scripts: { dev: "vite" } }));
    await save(join(root, "README.md"), "# Acme UI\n");
    const { io, logs } = fakeIO();
    expect(await runInit(init(root, { install: false, git: false }), io)).toBe(0);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# Acme UI\n");
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).scripts).toEqual({
      dev: "vite", "pd:dev": "pd dev", audit: "pd audit", typecheck: "tsc --noEmit", "build:scripts": "tsc",
    });
    expect(logs).toContain("  · README.md: already exists, left untouched");
    expect(logs.at(-1)).toContain("npm run pd:dev");
  });

  it("refuses a folder that is already a Pattern Dump project, writing nothing", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await save(join(root, "pattern-dump.config.ts"), "export default {}\n");
    const { io, logs, calls } = fakeIO();
    expect(await runInit(init(root), io)).toBe(1);
    expect(existsSync(join(root, "package.json"))).toBe(false);
    expect(logs.at(-1)).toContain("already a Pattern Dump project");
    expect(calls).not.toContain("npm install");
  });

  // The project is written by the time npm fails, so the advice must not be to re-run pd init
  // (which would now be refused): it is to install a local build into the project.
  it("a failed registry install explains how to install a local build into the written project", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, logs } = fakeIO({ exitCodes: { "npm install": 1 } });
    expect(await runInit(init(join(root, "ds"), { git: false }), io)).toBe(1);
    const advice = logs.join("\n");
    expect(advice).toContain("npm install --save-dev <path to pattern-dump-");
    expect(advice).not.toContain("pd init");
    expect(existsSync(join(root, "ds", "pattern-dump.config.ts"))).toBe(true);
  });

  describe("running from a source checkout", () => {
    it("installs the locally packed build by default", async () => {
      root = await mkdtemp(join(tmpdir(), "pd-init-"));
      const tarball = join(root, "pattern-dump-0.1.0.tgz");
      const { io, logs } = fakeIO({ localBuild: { repo: root, tarball, stale: false } });
      expect(await runInit(init(join(root, "ds"), { install: false, git: false }), io)).toBe(0);
      expect(JSON.parse(await readFile(join(root, "ds", "package.json"), "utf8")).devDependencies)
        .toEqual({ "pattern-dump": `file:${tarball}`, typescript: "^5.9.0" });
      expect(logs[0]).toContain("local build");
      expect(logs.join("\n")).not.toContain("older than");
    });

    it("warns when the packed build is older than the latest build", async () => {
      root = await mkdtemp(join(tmpdir(), "pd-init-"));
      const { io, logs } = fakeIO({ localBuild: { repo: root, tarball: join(root, "x.tgz"), stale: true } });
      expect(await runInit(init(join(root, "ds"), { install: false, git: false }), io)).toBe(0);
      expect(logs.join("\n")).toContain("npm run pack:pd");
    });

    it("with no packed build, stops before asking or writing anything", async () => {
      root = await mkdtemp(join(tmpdir(), "pd-init-"));
      const { io, logs, asked } = fakeIO({ interactive: true, localBuild: { repo: root, tarball: null, stale: false } });
      expect(await runInit(init(join(root, "ds")), io)).toBe(1);
      expect(asked).toEqual([]);
      expect(existsSync(join(root, "ds"))).toBe(false);
      expect(logs.join("\n")).toContain("npm run pack:pd");
    });

    it("an explicit --pd-source still wins", async () => {
      root = await mkdtemp(join(tmpdir(), "pd-init-"));
      const { io } = fakeIO({ localBuild: { repo: root, tarball: join(root, "x.tgz"), stale: false } });
      expect(await runInit(init(join(root, "ds"), { install: false, git: false, pdSource: "pattern-dump@0.2.0" }), io)).toBe(0);
      expect(JSON.parse(await readFile(join(root, "ds", "package.json"), "utf8")).devDependencies).toEqual({ "pattern-dump": "0.2.0", typescript: "^5.9.0" });
    });
  });

  it("an invalid package.json stops before writing anything", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await mkdir(join(root, "src"));
    await save(join(root, "package.json"), "{ nope");
    const { io } = fakeIO();
    expect(await runInit(init(root), io)).toBe(1);
    expect(existsSync(join(root, "pattern-dump.config.ts"))).toBe(false);
  });
});

describe("runInit --site", () => {
  const styleguide = async (over: Record<string, unknown> = {}) =>
    save(join(root, "acme-web", "styleguide", "package.json"), JSON.stringify({ name: "@acme-web/styleguide", patternDump: { patterns: "src/patterns" }, ...over }));

  it("a folder: the site's files only, the style guide as a file: dependency, then install and the page check", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await styleguide();
    const target = join(root, "acme-web", "site");
    const checked: string[] = [];
    const { io, calls, logs } = fakeIO({ cwd: join(root, "acme-web"), checkSite: async r => { checked.push(r); return []; } });
    expect(await runInit(init(target, { yes: true, site: "./styleguide" }), io)).toBe(0);

    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "@acme-web/site", scripts: { dev: "pd dev", build: "pd build" },
      devDependencies: { "pattern-dump": PD_VERSION, "@acme-web/styleguide": "file:../styleguide", pagefind: PAGEFIND_VERSION } });
    expect(pkg.devDependencies.typescript).toBeUndefined();
    const config = await readFile(join(target, "pattern-dump.config.ts"), "utf8");
    expect(config).toContain(`packages: ["@acme-web/styleguide"]`);
    expect(config).toContain(`workbenchUrl: "/workbench/"`);
    expect(config).toContain(`site: { title: "acme-web", footer: "Made with Pattern Dump." }`);
    expect(config).toContain(`build: { workbench: false }`);
    for (const none of ["src", "themes", "assets", ".github"]) expect(existsSync(join(target, none)), none).toBe(false);
    expect(existsSync(join(target, "pages", "index.md"))).toBe(true);
    expect(calls).toEqual(["git rev-parse --is-inside-work-tree", "git init -q", "npm install"]);
    expect(checked).toEqual([target]);
    expect(logs).toContain("✓ every page renders with @acme-web/styleguide");
    expect(logs.at(-1)).toBe("  npm run dev      # the website at http://live.localhost:4000/");
  });

  it("an npm name without a version: pinned to the one installed; with a workflow, since the registry has it", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const target = join(root, "web");
    const { io, calls, logs } = fakeIO({
      run: async (command, args, cwd) => {
        const key = [command, ...args].join(" ");
        calls.push(key);
        if (key === "npm install") await save(join(cwd, "node_modules", "@acme", "styleguide", "package.json"), JSON.stringify({ name: "@acme/styleguide", version: "1.4.2" }));
        return key.startsWith("git rev-parse") ? 128 : 0;
      },
      checkSite: async () => [],
    });
    expect(await runInit(init(target, { yes: true, git: false, site: "@acme/styleguide", workbenchUrl: "https://workbench.example.com/" }), io)).toBe(0);
    expect(JSON.parse(await readFile(join(target, "package.json"), "utf8")).devDependencies["@acme/styleguide"]).toBe("latest");
    expect(calls).toEqual(["git rev-parse --is-inside-work-tree", "npm install", "npm install --save-dev --save-exact @acme/styleguide@1.4.2"]);
    expect(logs).toContain("✓ @acme/styleguide pinned to 1.4.2");
    expect(existsSync(join(target, ".github", "workflows", "pages.yml"))).toBe(true);
    expect(await readFile(join(target, "pattern-dump.config.ts"), "utf8")).toContain(`workbenchUrl: "https://workbench.example.com/"`);
  });

  it("a version given is kept; a page that doesn't render is reported, and init still succeeds", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const { io, calls, logs } = fakeIO({ checkSite: async () => ["/ (layout \"page\") does not render: 500", "  - index.md: layout \"page\" is not a layout"] });
    expect(await runInit(init(join(root, "web"), { yes: true, git: false, site: "@acme/styleguide@1.2.0" }), io)).toBe(0);
    expect(calls).toEqual(["git rev-parse --is-inside-work-tree", "npm install"]);
    expect(logs).toEqual(expect.arrayContaining(["  ! The pages don't render with @acme/styleguide yet:",
      "    - / (layout \"page\") does not render: 500", "    - index.md: layout \"page\" is not a layout"]));
  });

  it("asks first; an empty answer is a new design system, a name asks only what a site needs", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const blank = fakeIO({ interactive: true });
    expect(await runInit(init(join(root, "ds"), { install: false, git: false }), blank.io)).toBe(0);
    expect(blank.asked[0]).toBe("A website on an existing style guide package? Its npm name or folder (empty: a new design system)");
    expect(blank.asked).toContain("Include starter components");

    const named = fakeIO({ interactive: true, answers: { "A website on an existing style guide package? Its npm name or folder (empty: a new design system)": "@acme/styleguide@1.0.0" } });
    expect(await runInit(init(join(root, "web"), { install: false, git: false }), named.io)).toBe(0);
    expect(named.asked).toEqual(["A website on an existing style guide package? Its npm name or folder (empty: a new design system)",
      "Project name", "Title of the site", "Include site search (Pagefind)",
      "Where the style guide's workbench is published (a full address, or a path on this site's host)"]);
    expect(named.logs).toContain("  · the pages are checked against the style guide once it is installed: npm install, then npm run dev");
  });

  it("refuses, writing nothing: a design-system flag with --site, --workbench-url without it, a bad address, a bad name", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ site: "@acme/ui", storefront: true }, /^✗ --site writes a website on an existing style guide, so --storefront has nothing to choose/],
      [{ site: "@acme/ui", examples: false, systemTheme: true }, /so --no-examples and --system-theme has nothing to choose/],
      [{ workbenchUrl: "/workbench/" }, /^✗ --workbench-url is where a style guide's workbench is published, for a site on it: add --site/],
      [{ site: "@acme/ui", workbenchUrl: "workbench" }, /^✗ "workbench" is not where a workbench can be/],
      [{ site: "Acme UI" }, /^✗ "Acme UI" is neither a folder nor an npm package name/],
    ];
    for (const [extra, said] of cases) {
      const { io, logs } = fakeIO();
      expect(await runInit(init(join(root, "web"), { yes: true, ...extra }), io), JSON.stringify(extra)).toBe(1);
      expect(logs.at(-1)).toMatch(said);
      expect(existsSync(join(root, "web"))).toBe(false);
    }
  });

  it("a folder without the patternDump field: written, with the warning", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await styleguide({ patternDump: undefined });
    const { io, logs } = fakeIO({ cwd: join(root, "acme-web") });
    expect(await runInit(init(join(root, "acme-web", "site"), { yes: true, install: false, git: false, site: "./styleguide" }), io)).toBe(0);
    expect(logs).toEqual(expect.arrayContaining([expect.stringMatching(/^ {2}! @acme-web\/styleguide has no "patternDump" field/)]));
  });
});

describe("dependencySpec", () => {
  it("defaults to the registry range, turns an existing file into file:, and unwraps name@range", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-init-"));
    await save(join(root, "pattern-dump-0.1.0.tgz"), "");
    // Exact, not a caret: a patch release can change what a build writes and checks.
    expect(dependencySpec(undefined, root)).toBe(PD_VERSION);
    expect(dependencySpec("./pattern-dump-0.1.0.tgz", root)).toBe(`file:${join(root, "pattern-dump-0.1.0.tgz")}`);
    expect(dependencySpec("pattern-dump@0.2.0", root)).toBe("0.2.0");
    expect(dependencySpec("latest", root)).toBe("latest");
  });
});
