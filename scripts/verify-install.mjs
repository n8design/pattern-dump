#!/usr/bin/env node
// Prove the distributable works where it will actually be used: installed into a project OUTSIDE
// this monorepo. Nothing inside the repo can catch a layout bug — every workspace package resolves
// here whether or not the published package is complete — so this is the test for packaging.
//
//   npm run verify:install                 build, pack, `pd init` a temp project, boot and check it
//   npm run verify:install -- --keep       …and leave the temp project in place
//   node scripts/verify-install.mjs --project <dir>
//                                          check an already-provisioned project (no pack, no init)
//
// Checks: the starter tree; every shell asset route (dev-ui bundle, axe-core, rule tiers) serves;
// every starter component and variant renders with no diagnostics; both themes expose swatch tokens;
// `pd audit --format json`, read through a real pipe, parses and reports zero defects; `pd build
// --base /demo/` writes a snapshot that a plain file server serves, links included; the starter's
// TypeScript (installed by init) type-checks and compiles its behaviour scripts, which pd dev and
// pd build both serve.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { keep: { type: "boolean" }, project: { type: "string" } } });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const freePort = () => new Promise(resolve => {
  const srv = createServer().listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

let tmp;
let project = values.project;
if (!project) {
  console.log("… npm run pack:pd");
  execFileSync("npm", ["run", "pack:pd"], { cwd: repo, stdio: "inherit" });
  const cliVersion = JSON.parse(await readFile(join(repo, "packages/cli/package.json"), "utf8")).version;
  const name = (await readFile(join(repo, "packages/cli/src/distribution.ts"), "utf8")).match(/PD_PACKAGE_NAME = "([^"]+)"/)[1];
  const tgz = join(repo, ".pd-pack", `${name}-${cliVersion}.tgz`);
  check(existsSync(tgz), `packed ${tgz}`);

  tmp = await mkdtemp(join(tmpdir(), "pd-verify-install-"));
  project = join(tmp, "demo");
  console.log(`… pd init in ${tmp}`);
  try {
    execFileSync("npx", ["--yes", `--package=${tgz}`, "pd", "init", "demo", "--yes", "--no-git", "--pd-source", tgz],
      { cwd: tmp, stdio: "inherit" });
    check(true, "pd init + npm install");
  } catch (e) {
    check(false, "pd init + npm install", String(e));
  }
}

const pd = join(project, "node_modules/.bin/pd");
check(existsSync(pd), "pd is installed in the project");

