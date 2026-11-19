// `pd init` — the PURE half: given the templates, the answers and what already exists at the target,
// decide every file to write, every file to leave alone, and the package.json to end up with.
// No filesystem, no prompts, no processes; run.ts does all of that. Everything a user could lose —
// an overwritten file, a clobbered script — is decided here, so it is all unit-testable.

import { initManifestSource, manifestOf } from "./manifest.js";

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
  /** With the website, when it follows the viewer's light or dark setting: the `system` theme, the skin's colours. */
  storefrontSystem: TemplateFile[];
  /** A content-only website on an existing style guide package (`pd init --site`): pages, config, workflow. */
  site: TemplateFile[];
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
  /** With the website: Pagefind as a devDependency, so pd build writes the search index. */
  search: boolean;
  /** With the website: the default theme `system` (`color-scheme: light dark`), and the skin's pages follow it. */
  systemTheme: boolean;
  /** Dependency spec for the PD package: `0.1.0`, `file:/abs/pattern-dump-0.1.0.tgz`, … */
  dependency: string;
  /** `--site`: a content-only website on this style guide package, instead of a design system. */
  site?: SiteAnswers;
}

export interface SiteAnswers {
  /** The style guide's package name. */
  name: string;
  /** Its dependency spec: a range (`1.2.0`, `latest`) or `file:<path relative to the new project>`. */
  spec: string;
  /** Where the style guide's own workbench is published (storefront.workbenchUrl). */
  workbenchUrl: string;
}

export interface ExistingProject {
  /** Parsed package.json at the target, or null when there is none. */
  packageJson: Record<string, unknown> | null;
  /** Whether a path (relative to the target) already exists. */
  exists: (path: string) => boolean;
}

