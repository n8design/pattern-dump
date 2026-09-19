// Build the self-contained distributable and `npm pack` it.
//
//   npm run pack:pd      → .pd-pack/pattern-dump-<version>.tgz
//
// Every @pattern-dump/* workspace package is bundled INTO the output; every third-party package stays
// a real dependency. The dependency list is not maintained by hand: it is read from esbuild's metafile
// (what the bundle actually imports) with versions from the root lockfile (what the tests ran
// against), so it cannot drift from the code.
//
// Requires a prior `npm run build` (the bundle resolves workspace packages through their dist).

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cliDir = join(repo, "packages/cli");
const outRoot = join(repo, ".pd-pack");
const stage = join(outRoot, "stage");
const dist = join(stage, "dist");

const cliPkg = JSON.parse(await readFile(join(cliDir, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(repo, "package-lock.json"), "utf8"));
const NAME = (await readFile(join(cliDir, "src/distribution.ts"), "utf8")).match(/PD_PACKAGE_NAME = "([^"]+)"/)[1];
const VERSION = cliPkg.version;

// Packages loaded by name at runtime rather than imported statically, so the metafile cannot see them.
const RUNTIME_RESOLVED = ["axe-core"];

await rm(outRoot, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// ---- 1. Bundle: the bin and the library entry --------------------------------------------------
const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);
const result = await build({
  entryPoints: { pd: join(cliDir, "src/index.ts"), index: join(cliDir, "src/lib.ts") },
  outdir: dist,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  metafile: true,
  logLevel: "warning",
  plugins: [{
    // Bundle our own packages; externalise everything else (and remember what it was).
    name: "externalise-third-party",
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith("@pattern-dump/")) return undefined;
        return { path: args.path, external: true };
      });
    },
  }],
});

// ---- 2. Dependencies from what the bundle actually imports ---------------------------------------
const packageName = spec => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const external = new Set(RUNTIME_RESOLVED);
for (const output of Object.values(result.metafile.outputs)) {
  for (const imp of output.imports) {
    if (imp.external && !builtins.has(imp.path) && !imp.path.startsWith("node:")) external.add(packageName(imp.path));
  }
}
const dependencies = {};
for (const dep of [...external].sort()) {
  // Usually hoisted to the root; a version conflict nests it under the workspace that needs it
  // (html-validate lives in packages/renderer/node_modules). Those must agree, or pin by hand.
  const versions = new Set(Object.entries(lock.packages)
    .filter(([key]) => key === `node_modules/${dep}` || (key.startsWith("packages/") && key.endsWith(`/node_modules/${dep}`)))
    .map(([, entry]) => entry.version));
  if (versions.size === 0) throw new Error(`pack: "${dep}" is imported by the bundle but not in package-lock.json`);
  if (versions.size > 1) throw new Error(`pack: workspaces lock "${dep}" at different versions (${[...versions].join(", ")})`);
  const [locked] = versions;
  dependencies[dep] = `^${locked}`;
}

// ---- 3. The dev-ui bundle, next to the binary (dev-server/src/assets.ts looks for ./dev-ui/) ----
const devUi = join(repo, "apps/dev-ui/dist");
const devUiFiles = (await readdir(devUi)).filter(f => f === "main.js" || f === "main.css");
if (devUiFiles.length !== 2) throw new Error("pack: apps/dev-ui/dist is incomplete — run `npm run build` first");
await mkdir(join(dist, "dev-ui"), { recursive: true });
for (const f of devUiFiles) await cp(join(devUi, f), join(dist, "dev-ui", f));

// ---- 3b. The pd init templates, beside dist/ (index.ts reads ../templates/ from the binary) -------
await cp(join(cliDir, "templates"), join(stage, "templates"), { recursive: true });

