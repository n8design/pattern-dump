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
// pd build both serve. Last, a storefront: its page on live.localhost and the workbench on
// pd.localhost, the page's inlined height fitter run on its own, and pd build's storefront folder. Then a
// packed pattern package installed as a real copy: its compiled helpers render a page, pd dev does not
// watch it, and a TypeScript helper path stops pd dev with the named error.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createContext, runInContext } from "node:vm";
import WebSocket from "ws";

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

// A storefront, from the installed package: one page with a live example, on its own host in pd dev,
// and as its own folder from pd build. The page's height fitter is inlined from the packed bundle, so it
// is run on its own here, in an empty context, the way a browser runs the page's script. Added last,
// because the layout it adds would change the starter tree checked above.
if (failures.length === 0) {
  const configFile = join(project, "pattern-dump.config.ts");
  const config = await readFile(configFile, "utf8");
  await writeFile(configFile, config.replace("  shell: {",
    `  storefront: { pagesDir: "./pages", outDir: "./storefront", workbenchUrl: "https://workbench.example.test/" },\n\n  shell: {`));
  await mkdir(join(project, "src/patterns/layouts/page"), { recursive: true });
  await writeFile(join(project, "src/patterns/layouts/page/page.hbs"), "<main><h1>{{title}}</h1>{{{body}}}</main>\n");
  await writeFile(join(project, "src/patterns/layouts/page/page.schema.json"),
    JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }));
  await mkdir(join(project, "pages"), { recursive: true });
  await writeFile(join(project, "pages/index.md"), "---\ntitle: Home\n---\n\nThe home page.\n\n```pattern atoms/button\n```\n");

  const port = await freePort();
  const wsPort = await freePort();
  const dev = spawn(pd, ["dev", "--port", String(port), "--ws-port", String(wsPort)], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  dev.stdout.on("data", d => { log += d; });
  dev.stderr.on("data", d => { log += d; });
  // fetch() ignores an overridden Host header, so the storefront host is asked for through node:http.
  const onHost = (host, path) => new Promise(resolve => {
    request({ host: "127.0.0.1", port, path, headers: { host: `${host}:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", e => resolve({ status: 0, body: String(e) })).end();
  });
  let page = { status: 0, body: "" };
  for (let i = 0; i < 120 && page.status !== 200; i++) {
    page = await onHost("live.localhost", "/");
    if (page.status !== 200) await new Promise(r => setTimeout(r, 500));
  }
  check(page.status === 200 && page.body.includes("<h1>Home</h1>"), "pd dev serves the storefront page on live.localhost", `${page.status} ${log.slice(-1500)}`);
  check(page.body.includes('<iframe src="/preview/atoms/button"') && page.body.includes(`href="http://pd.localhost:${port}/atoms/button"`),
    "the page's live example is a frame with a workbench link");
  const workbench = await onHost("pd.localhost", "/");
  check(workbench.status === 200 && workbench.body.includes('<div id="app"'), "pd dev serves the workbench on pd.localhost");

  // The inlined fitter, run alone: accept, park at the steady height, ignore, start over after reset.
  const start = page.body.indexOf("var createHeightFitter=(") + "var createHeightFitter=(".length;
  const end = page.body.indexOf(");var fitter=", start);
  try {
    const factory = runInContext(`(${page.body.slice(start, end)})`, createContext({ WeakMap, WeakSet }));
    const writes = [];
    const fit = factory({ write: (_f, h) => writes.push(h) });
    const frame = {};
    const accepted = [200, 900, 900, 1800, 3600, 7200].map(h => fit.accept(frame, h));
    fit.reset(frame);
    accepted.push(fit.accept(frame, 300));
    check(start > 23 && JSON.stringify({ writes, accepted }) === JSON.stringify({ writes: [200, 900, 900, 1800, 900, 300], accepted: [true, true, true, true, true, false, true] }),
      "the page's inlined height fitter runs on its own", JSON.stringify({ writes, accepted }));
  } catch (e) {
    check(false, "the page's inlined height fitter runs on its own", String(e).slice(0, 500));
  }
  dev.kill();

  try {
    execFileSync(pd, ["build", "--out", "site"], { cwd: project, stdio: "pipe" });
    check(true, "pd build with a storefront");
  } catch (e) {
    check(false, "pd build with a storefront", String(e.stderr ?? e).slice(0, 800));
  }
  for (const file of ["index.html", "preview/atoms/button/index.html", "_pd/components/atoms/button.css"]) {
    check(existsSync(join(project, "storefront", file)), `storefront ${file}`);
  }
  const built = existsSync(join(project, "storefront/index.html")) ? await readFile(join(project, "storefront/index.html"), "utf8") : "";
  check(built.includes('href="https://workbench.example.test/atoms/button"') && !built.includes("data-pd-live"),
    "the built page links to storefront.workbenchUrl, with no live client");
}

// A packed pattern package, installed as a real copy (as from a registry) into a second project outside
// the repo: the package bench's skin, with its compiled helpers. A storefront page renders with them;
// pd dev says the package is an installed copy and does not watch it; and the same package naming a
// TypeScript helper stops pd dev at startup with the named error.
if (failures.length === 0 && tmp) {
  execFileSync("npm", ["run", "build"], { cwd: join(repo, "package-bench"), stdio: "pipe" });
  execFileSync("npm", ["pack", "--pack-destination", tmp], { cwd: join(repo, "package-bench", "vendor", "fixture-skin"), stdio: "pipe" });
  const site = join(tmp, "pkgsite");
  await mkdir(join(site, "src", "patterns"), { recursive: true });
  await mkdir(join(site, "src", "styles"), { recursive: true });
  await mkdir(join(site, "pages"), { recursive: true });
  await writeFile(join(site, "package.json"), JSON.stringify({ name: "pkgsite", private: true, type: "module" }));
  await writeFile(join(site, "pattern-dump.config.json"), JSON.stringify({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, packages: ["pd-fixture-skin"],
    storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/", site: { title: "Installed", footer: "From a packed package." } },
  }));
  await writeFile(join(site, "pages", "index.md"), "---\ntitle: Installed site\n---\n\nA page in the installed skin.\n");
  execFileSync("npm", ["install", "--no-audit", "--no-fund", join(tmp, "pd-fixture-skin-1.0.0.tgz")], { cwd: site, stdio: "pipe" });
  const installed = join(site, "node_modules", "pd-fixture-skin");
  check(existsSync(join(installed, "dist", "helpers.js")) && !lstatSync(installed).isSymbolicLink(),
    "the packed skin is installed as a real copy, with its compiled helpers");

  const port = await freePort();
  const wsPort = await freePort();
  const dev = spawn(pd, ["dev", "--port", String(port), "--ws-port", String(wsPort)], { cwd: site, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  dev.stderr.on("data", d => { log += d; });
  const ready = new Promise(resolve => {
    dev.stdout.on("data", d => { log += d; if (log.includes("[dev-server] Ready in")) resolve(true); });
    dev.once("exit", () => resolve(false));
  });
  check(await ready, "pd dev starts on the installed copy", log.slice(-1500));
  check(log.includes("[dev-server] pattern package pd-fixture-skin@1.0.0: an installed copy, not watched"),
    "pd dev says the installed copy is not watched", log.slice(-1500));
  const page = await new Promise(resolve => {
    request({ host: "127.0.0.1", port, path: "/", headers: { host: `live.localhost:${port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", e => resolve({ status: 0, body: String(e) })).end();
  });
  check(page.status === 200 && page.body.includes(`<h1 class="sk-title">INSTALLED SITE</h1>`),
    "a storefront page renders with the installed package's compiled helper", `${page.status} ${page.body.slice(0, 300)}`);

  // An edit to the project's page sends its page-changed, and nothing else arrives before it. The installed
  // copy is edited first, so a message from it could come first, but nothing here can prove it sends none:
  // across processes there is no barrier, and changes in two folders are not ordered, so a late message
  // goes unseen. That the installed copy is not watched is proved by the check above ("pd dev says the
  // installed copy is not watched", read from the watch list) and by packages/dev-server/test/
  // package-watch.spec.ts (in process, with the watcher's hook).
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  const messages = [];
  ws.on("message", d => messages.push(String(d)));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const pageChanged = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no page-changed within 5000 ms; got ${JSON.stringify(messages)}`)), 5_000);
    ws.on("message", d => { if (String(d).includes(`"page-changed"`)) { clearTimeout(timer); resolve(); } });
  });
  await writeFile(join(installed, "patterns", "layouts", "page", "page.hbs"), "<!-- edited in node_modules -->\n", { flag: "a" });
  await writeFile(join(site, "pages", "index.md"), "\nEdited.\n", { flag: "a" });
  try {
    await pageChanged;
    // What was sent, by type and route: every live-reload message also carries the generation it belongs
    // to, which differs on every run and is not what this checks (the other live-reload specs leave it
    // out the same way). The one message so far is the project page's own.
    const sent = messages.map(m => JSON.parse(m)).filter(m => m.type !== "hello").map(({ type, route }) => ({ type, route }));
    check(JSON.stringify(sent) === JSON.stringify([{ type: "page-changed", route: "/" }]),
      "an edit to the project's page sends its page-changed, and nothing else arrives before it", JSON.stringify(messages));
  } catch (e) {
    check(false, "an edit to the project's page sends its page-changed, and nothing else arrives before it", String(e));
  }
  ws.close();
  dev.kill();

  // The same package naming its TypeScript helper source instead.
  const manifestFile = join(installed, "package.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.patternDump.helpers = "helpers/index.ts";
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  const failed = spawnSync(pd, ["dev", "--port", String(await freePort()), "--ws-port", String(await freePort())], { cwd: site, encoding: "utf8", timeout: 30_000 });
  const named = `pattern package "pd-fixture-skin": its helpers are TypeScript (helpers/index.ts), which Node does not load from an installed package. Ship compiled helpers`;
  check(failed.status !== 0 && `${failed.stdout}${failed.stderr}`.includes(named),
    "a TypeScript helper path stops pd dev at startup with the named error", `${failed.status} ${(failed.stderr ?? "").slice(0, 500)}`);
}

if (tmp && !values.keep) await rm(tmp, { recursive: true, force: true });
else if (tmp) console.log(`kept ${project}`);

console.log(failures.length ? `\n✗ ${failures.length} check(s) failed` : "\n✓ the installed package works");
process.exit(failures.length ? 1 : 0);