export interface InitPlan {
  writes: TemplateFile[];
  /** Folders the config names that have no template file of their own. */
  dirs: string[];
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
const SKIN_PREFIXES = ["src/patterns/layouts/", "src/patterns/partials/", "src/patterns/views/", "src/styles/layouts/", "src/styles/partials/", "src/styles/views/"];
const SKIN_FILES = ["assets/icon.svg", "src/styles/base/page.scss", "src/styles/base/colors.scss"];
const isSkin = (path: string): boolean => SKIN_PREFIXES.some(p => path.startsWith(p)) || SKIN_FILES.includes(path);

/** A valid npm package name from a free-form folder or project name; a scope (`@acme/ds`) stays a scope. */
export function toPackageName(input: string): string {
  const slug = (part: string) => part.toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  const scoped = /^@([^/]+)\/([^/]+)$/.exec(input.trim());
  if (scoped) {
    const [scope, name] = [slug(scoped[1]!), slug(scoped[2]!)];
    if (scope && name) return `@${scope}/${name}`;
  }
  return slug(input) || "design-system";
}

/** Folder names that say what a folder is rather than whose it is: the parent folder then names the project. */
export const GENERIC_FOLDER_NAMES = ["styleguide", "style-guide", "design-system", "site", "website", "docs", "www"];

/**
 * The default package name and title for a project in `folder` (inside `parent`): the folder's name, or, for a
 * generic one (`styleguide` inside `acme-web`), the parent's name as the scope (`@acme-web/styleguide`) and as the
 * title (`acme-web`).
 */
export function defaultName(folder: string, parent: string): { name: string; brand: string } {
  const name = toPackageName(folder);
  const scope = toPackageName(parent);
  if (!GENERIC_FOLDER_NAMES.includes(name) || !/[a-z0-9]/i.test(parent)) return { name, brand: name };
  return { name: `@${scope}/${name}`, brand: parent };
}

export function planInit(
  templates: Templates,
  answers: InitAnswers,
  existing: ExistingProject,
  packageName: string,
): PlanResult {
  const existingConfig = CONFIG_FILES.find(f => existing.exists(f));
  if (existingConfig) {
    return { ok: false, reason: `${existingConfig} already exists: this folder is already a Pattern Dump project` };
  }
  if (answers.site) return { ok: true, plan: planSite(templates, answers, answers.site, existing, packageName) };

  // A placeholder stands on a line of its own; without a storefront the line goes.
  const fills = templates.storefrontFills;
  const system = answers.storefront && answers.systemTheme;
  const substitute = (text: string): string => text
    .replaceAll("__PD_STOREFRONT__\n", answers.storefront ? fills.config : "")
    .replaceAll("__PD_SEARCH_NOTE__\n", answers.search ? SEARCH_NOTE.on : SEARCH_NOTE.off)
    .replaceAll("__PD_THEME_DEFAULT__", themeDefault(answers))
    .replaceAll("__PD_STOREFRONT_README__\n", answers.storefront ? fills.readme : "")
    .replaceAll("__PD_STOREFRONT_GITIGNORE__\n", answers.storefront ? fills.gitignore : "")
    .replaceAll("__PD_PACKAGE__", packageName)
    .replaceAll("__PD_NAME__", answers.name)
    .replaceAll("__PD_BRAND_JSON__", JSON.stringify(answers.brand));

  const writes: TemplateFile[] = [];
  const skipped: InitPlan["skipped"] = [];
  const storefront = answers.storefront ? [...templates.storefront, ...(system ? templates.storefrontSystem : [])] : [];
  // The skin goes in whole or not at all: one file of it already there leaves all of it out.
  const skin = storefront.filter(f => isSkin(renamed(f.path)));
  const skinTaken = skin.map(f => renamed(f.path)).find(p => existing.exists(p));
  if (skinTaken) {
    skipped.push({ path: skinTaken, reason: `already exists: the storefront skin (${skin.length} files in src/patterns/layouts, `
      + `src/patterns/partials, src/patterns/views and their styles) was left out as a whole, so it isn't mixed with the skin already here` });
  }
  const files = [...templates.base, ...(answers.examples ? templates.examples : []),
    ...storefront.filter(f => !skinTaken || !skin.includes(f))];
  for (const file of files) {
    const path = renamed(file.path);
    if (existing.exists(path)) {
      skipped.push({ path, reason: "already exists, left untouched" });
      continue;
    }
    writes.push({ path, content: substitute(file.content) });
  }

  return { ok: true, plan: { writes, skipped, dirs: ["assets", "src/patterns"], packageJson: mergePackageJson(existing.packageJson, answers, packageName) } };
}

/** The README's publishing section for a site: its own workflow (a style guide from the registry), or a root build
 *  that puts the style guide's workbench beside it (a style guide in a folder next to it). */
const SITE_PUBLISH_README = {
  workflow: "\n## Publish it\n\n`.github/workflows/pages.yml` builds the website and publishes it to GitHub Pages on every push to\n"
    + "`main`: **Settings → Pages → Source:** \"GitHub Actions\". Set `site.url` to the site's address. The\n"
    + "workflow installs with `npm ci`, so the style guide and `pattern-dump` must come from the npm registry.\n",
  root: "\n## Publish it\n\nThe style guide is a folder next to this one, so the repository's root builds and publishes both: the\n"
    + "website from this project's `npm run build`, the style guide's workbench into it at `site.workbenchUrl`.\n"
    + "The [getting started guide](https://github.com/n8design/pattern-dump/blob/main/docs/guide/getting-started.md#a-content-only-website)\n"
    + "has the root `package.json` and workflow.\n",
};

function planSite(templates: Templates, answers: InitAnswers, site: SiteAnswers, existing: ExistingProject, packageName: string): InitPlan {
  const local = site.spec.startsWith("file:");
  const substitute = (text: string): string => text
    .replaceAll("__PD_SEARCH_NOTE__\n", answers.search ? SEARCH_NOTE.on : SEARCH_NOTE.off)
    .replaceAll("__PD_SITE_PUBLISH_README__\n", local ? SITE_PUBLISH_README.root : SITE_PUBLISH_README.workflow)
    .replaceAll("__PD_SITE_PACKAGE_JSON__", JSON.stringify(site.name))
    .replaceAll("__PD_SITE_PACKAGE__", site.name)
    .replaceAll("__PD_WORKBENCH_URL_JSON__", JSON.stringify(site.workbenchUrl))
    .replaceAll("__PD_PACKAGE__", packageName)
    .replaceAll("__PD_NAME__", answers.name)
    .replaceAll("__PD_BRAND_JSON__", JSON.stringify(answers.brand));
  const writes: TemplateFile[] = [];
  const skipped: InitPlan["skipped"] = [];
  // A style guide in a folder beside the site is published by the repository's root, which has the workflow.
  for (const file of templates.site.filter(f => !(local && f.path.startsWith(".github/")))) {
    const path = renamed(file.path);
    if (existing.exists(path)) {
      skipped.push({ path, reason: "already exists, left untouched" });
      continue;
    }
    writes.push({ path, content: substitute(file.content) });
  }
  return { writes, skipped, dirs: [], packageJson: mergePackageJson(existing.packageJson, answers, packageName) };
}

/** The default theme of a design system's config: `system` with a website that follows the viewer's setting. */
const themeDefault = (answers: InitAnswers): string => (answers.storefront && answers.systemTheme ? "system" : "light");

/** The config's comment on search, as the project has Pagefind or not. */
const SEARCH_NOTE = {
  on: "    // Search: pd build indexes every page with Pagefind (a devDependency of this site); components/search is the\n"
    + "    // search field. search: true makes a build without Pagefind stop, false turns it off.\n",
  off: "    // Search: pd build indexes every page with Pagefind once the project has it (npm install --save-dev pagefind);\n"
    + "    // components/search is the search field. search: true makes a build without Pagefind stop, false turns it off.\n",
};

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

/** The Pagefind Pattern Dump is tested with (the repository's lockfile), pinned exactly as Pattern Dump is. */
export const PAGEFIND_VERSION = "1.6.0";

/**
 * Pattern Dump's own dependencies with install scripts, allowed in the project's `allowScripts` (npm 11.19 asks
 * for it; older npm ignores the field). By name, so an upgrade of Pattern Dump needs no new approval.
 */
export const INSTALL_SCRIPTS = ["esbuild", "@parcel/watcher"];

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
  // The website is built with the workbench, by pd build; a content-only site has no scripts to type-check.
  const ours = answers.site ? { dev: "pd dev", build: "pd build" } : answers.storefront ? { ...SCRIPTS, build: "pd build" } : SCRIPTS;
  for (const [name, command] of Object.entries(ours)) {
    if (scripts[name] === undefined) {
      scripts[name] = command;
    } else if (scripts[name] !== command) {
      // Never replace the project's own script; add ours beside it.
      const alt = `pd:${name}`;
      if (scripts[alt] === undefined) scripts[alt] = command;
      notes.push(`script "${name}" already exists: added "${alt}" instead`);
    }
  }
  pkg.scripts = scripts;