let server;
if (failures.length === 0) {
  const port = await freePort();
  const wsPort = await freePort();
  server = spawn(pd, ["dev", "--port", String(port), "--ws-port", String(wsPort)], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", d => { log += d; });
  server.stderr.on("data", d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const get = p => fetch(`${base}${p}`);

  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    up = await get("/api/version").then(r => r.ok, () => false);
    if (!up) await new Promise(r => setTimeout(r, 500));
  }
  check(up, "pd dev boots", log.slice(-2000));

  if (up) {
    const tree = await (await get("/api/tree")).json();
    const ids = [];
    const walk = nodes => nodes.forEach(n => { if (n.kind === "component") ids.push(n.path); walk(n.children ?? []); });
    walk(tree.roots);
    check(JSON.stringify(ids) === JSON.stringify(["atoms/button", "molecules/search-field", "molecules/search-field/input", "pages/example"]),
      "the starter tree", JSON.stringify(ids));

    for (const [route, min] of [["/_pd/main.js", 10_000], ["/_pd/main.css", 1_000], ["/_pd/axe-core.js", 100_000], ["/_pd/rule-tiers.json", 50], ["/_pd/shiki.css", 1]]) {
      const res = await get(route);
      const size = (await res.arrayBuffer()).byteLength;
      check(res.ok && size >= min, `serves ${route}`, `${res.status}, ${size} bytes`);
    }

    for (const [id, variant] of [["atoms/button"], ["atoms/button", "secondary"], ["atoms/button", "icon"],
      ["molecules/search-field"], ["molecules/search-field/input"], ["pages/example"]]) {
      const label = variant ? `${id}~${variant}` : id;
      const res = await get(`/api/component/${id}${variant ? `?variant=${variant}` : ""}`);
      const detail = res.ok ? await res.json() : null;
      check(res.ok && detail.diagnostics.length === 0 && detail.document.length > 0,
        `${label} renders with no diagnostics`, detail ? JSON.stringify(detail.diagnostics) : `HTTP ${res.status}`);
    }

    const search = await (await get("/api/component/molecules/search-field")).json();
    const script = await get("/_pd/scripts/search-field.js");
    check(search.document.includes('src="/_pd/scripts/search-field.js') && script.ok && (await script.text()).includes("form.search-field"),
      "search-field loads its compiled behaviour script", `HTTP ${script.status}`);

    const themes = await (await get("/api/themes")).json();
    check(themes.length === 2 && themes.every(t => Object.values(t.tokens ?? {}).every(v => v !== null)),
      "both themes expose swatch tokens", JSON.stringify(themes));
  }

  // Through a real shell pipe: how CI consumes the report.
  try {
    const json = execFileSync("bash", ["-o", "pipefail", "-c", `"${pd}" audit --format json 2>/dev/null | cat`], { cwd: project, encoding: "utf8" });
    const report = JSON.parse(json);
    check(report.totals.defects === 0 && report.totals.components === 4, "pd audit: 4 components, 0 defects", report.headline);
  } catch (e) {
    check(false, "pd audit --format json parses through a pipe", String(e).slice(0, 500));
  }
}

server?.kill();

// The starter's own TypeScript setup, with the TypeScript `pd init` installed into the project.
if (failures.length === 0) {
  for (const script of ["typecheck", "build:scripts"]) {
    try {
      execFileSync("npm", ["run", script], { cwd: project, stdio: "pipe" });
      check(true, `npm run ${script}`);
    } catch (e) {
      check(false, `npm run ${script}`, String(e.stdout ?? e).slice(0, 800));
    }
  }
  check(["search-field.js", "search-field.d.ts"].every(f => existsSync(join(project, "lib/scripts", f))),
    "build:scripts writes lib/scripts JavaScript and declarations");
}

// pd build: the installed package produces a static snapshot that a plain file server serves.
if (failures.length === 0) {
  const site = join(project, "site");
  try {
    execFileSync(pd, ["build", "--out", "site", "--base", "/demo/"], { cwd: project, stdio: "pipe" });
    check(true, "pd build --base /demo/");
  } catch (e) {
    check(false, "pd build --base /demo/", String(e.stderr ?? e).slice(0, 800));
  }
  const port = await freePort();
  const fileServer = spawn(process.execPath, [join(repo, "apps/dev-ui/e2e/static-server.mjs"), "--dir", site, "--base", "/demo/", "--port", String(port)], { stdio: "ignore" });
  const staticGet = p => fetch(`http://127.0.0.1:${port}/demo/${p}`);
  let served = false;
  for (let i = 0; i < 40 && !served; i++) {
    served = await staticGet("index.html").then(r => r.ok, () => false);
    if (!served) await new Promise(r => setTimeout(r, 250));
  }
  check(served, "the snapshot is served as plain files");
  if (served) {
    const shell = await (await staticGet("atoms/button")).text();
    check(shell.includes('"mode":"static"') && shell.includes('src="/demo/_pd/main.js"'), "a route's shell page is the static shell under /demo/");
    for (const file of ["api/tree.json", "api/component/atoms/button/index.json", "preview/atoms/button/index.html",
      "_pd/main.js", "_pd/components/atoms/button.css", "_pd/themes/light.css", "api/audit.json",
      "_pd/scripts/search-field.js"]) {
      const res = await staticGet(file);
      check(res.ok && (await res.arrayBuffer()).byteLength > 0, `static ${file}`, `HTTP ${res.status}`);
    }
    const preview = await (await staticGet("preview/atoms/button/index.html")).text();
    check(preview.includes('href="/demo/_pd/components/atoms/button.css"'), "preview links carry the base path");
  }
  fileServer.kill();
}

if (tmp && !values.keep) await rm(tmp, { recursive: true, force: true });
else if (tmp) console.log(`kept ${project}`);

console.log(failures.length ? `\n✗ ${failures.length} check(s) failed` : "\n✓ the installed package works");
process.exit(failures.length ? 1 : 0);
