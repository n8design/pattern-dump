// `pd build` end to end on test-bench: the snapshot has every file the shell will request, every
// PD URL inside it carries the base path, and every one of those URLs resolves to a file. The link
// checker is the proof that a subpath-hosted snapshot has no dangling reference.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@pattern-dump/config";
import { buildStaticSite, withBasePath, type StaticBuildReport } from "@pattern-dump/dev-server";

const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));
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

let tmp = "";
let site = "";
let report: StaticBuildReport;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p)); else out.push(p);
  }
  return out;
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-static-build-"));
  site = join(tmp, "site");
  report = await buildStaticSite(config, testBench, { outDir: site, basePath: "/pd/", pdVersion: "0.0.0-test" });
}, 120_000);

afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("withBasePath", () => {
  it("prefixes root-relative PD URLs in markup, CSS and JSON strings, and nothing else", () => {
    const text = '<link href="/_pd/base.css"><img src="/assets/a.png"> url(/assets/f.woff2) {"u":"/api/tree"} /atoms/button https://x.io/_pd/y';
    expect(withBasePath(text, "/pd/")).toBe(
      '<link href="/pd/_pd/base.css"><img src="/pd/assets/a.png"> url(/pd/assets/f.woff2) {"u":"/pd/api/tree"} /atoms/button https://x.io/_pd/y',
    );
    expect(withBasePath(text, "/")).toBe(text);
  });
});

describe("pd build — test-bench under /pd/", () => {
  it("builds every component and lists only what genuinely fails to render", () => {
    expect(report.components).toBeGreaterThan(50);
    expect(report.basePath).toBe("/pd/");
    // test-bench's deliberately broken template is the only component that cannot be built.
    expect(report.warnings.filter(w => !w.includes("broken-template"))).toEqual([]);
  });

  it("writes the shell for every route, the data API, previews, source views and the audit", async () => {
    for (const rel of [
      "index.html", "atoms/button/index.html", "atoms/index.html", "kit/fixture-card/index.html",
      "api/tree.json", "api/themes.json", "api/config.json", "api/audit.json",
      "api/component/atoms/button/index.json", "api/component/atoms/button/~secondary.json",
      "api/overview/atoms/index.json",
      "preview/atoms/button/index.html", "preview/atoms/button/~secondary.html",
      "source/atoms/button/rendered.html", "source/atoms/button/data.html",
      "_pd/main.js", "_pd/main.css", "_pd/axe-core.js", "_pd/base.css", "_pd/themes/light.css",
      "_pd/components/atoms/button.css",
    ]) {
      expect((await stat(join(site, rel)).catch(() => null))?.isFile(), rel).toBe(true);
    }
    const shell = await readFile(join(site, "atoms/button/index.html"), "utf8");
    expect(shell).toContain('"mode":"static"');
    expect(shell).toContain('"basePath":"/pd/"');
    expect(shell).toContain('src="/pd/_pd/main.js"');
    expect(await stat(join(site, "404.html")).catch(() => null)).toBeNull();
    // Without it GitHub Pages (Jekyll) would drop the whole _pd/ folder.
    expect((await stat(join(site, ".nojekyll"))).isFile()).toBe(true);
  });

  it("every PD URL inside the snapshot carries the base path and resolves to a file", async () => {
    const dangling: string[] = [];
    const unprefixed: string[] = [];
    for (const f of await files(site)) {
      if (!/\.(html|css|json)$/.test(f)) continue;
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/(?:^|["'(\s,=])(\/(?:_pd|api|preview|source|assets)\/[^"'()\s\\,?#]+)/g)) {
        unprefixed.push(`${relative(site, f)} → ${m[1]}`);
      }
      for (const m of text.matchAll(/\/pd\/((?:_pd|api|preview|source|assets)\/[^"'()\s\\,?#]+)/g)) {
        const target = join(site, ...m[1].split("/").map(s => decodeURIComponent(s)));
        const ok = await stat(target).then(s => s.isFile(), () => false);
        if (!ok) dangling.push(`${relative(site, f)} → /pd/${m[1]}`);
      }
    }
    expect(unprefixed).toEqual([]);
    expect([...new Set(dangling)]).toEqual([]);
  });

  it("with the audit left out, writes no audit and tells the shell so", async () => {
    const lean = join(tmp, "lean");
    const r = await buildStaticSite({ ...config, build: { audit: false } }, testBench, { outDir: lean, pdVersion: "x" });
    expect(await stat(join(lean, "api/audit.json")).catch(() => null)).toBeNull();
    expect(await readFile(join(lean, "index.html"), "utf8")).toContain('"audit":false');
    // The option overrides the config in both directions.
    const forced = join(tmp, "forced");
    await buildStaticSite({ ...config, build: { audit: false } }, testBench, { outDir: forced, pdVersion: "x", audit: true });
    expect((await stat(join(forced, "api/audit.json"))).isFile()).toBe(true);
    expect(await readFile(join(forced, "index.html"), "utf8")).not.toContain('"audit"');
    expect(r.components).toBe(report.components);
  }, 120_000);

  it("refuses an output folder that overlaps what Pattern Dump reads, or contains the project", async () => {
    await expect(buildStaticSite(config, testBench, { outDir: join(testBench, "src/patterns/out"), pdVersion: "x" }))
      .rejects.toThrow("overlaps");
    await expect(buildStaticSite(config, testBench, { outDir: join(testBench, ".."), pdVersion: "x" }))
      .rejects.toThrow("would contain the project");
  });
});