// ---- 4. Type declarations for the config surface ------------------------------------------------
// tsc emits config + the contracts types it references; the workspace specifier is rewritten to the
// copy inside this package, and extensionless relative specifiers gain .js so NodeNext consumers
// resolve them too.
const dtsTmp = join(outRoot, "dts");
execFileSync(join(repo, "node_modules/.bin/tsc"), [
  "-p", join(repo, "packages/config/tsconfig.json"),
  "--declaration", "--emitDeclarationOnly", "--noEmit", "false", "--outDir", dtsTmp,
], { stdio: "inherit" });
const fixSpecifiers = (text, contractsSpecifier) => text
  .replaceAll('"@pattern-dump/contracts"', `"${contractsSpecifier}"`)
  .replace(/(from |import\()"(\.\.?\/[^"]+?)(?<!\.js)"/g, '$1"$2.js"');
for (const [pkg, target] of [["config", "config"], ["contracts", "contracts"]]) {
  const srcDir = join(dtsTmp, pkg, "src");
  await mkdir(join(dist, "types", target), { recursive: true });
  for (const f of await readdir(srcDir)) {
    if (!f.endsWith(".d.ts") || f.includes(".spec.")) continue;
    const text = await readFile(join(srcDir, f), "utf8");
    await writeFile(join(dist, "types", target, f), fixSpecifiers(text, "../contracts/index.js"));
  }
}
await writeFile(join(dist, "index.d.ts"),
  'export * from "./types/config/index.js";\n');
await rm(dtsTmp, { recursive: true, force: true });

// ---- 5. package.json, README, LICENSE, CHANGELOG -------------------------------------------------
const REPO_URL = "https://github.com/n8design/pattern-dump";
const pkg = {
  name: NAME,
  version: VERSION,
  description: "A workbench for HTML and CSS design systems: live component previews, docs, checks and static publishing.",
  keywords: [
    "design-system", "pattern-library", "styleguide", "patternlab", "handlebars", "scss",
    "component-library", "workbench", "living-styleguide", "accessibility", "static-site", "htwoo",
  ],
  author: "Stefan Bauer <stefan.bauer@n8d.at> (https://n8d.at)",
  license: "MIT",
  homepage: `${REPO_URL}#readme`,
  repository: { type: "git", url: `git+${REPO_URL}.git` },
  bugs: `${REPO_URL}/issues`,
  funding: [
    { type: "github", url: "https://github.com/sponsors/stfbauer" },
    { type: "github", url: "https://github.com/sponsors/n8design" },
  ],
  type: "module",
  bin: { pd: "./dist/pd.js" },
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./package.json": "./package.json",
  },
  types: "./dist/index.d.ts",
  files: ["dist", "templates", "README.md", "LICENSE", "CHANGELOG.md"],
  engines: { node: ">=20.10" },
  dependencies,
};
await writeFile(join(stage, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
await cp(join(repo, "LICENSE"), join(stage, "LICENSE"));
await cp(join(repo, "CHANGELOG.md"), join(stage, "CHANGELOG.md"));
// The npm page. Written in packages/cli/PACKAGE-README.md so it can be read and reviewed as Markdown;
// links there are absolute, because npm does not resolve links relative to the repository.
const readme = (await readFile(join(cliDir, "PACKAGE-README.md"), "utf8"))
  .replaceAll("{{name}}", NAME)
  .replaceAll("{{version}}", VERSION)
  .replaceAll("{{repo}}", REPO_URL);
if (/\{\{\w+\}\}/.test(readme)) throw new Error("pack: PACKAGE-README.md has an unknown placeholder");
await writeFile(join(stage, "README.md"), readme);

// ---- 6. npm pack ---------------------------------------------------------------------------------
const tarball = execFileSync("npm", ["pack", "--silent", "--pack-destination", outRoot], { cwd: stage, encoding: "utf8" }).trim().split("\n").pop();
console.log(`packed ${join(outRoot, tarball)}`);
console.log(`  bin pd, ${Object.keys(dependencies).length} dependencies: ${Object.keys(dependencies).join(", ")}`);

