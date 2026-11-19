// `pd init` — the I/O half: resolve answers (flags, then prompts, then defaults), apply the plan,
// then optionally `git init` and `npm install`. Every side effect goes through InitIO, so the whole
// flow runs in tests against a temp folder with scripted answers and a recorded process runner.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Command } from "../args.js";
import { PD_PACKAGE_NAME, PD_VERSION } from "../distribution.js";
import { applyPlan, readTemplates } from "./files.js";
import type { LocalBuild } from "./local-build.js";
import { defaultName, planInit, type InitAnswers, type SiteAnswers } from "./plan.js";
import { resolveSitePackage } from "./site.js";

type InitCommand = Extract<Command, { kind: "init" }>;

export interface InitIO {
  cwd: string;
  /** The `templates/` folder shipped beside the CLI. */
  templatesDir: string;
  /** Prompt only when true (a TTY) and --yes was not given. */
  interactive: boolean;
  ask(question: string, fallback: string): Promise<string>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  log(message: string): void;
  /** Run a process with inherited output; resolves to its exit code (null when it could not start). `onStderr`: its
   *  error output is still shown as it comes, and also handed over, chunk by chunk. */
  run(command: string, args: string[], cwd: string, onStderr?: (chunk: string) => void): Promise<number | null>;
  /** Set when this `pd` runs from a Pattern Dump source checkout (see local-build.ts). */
  localBuild?: LocalBuild | null;
  /** `--site`, once installed: the problems of the site's pages with the style guide (core's checkSitePages). */
  checkSite?(root: string): Promise<string[]>;
}

/** The dependency spec for PD in the new project's package.json. */
export function dependencySpec(pdSource: string | undefined, cwd: string): string {
  // Exact: a patch release of Pattern Dump can change what a build writes and what it checks.
  if (pdSource === undefined) return PD_VERSION;
  const asPath = resolve(cwd, pdSource);
  if (existsSync(asPath)) return `file:${asPath}`;
  // An npm spec: "pattern-dump@0.2.0" means the range after the @; anything else is used verbatim.
  return pdSource.startsWith(`${PD_PACKAGE_NAME}@`) ? pdSource.slice(PD_PACKAGE_NAME.length + 1) : pdSource;
}

async function insideGitRepo(target: string, io: InitIO): Promise<boolean> {
  let dir = target;
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  return (await io.run("git", ["rev-parse", "--is-inside-work-tree"], dir)) === 0;
}

