// `pd init` — the I/O half: resolve answers (flags, then prompts, then defaults), apply the plan,
// then optionally `git init` and `npm install`. Every side effect goes through InitIO, so the whole
// flow runs in tests against a temp folder with scripted answers and a recorded process runner.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Command } from "../args.js";
import { PD_PACKAGE_NAME, PD_VERSION } from "../distribution.js";
import { applyPlan, readTemplates } from "./files.js";
import type { LocalBuild } from "./local-build.js";
import { planInit, toPackageName, type InitAnswers } from "./plan.js";

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
  /** Run a process with inherited output; resolves to its exit code (null when it could not start). */
  run(command: string, args: string[], cwd: string): Promise<number | null>;
  /** Set when this `pd` runs from a Pattern Dump source checkout (see local-build.ts). */
  localBuild?: LocalBuild | null;
}

/** The dependency spec for PD in the new project's package.json. */
export function dependencySpec(pdSource: string | undefined, cwd: string): string {
  if (pdSource === undefined) return `^${PD_VERSION}`;
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
      io.log(`✗ ${pkgPath} is not valid JSON — fix it and run pd init again (${e instanceof Error ? e.message : e})`);
      return 1;
    }
  }

  const prompt = io.interactive && !cmd.yes;
  const existingName = typeof packageJson?.name === "string" ? packageJson.name : undefined;
  const name = cmd.name ?? (prompt ? await io.ask("Project name", existingName ?? toPackageName(basename(target))) : existingName ?? toPackageName(basename(target)));
  const brand = cmd.brand ?? (prompt ? await io.ask("Title in the Nav Rail", name) : name);
  const examples = cmd.examples ?? (prompt ? await io.confirm("Include starter components", true) : true);
  const gitDefault = !(await insideGitRepo(target, io));
  const git = cmd.git ?? (prompt && gitDefault ? await io.confirm("Initialise a git repository", true) : gitDefault);
  const install = cmd.install ?? (prompt ? await io.confirm("Run npm install", true) : true);

  const answers: InitAnswers = { name, brand, examples, storefront: false, dependency };
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
  io.log(`✓ package.json ${plan.packageJson.created ? "created" : "updated"} — ${PD_PACKAGE_NAME} ${answers.dependency}`);
  for (const note of plan.packageJson.notes) io.log(`  · ${note}`);
  for (const s of plan.skipped) io.log(`  · ${s.path}: ${s.reason}`);

  if (git) {
    const code = await io.run("git", ["init", "-q"], target);
    io.log(code === 0 ? "✓ git repository initialised" : "✗ git init failed — is git installed? (the project is set up regardless)");
  }

  if (install) {
    io.log("… npm install");
    const code = await io.run("npm", ["install"], target);
    if (code !== 0) {
      // The project files are written, so re-running `pd init` would be refused: point at npm instead.
      io.log("✗ npm install failed. The project files are in place.");
      if (dependency.startsWith("^")) {
        io.log(`  ${PD_PACKAGE_NAME} may not be published yet. Install a local build into the project:`);
        io.log(`    ${where === "." ? "" : `cd ${where} && `}npm install --save-dev <path to ${PD_PACKAGE_NAME}-${PD_VERSION}.tgz>`);
        io.log("  (build one in the Pattern Dump repo with: npm run pack:pd)");
      } else {
        io.log(`  Fix the error above, then run npm install${where === "." ? "" : ` in ${where}`}.`);
      }
      return 1;
    }
  }

  io.log("");
  io.log("Next:");
  if (where !== ".") io.log(`  cd ${where}`);
  if (!install) io.log("  npm install");
  io.log(`  npm run ${JSON.parse(plan.packageJson.content).scripts["pd:dev"] ? "pd:dev" : "dev"}      # http://localhost:4000`);
  return 0;
}
