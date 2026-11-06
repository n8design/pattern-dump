// The two server paths that build a preview document, pinned on the whole of test-bench: GET
// /preview/:id (with ?variant= and ?theme=) and the `document` of GET /api/component/:id. pd build never
// requests /preview/ (it stores the detail's document), so the static golden snapshot does not cover it.
//
// The project is a copy of test-bench's tracked files at a fixed path, with every mtime pinned, so the
// documents are reproducible byte for byte — including the `?v=<mtime>` versions of behaviour scripts,
// which are compared exactly: the code that computes them is part of what is pinned here.
//
// Each document is pinned by its SHA-256, and every `?v=` stamp and stylesheet href it carries is pinned
// as a readable value, so a change shows which URL moved and, for stamps and links, to what.
//
// Run with CI=true, so a missing snapshot fails instead of being written, and treat an obsolete snapshot
// as a failure.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@pattern-dump/config";
import { componentUrl, previewUrl, type ComponentDetailResponse, type ComponentTree, type ThemeSummary, type TreeNode } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
// Fixed, so any path that reached a document would be the same on every run.
const COPY = join(tmpdir(), "pd-characterize-preview-route", "test-bench");
const PINNED = new Date("2026-01-02T03:04:05.000Z");

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts",
  helpers: "./src/helpers",
  dataDir: "./src/_data",
  packages: ["pd-fixture-ui"],
});

let server: DevServer;
const hashes: Record<string, string> = {};
const stamps: Record<string, string[]> = {};
const links: Record<string, string[]> = {};

async function pinAll(dir: string): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await pinAll(p);
    if (!e.isSymbolicLink()) await utimes(p, PINNED, PINNED);
  }
  await utimes(dir, PINNED, PINNED);
}

function record(url: string, doc: string): void {
  hashes[url] = createHash("sha256").update(doc).digest("hex");
  stamps[url] = [...doc.matchAll(/[?&]v=[0-9.]+/g)].map(m => m[0]);
  links[url] = [...doc.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
}

beforeAll(async () => {
  await rm(dirname(COPY), { recursive: true, force: true });
  for (const file of execFileSync("git", ["ls-files", "test-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(COPY, file.slice("test-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await mkdir(join(COPY, "node_modules"), { recursive: true });
  await symlink(join("..", "packages", "pd-fixture-ui"), join(COPY, "node_modules", "pd-fixture-ui"));
  await pinAll(COPY);
  expect((await stat(join(COPY, "src", "scripts", "toggle.ts"))).mtimeMs).toBe(PINNED.getTime());

  server = await startDevServer(config, COPY, { port: 0, live: false, now: () => PINNED });
  const origin = `http://127.0.0.1:${server.port}`;
  const get = async (url: string): Promise<Response> => {
    const res = await fetch(origin + url);
    if (res.status !== 200) throw new Error(`${res.status} ${url}`);
    return res;
  };

  const tree = await (await get("/api/tree")).json() as ComponentTree;
  const themes = (await (await get("/api/themes")).json() as ThemeSummary[]).map(t => t.name).sort();
  const ids: string[] = [];
  const walk = (nodes: TreeNode[]): void => nodes.forEach(n => { if (n.kind === "component") ids.push(n.path); walk(n.children ?? []); });
  walk(tree.roots);
  ids.sort();

  for (const id of ids) {
    const detail = await (await fetch(origin + componentUrl(id))).json() as ComponentDetailResponse;
    if (!detail.document) continue; // a component that cannot be described is pinned by its own specs
    for (const variant of [undefined, ...detail.variants.map(v => v.name).sort()]) {
      const d = variant ? await (await get(componentUrl(id, variant))).json() as ComponentDetailResponse : detail;
      record(`detail ${componentUrl(id, variant)}`, d.document);
      const preview = await fetch(origin + previewUrl(id, variant));
      if (preview.status === 200) record(`preview ${previewUrl(id, variant)}`, await preview.text());
      else record(`preview ${previewUrl(id, variant)}`, `HTTP ${preview.status}`);
    }
    for (const theme of themes.filter(t => t !== "light")) {
      const url = previewUrl(id, undefined, theme);
      const res = await fetch(origin + url);
      record(`preview ${url}`, res.status === 200 ? await res.text() : `HTTP ${res.status}`);
    }
  }
}, 180_000);

afterAll(async () => {
  await server?.close();
  await rm(dirname(COPY), { recursive: true, force: true });
});

describe("preview documents served by the dev server, on test-bench with pinned mtimes", () => {
  it("covers every component, variant and theme", () => {
    expect(Object.keys(hashes).length).toBeGreaterThan(200);
    expect(Object.keys(hashes).filter(k => k.startsWith("preview ") && k.includes("theme="))).not.toHaveLength(0);
  });

  it("serves the same documents", () => {
    expect(hashes).toMatchSnapshot();
  });

  it("stamps the same script versions", () => {
    // At least one document must carry a stamp, or this pins nothing.
    expect(Object.values(stamps).flat().length).toBeGreaterThan(0);
    expect(stamps).toMatchSnapshot();
  });

  it("links the same stylesheets, in the same order", () => {
    expect(links).toMatchSnapshot();
  });
});