export async function runInit(cmd: InitCommand, io: InitIO): Promise<number> {
  const target = cmd.target;
  for (const w of cmd.warnings ?? []) io.log(`! ${w}`);

  // Settle where PD installs from FIRST, so a dead end is reported before any question or write.
  let dependency: string;
  if (cmd.pdSource !== undefined) {
    dependency = dependencySpec(cmd.pdSource, io.cwd);
  } else if (io.localBuild) {
    if (!io.localBuild.tarball) {
      io.log("✗ This pd runs from a Pattern Dump source checkout, and there is no packed build to install.");
      io.log(`  Pack one first:  (cd ${io.localBuild.repo} && npm run pack:pd)`);
      io.log("  or pass --pd-source <tarball or npm spec>. Nothing was written.");
      return 1;
    }
    dependency = `file:${io.localBuild.tarball}`;
    io.log(`· Installing Pattern Dump from the local build ${io.localBuild.tarball}`);
    if (io.localBuild.stale) {
      io.log(`  ! It is older than your latest build. For recent changes: (cd ${io.localBuild.repo} && npm run pack:pd)`);
    }
  } else {
    dependency = dependencySpec(undefined, io.cwd);
  }
  const pkgPath = join(target, "package.json");
  let packageJson: Record<string, unknown> | null = null;
  if (existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
    } catch (e) {
      io.log(`✗ ${pkgPath} is not valid JSON: fix it and run pd init again (${e instanceof Error ? e.message : e})`);
      return 1;
    }
  }

  const prompt = io.interactive && !cmd.yes;
  // --site: a website on an existing style guide package, with nothing of a design system (site.ts). Asked first,
  // unless a flag already chose a design system.
  const designFlags = ([["--examples", cmd.examples], ["--with-site", cmd.storefront], ["--system-theme", cmd.systemTheme]] as const)
    .filter(([, v]) => v !== undefined)
    .map(([flag, v]) => v ? flag : flag === "--with-site" ? "--without-site" : flag.replace("--", "--no-"));
  const siteInput = cmd.site ?? (prompt && designFlags.length === 0
    ? (await io.ask("A website on an existing style guide package? Its npm name or folder (empty: a new design system)", "")).trim() || undefined
    : undefined);
  let siteSource: Awaited<ReturnType<typeof resolveSitePackage>> | undefined;
  if (siteInput !== undefined) {
    if (designFlags.length) {
      io.log(`✗ --site writes a website on an existing style guide, so ${designFlags.join(" and ")} has nothing to choose. Nothing was written.`);
      return 1;
    }
    siteSource = await resolveSitePackage(siteInput, io.cwd, target);
    if (!siteSource.ok) {
      io.log(`✗ ${siteSource.reason}. Nothing was written.`);
      return 1;
    }
  } else if (cmd.workbenchUrl !== undefined) {
    io.log("✗ --workbench-url is where a style guide's workbench is published, for a site on it: add --site. Nothing was written.");
    return 1;
  }
  const site = siteSource?.ok ? siteSource.site : undefined;
  const existingName = typeof packageJson?.name === "string" ? packageJson.name : undefined;
  const suggested = defaultName(basename(target), basename(dirname(target)));
  const nameDefault = existingName ?? suggested.name;
  const name = cmd.name ?? (prompt ? await io.ask("Project name", nameDefault) : nameDefault);
  // A scoped default (`@acme-web/styleguide`) titles the project by its scope's folder (`acme-web`).
  const brandDefault = name === suggested.name ? suggested.brand : name;
  const brand = cmd.brand ?? (prompt ? await io.ask(site ? "Title of the site" : "Title in the Nav Rail", brandDefault) : brandDefault);
  const examples = !site && (cmd.examples ?? (prompt ? await io.confirm("Include starter components", true) : true));
  const storefront = !site && (cmd.storefront ?? (prompt ? await io.confirm("Include a website", false) : false));
  for (const [flag, given] of [["--search", cmd.search], ["--system-theme", cmd.systemTheme]] as const) {
    if (given !== undefined && !storefront && !(site && flag === "--search")) {
      io.log(`✗ ${given ? flag : flag.replace("--", "--no-")} is a choice for a website: add --with-site. Nothing was written.`);
      return 1;
    }
  }
  const search = (storefront || site !== undefined) && (cmd.search ?? (prompt ? await io.confirm("Include site search (Pagefind)", true) : true));
  const systemTheme = storefront && (cmd.systemTheme
    ?? (prompt ? await io.confirm("Follow the viewer's light or dark setting (a system theme as the default)", true) : true));
  let siteAnswers: SiteAnswers | undefined;
  if (site) {
    const question = "Where the style guide's workbench is published (a full address, or a path on this site's host)";
    const workbenchUrl = cmd.workbenchUrl ?? (prompt ? await io.ask(question, "/workbench/") : "/workbench/");
    if (!/^https?:\/\/[^/]/.test(workbenchUrl) && !/^\/(?!\/)/.test(workbenchUrl)) {
      io.log(`✗ "${workbenchUrl}" is not where a workbench can be: give a full address (https://workbench.example.com/) or a path (/workbench/). Nothing was written.`);
      return 1;
    }
    siteAnswers = { name: site.name, spec: site.spec, workbenchUrl };
  }
  const gitDefault = !(await insideGitRepo(target, io));
  const git = cmd.git ?? (prompt && gitDefault ? await io.confirm("Initialise a git repository", true) : gitDefault);
  const install = cmd.install ?? (prompt ? await io.confirm("Run npm install", true) : true);

  const answers: InitAnswers = { name, brand, examples, storefront, search, systemTheme, dependency, ...(siteAnswers ? { site: siteAnswers } : {}) };
  const templates = await readTemplates(io.templatesDir);
  const result = planInit(templates, answers, { packageJson, exists: p => existsSync(join(target, p)) }, PD_PACKAGE_NAME);
  if (!result.ok) {
    io.log(`✗ ${result.reason}`);
    return 1;
  }

  const { plan } = result;
  await applyPlan(target, plan);
  const where = relative(io.cwd, target) || ".";
  io.log(`✓ ${plan.writes.length} files written to ${where}`);
  const written = JSON.parse(plan.packageJson.content) as { name?: string };
  io.log(`✓ package.json ${plan.packageJson.created ? "created" : "updated"}: ${written.name ?? "(no name)"}, with ${PD_PACKAGE_NAME} ${answers.dependency}`);
  for (const note of plan.packageJson.notes) io.log(`  · ${note}`);
  for (const s of plan.skipped) io.log(`  · ${s.path}: ${s.reason}`);
  if (site) io.log(`✓ a website on ${site.name} (${site.spec}); its workbench is linked at ${siteAnswers!.workbenchUrl}`);
  for (const w of siteSource?.ok ? siteSource.warnings : []) {
    // A warning may carry a block to paste: its lines indented under it.
    const [first, ...rest] = w.split("\n");
    io.log(`  ! ${first}`);
    for (const line of rest) io.log(`    ${line}`);
  }
  const workflow = plan.writes.some(w => w.path === ".github/workflows/pages.yml");
  if (workflow && dependency.startsWith("file:")) {
    // The workflow runs npm ci on GitHub's runners, where this machine's file is not.
    io.log(`  ! ${PD_PACKAGE_NAME} is installed from a local file (${dependency}). The GitHub Pages workflow installs `
      + `with npm ci, which can't reach it: depend on the published ${PD_PACKAGE_NAME} before you push.`);
  }

  if (git) {
    const code = await io.run("git", ["init", "-q"], target);
    io.log(code === 0 ? "✓ git repository initialised" : "✗ git init failed: is git installed? (the project is set up regardless)");
  }

  if (install) {
    io.log("… npm install");
    let stderr = "";
    const code = await io.run("npm", ["install"], target, chunk => { stderr += chunk; });
    if (code !== 0) {
      // The project files are written, so re-running `pd init` would be refused: point at npm instead.
      io.log("✗ npm install failed. The project files are in place.");
      const errors = npmErrorLines(stderr);
      if (errors.length) {
        io.log("  npm said:");
        for (const line of errors) io.log(`    ${line}`);
      } else {
        io.log(code === null ? "  npm could not be started: is Node.js (with npm) installed?" : `  npm stopped with exit code ${code}; its output is above.`);
      }
      io.log(`  Fix that, then install again:  ${where === "." ? "" : `cd ${where} && `}npm install`);
      return 1;
    }
    if (site) await settleSite(site, target, io);
  } else if (site) {
    io.log("  · the pages are checked against the style guide once it is installed: npm install, then npm run dev");
  }

  io.log("");
  io.log("Next:");
  if (where !== ".") io.log(`  cd ${where}`);
  if (!install) io.log("  npm install");
  const dev = `npm run ${JSON.parse(plan.packageJson.content).scripts["pd:dev"] ? "pd:dev" : "dev"}`;
  if (site) {
    io.log(`  ${dev}      # the website at http://live.localhost:4000/`);
    if (!search) io.log("  npm install --save-dev pagefind   # for the site's search: pd build then writes its index");
  } else if (storefront) {
    io.log(`  ${dev}      # the website at http://live.localhost:4000/, the workbench at http://pd.localhost:4000/`);
    if (!search) io.log("  npm install --save-dev pagefind   # for the site's search: pd build then writes its index");
  } else {
    io.log(`  ${dev}      # http://localhost:4000`);
  }
  return 0;
}

