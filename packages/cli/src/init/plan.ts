// `pd init` — the PURE half: given the templates, the answers and what already exists at the target,
// decide every file to write, every file to leave alone, and the package.json to end up with.
// No filesystem, no prompts, no processes; run.ts does all of that. Everything a user could lose —
// an overwritten file, a clobbered script — is decided here, so it is all unit-testable.

export interface TemplateFile {
  /** Path relative to the project root, as stored in the template (`_gitignore` → `.gitignore`). */
  path: string;
  content: string;
}

/** Every template `pd init` can write, as read from its `templates/` folder (files.ts). */
export interface Templates {
  base: TemplateFile[];
  examples: TemplateFile[];
  /** The website starter: pages, a skin, a component of its own, a GitHub Pages workflow. */
  storefront: TemplateFile[];
  /** What the base templates' storefront placeholders become with a storefront; never files of their own. */
  storefrontFills: { config: string; readme: string; gitignore: string };
}

export interface InitAnswers {
  /** npm package name for a new project (also the README title). */
  name: string;
  /** Nav Rail brand title. */
  brand: string;
  /** Include the teaching components. */
  examples: boolean;
  /** Include the website starter (storefront). */
  storefront: boolean;
  /** Dependency spec for the PD package: `^0.1.0`, `file:/abs/pattern-dump-0.1.0.tgz`, … */
  dependency: string;
}

export interface ExistingProject {
  /** Parsed package.json at the target, or null when there is none. */
  packageJson: Record<string, unknown> | null;
  /** Whether a path (relative to the target) already exists. */
  exists: (path: string) => boolean;
}

export interface InitPlan {
  writes: TemplateFile[];
  skipped: Array<{ path: string; reason: string }>;
  packageJson: { content: string; created: boolean; notes: string[] };
}

export type PlanResult = { ok: true; plan: InitPlan } | { ok: false; reason: string };

const CONFIG_FILES = ["pattern-dump.config.ts", "pattern-dump.config.json"];

/** Template file names npm refuses to publish, stored under a different name. */
const RENAMES: Record<string, string> = { _gitignore: ".gitignore" };

/**
 * The storefront's skin: written as one unit or not at all. Mixed with a skin already in the project (its own
 * `layouts/page` beside the starter's `partials/base`, say), pages would render with parts of two skins.
 */
const SKIN_PREFIXES = ["src/patterns/layouts/", "src/patterns/partials/", "src/styles/layouts/", "src/styles/partials/"];
const SKIN_FILES = ["assets/icon.svg"];
const isSkin = (path: string): boolean => SKIN_PREFIXES.some(p => path.startsWith(p)) || SKIN_FILES.includes(path);

/** A valid npm package name from a free-form folder or project name. */
export function toPackageName(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return slug || "design-system";
}

export function planInit(
  templates: Templates,
  answers: InitAnswers,
  existing: ExistingProject,
  packageName: string,
): PlanResult {
  const existingConfig = CONFIG_FILES.find(f => existing.exists(f));
  if (existingConfig) {
    return { ok: false, reason: `${existingConfig} already exists — this folder is already a Pattern Dump project` };
  }

  // A placeholder stands on a line of its own; without a storefront the line goes.
  const fills = templates.storefrontFills;
  const substitute = (text: string): string => text
    .replaceAll("__PD_STOREFRONT__\n", answers.storefront ? fills.config : "")
    .replaceAll("__PD_STOREFRONT_README__\n", answers.storefront ? fills.readme : "")
    .replaceAll("__PD_STOREFRONT_GITIGNORE__\n", answers.storefront ? fills.gitignore : "")
    .replaceAll("__PD_PACKAGE__", packageName)
    .replaceAll("__PD_NAME__", answers.name)
    .replaceAll("__PD_BRAND_JSON__", JSON.stringify(answers.brand));

  const writes: TemplateFile[] = [];
  const skipped: InitPlan["skipped"] = [];
  const storefront = answers.storefront ? templates.storefront : [];
  // The skin goes in whole or not at all: one file of it already there leaves all of it out.
  const skin = storefront.filter(f => isSkin(renamed(f.path)));
  const skinTaken = skin.map(f => renamed(f.path)).find(p => existing.exists(p));
  if (skinTaken) {
    skipped.push({ path: skinTaken, reason: `already exists — the storefront skin (${skin.length} files in src/patterns/layouts, `
      + `src/patterns/partials and their styles) was left out as a whole, so it isn't mixed with the skin already here` });
  }
  const files = [...templates.base, ...(answers.examples ? templates.examples : []),
    ...storefront.filter(f => !skinTaken || !skin.includes(f))];
  for (const file of files) {
    const path = renamed(file.path);
    if (existing.exists(path)) {
      skipped.push({ path, reason: "already exists — left untouched" });
      continue;
    }
    writes.push({ path, content: substitute(file.content) });
  }

  return { ok: true, plan: { writes, skipped, packageJson: mergePackageJson(existing.packageJson, answers, packageName) } };
}

function renamed(path: string): string {
  const parts = path.split("/");
  const last = parts.pop()!;
  return [...parts, RENAMES[last] ?? last].join("/");
}

const SCRIPTS: Record<string, string> = {
  dev: "pd dev", audit: "pd audit", typecheck: "tsc --noEmit", "build:scripts": "tsc",
};

/** The TypeScript the starter's tsconfig and scripts are written for. */
export const TYPESCRIPT_RANGE = "^5.9.0";

function mergePackageJson(
  current: Record<string, unknown> | null,
  answers: InitAnswers,
  packageName: string,
): InitPlan["packageJson"] {
  const notes: string[] = [];
  const created = current === null;
  const pkg: Record<string, unknown> = created
    ? { name: toPackageName(answers.name), version: "0.1.0", private: true, type: "module" }
    : structuredClone(current);

  const scripts = { ...(pkg.scripts as Record<string, string> | undefined) };
  // The website is built with the workbench, by pd build.
  const ours = answers.storefront ? { ...SCRIPTS, build: "pd build" } : SCRIPTS;
  for (const [name, command] of Object.entries(ours)) {
    if (scripts[name] === undefined) {
      scripts[name] = command;
    } else if (scripts[name] !== command) {
      // Never replace the project's own script; add ours beside it.
      const alt = `pd:${name}`;
      if (scripts[alt] === undefined) scripts[alt] = command;
      notes.push(`script "${name}" already exists — added "${alt}" instead`);
    }
  }
  pkg.scripts = scripts;

  const deps = pkg.dependencies as Record<string, string> | undefined;
  const devDeps = { ...(pkg.devDependencies as Record<string, string> | undefined) };
  if (deps?.[packageName] !== undefined) {
    notes.push(`${packageName} is already a dependency — left as is`);
  } else if (devDeps[packageName] !== undefined && devDeps[packageName] !== answers.dependency) {
    notes.push(`${packageName} is already a devDependency (${devDeps[packageName]}) — left as is`);
  } else {
    devDeps[packageName] = answers.dependency;
  }
  // The project's own TypeScript wins: its version may be pinned for a reason (another toolchain).
  const existingTs = deps?.typescript ?? devDeps.typescript;
  if (existingTs === undefined) {
    devDeps.typescript = TYPESCRIPT_RANGE;
  } else if (existingTs !== TYPESCRIPT_RANGE) {
    notes.push(`typescript is already a dependency (${existingTs}) — left as is; the starter scripts expect ${TYPESCRIPT_RANGE}`);
  }
  pkg.devDependencies = devDeps;

  return { content: JSON.stringify(pkg, null, 2) + "\n", created, notes };
}