  const deps = pkg.dependencies as Record<string, string> | undefined;
  const devDeps = { ...(pkg.devDependencies as Record<string, string> | undefined) };
  if (deps?.[packageName] !== undefined) {
    notes.push(`${packageName} is already a dependency, left as is`);
  } else if (devDeps[packageName] !== undefined && devDeps[packageName] !== answers.dependency) {
    notes.push(`${packageName} is already a devDependency (${devDeps[packageName]}), left as is`);
  } else {
    devDeps[packageName] = answers.dependency;
  }
  if (answers.site) {
    const own = deps?.[answers.site.name] ?? devDeps[answers.site.name];
    if (own === undefined) devDeps[answers.site.name] = answers.site.spec;
    else if (own !== answers.site.spec) notes.push(`${answers.site.name} is already a dependency (${own}), left as is`);
  }
  // The project's own TypeScript wins: its version may be pinned for a reason (another toolchain).
  const existingTs = deps?.typescript ?? devDeps.typescript;
  if (answers.site) {
    // A content-only site has no scripts of its own: no TypeScript.
  } else if (existingTs === undefined) {
    devDeps.typescript = TYPESCRIPT_RANGE;
  } else if (existingTs !== TYPESCRIPT_RANGE) {
    notes.push(`typescript is already a dependency (${existingTs}), left as is; the starter scripts expect ${TYPESCRIPT_RANGE}`);
  }
  if (answers.search && (answers.storefront || answers.site)) {
    const existingPagefind = deps?.pagefind ?? devDeps.pagefind;
    if (existingPagefind === undefined) devDeps.pagefind = PAGEFIND_VERSION;
    else if (existingPagefind !== PAGEFIND_VERSION) notes.push(`pagefind is already a dependency (${existingPagefind}), left as is`);
  }
  pkg.devDependencies = devDeps;

  // A denial (false) the project wrote stays: it is the project's decision.
  const allow = { ...(pkg.allowScripts as Record<string, boolean> | undefined) };
  for (const name of INSTALL_SCRIPTS) {
    if (allow[name] === undefined) allow[name] = true;
    else if (allow[name] === false) notes.push(`allowScripts denies ${name}, left as is: Pattern Dump needs its install script`);
  }
  pkg.allowScripts = allow;

  // A design system is a pattern package from the start, so a website can use it: the field names the same folders
  // as the config init writes. Only in a package.json init creates; one that exists is the project's to change.
  if (created && !answers.site) pkg.patternDump = manifestOf(initManifestSource(themeDefault(answers)));

  return { content: JSON.stringify(pkg, null, 2) + "\n", created, notes };
}