/**
 * After the install, for `--site`: a style guide named without a version is pinned to the one installed (npm writes
 * package.json and the lockfile together), then every page is asked for (InitIO.checkSite). A problem is reported,
 * not failed: the site is written, and the fix is in the style guide.
 */
async function settleSite(site: { name: string; spec: string }, target: string, io: InitIO): Promise<void> {
  if (site.spec === "latest") {
    const installed = join(target, "node_modules", ...site.name.split("/"), "package.json");
    const version = existsSync(installed) ? (JSON.parse(await readFile(installed, "utf8")) as { version?: string }).version : undefined;
    if (version !== undefined) {
      const code = await io.run("npm", ["install", "--save-dev", "--save-exact", `${site.name}@${version}`], target);
      io.log(code === 0 ? `✓ ${site.name} pinned to ${version}` : `  ! ${site.name} stays at "latest": pinning it to ${version} failed`);
    }
  }
  if (!io.checkSite) return;
  io.log(`… the pages with ${site.name}`);
  const problems = await io.checkSite(target);
  if (problems.length === 0) {
    io.log(`✓ every page renders with ${site.name}`);
    return;
  }
  io.log(`  ! The pages don't render with ${site.name} yet:`);
  for (const p of problems) io.log(`    ${p.startsWith("  - ") ? p.trim() : `- ${p}`}`);
  io.log("  A style guide for a website brings its skin: layouts/page and partials/base, as pd init --with-site writes them.");
  io.log("  The site is in place; once the style guide has them, npm run dev shows its pages.");
}

/** npm's error lines, for repeating them after its output: each "npm error" (npm 7 and later) or "npm ERR!" line with
 *  text, without the pointers to its log files, each once, at most eight. */
export function npmErrorLines(stderr: string): string[] {
  const out: string[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw).trimEnd();
    const m = /^npm (?:error|ERR!)\s+(.*)$/.exec(line);
    if (!m || !m[1]!.trim()) continue;
    if (/complete log of this run|log files were written|^\s*\/.*\.log$/i.test(m[1]!)) continue;
    if (!out.includes(line)) out.push(line);
    if (out.length === 8) break;
  }
  return out;
}
