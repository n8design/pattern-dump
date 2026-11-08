// pd build writes the storefront into its own output root: one HTML file per page at its route, the
// previews its pages embed, and every file those reference — and nothing of the workbench's. A storefront
// with any problem fails the build before its first write, so both output roots stay as they were.
// Built from copies of the bench, with a fixed clock; configs go through validateConfig, as loadConfig does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

/** Append `text` to `path`, as one save of the whole file. */
const append = async (path: string, text: string) => save(path, `${await readFile(path, "utf8")}${text}`);

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2026-01-02T03:04:05.000Z");
const WB = "https://workbench.example.test/";
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-build-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}
const config = (over: Partial<NonNullable<PatternDumpConfig["storefront"]>> = {}): PatternDumpConfig =>
  validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, ...over } }, "test");
const build = (root: string, out: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: out, pdVersion: "0.0.0-test", now: NOW });

async function tree(dir: string): Promise<Map<string, { bytes: Buffer; mtimeMs: number }>> {
  const out = new Map<string, { bytes: Buffer; mtimeMs: number }>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(relative(dir, p), { bytes: await readFile(p), mtimeMs: (await stat(p)).mtimeMs });
    }
  };
  await walk(dir);
  return out;
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("pd build — the storefront root", () => {
  let root = "";
  let report: Awaited<ReturnType<typeof build>>;
  let files: Map<string, { bytes: Buffer }>;
  beforeAll(async () => {
    root = await benchCopy();
    report = await build(root, join(root, "..", "wb-good"));
    files = await tree(join(root, ".out", "storefront"));
  }, 120_000);

  it("writes one HTML file per page at its route, the previews they embed, and what those reference", () => {
    expect([...files.keys()].sort()).toEqual([
      ".nojekyll",
      "_pd/base.css",
      "_pd/components/components/callout.css",
      "_pd/components/partials/base.css",
      "_pd/components/partials/footer.css",
      "_pd/components/partials/header.css",
      "_pd/components/partials/nav.css",
      "about/index.html",
      "assets/images/bench-blocks.svg",
      "guides/index.html",
      "guides/setup/index.html",
      "index.html",
      "preview/components/callout/index.html",
      "preview/components/callout~warning/index.html",
    ]);
    expect(report.storefront).toEqual({ outDir: join(root, ".out", "storefront"), pages: 4, files: 14, bytes: expect.any(Number) });
  });

  it("resolves every reference inside it to a file it holds", () => {
    const missing: string[] = [];
    for (const [file, { bytes }] of files) {
      const text = bytes.toString("utf8");
      const refs = file.endsWith(".html")
        ? [...text.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(m => m[1])
        : file.endsWith(".css") ? [...text.matchAll(/url\(\s*['"]?(\/[^'")\s]+)/g)].map(m => m[1]) : [];
      for (const ref of refs) {
        const path = ref.replace(/[?#].*$/, "").replace(/^\//, "");
        const target = path === "" || path.endsWith("/") ? `${path}index.html` : path;
        if (!files.has(target) && !files.has(`${target}/index.html`)) missing.push(`${file} → ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("links into the workbench at storefront.workbenchUrl, and carries no live-reload client and no shell CSS", () => {
    const setup = files.get("guides/setup/index.html")!.bytes.toString("utf8");
    expect(setup).toContain(`href="${WB}components/callout#warning"`);
    expect(setup).not.toContain("pd.localhost");
    for (const [file, { bytes }] of files) {
      expect(bytes.toString("utf8"), file).not.toContain("data-pd-live");
      expect(bytes.toString("utf8"), file).not.toContain("/_pd/main.css");
    }
  });

  it("is what pd dev serves, apart from the live-reload client and the workbench's address", async () => {
    const server = await startDevServer(config(), root, { port: 0, wsPort: 0 });
    try {
      for (const [route, file] of [["/", "index.html"], ["/about/", "about/index.html"], ["/guides/", "guides/index.html"], ["/guides/setup/", "guides/setup/index.html"]]) {
        const live = await new Promise<string>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: route, headers: { host: `live.localhost:${server.port}` } }, res => {
            let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve(body));
          });
          req.on("error", reject); req.end();
        });
        const normalized = live
          .replace(/\n<script data-pd-live>[\s\S]*?<\/script>/, "\n")
          .replaceAll(`http://pd.localhost:${server.port}/`, WB);
        expect(normalized, route).toBe(files.get(file)!.bytes.toString("utf8"));
      }
    } finally { await server.close(); }
  }, 60_000);

  it("leaves the workbench snapshot exactly as a build without a storefront makes it", async () => {
    // From the same copy: a compiled script's banner names its source path, so two copies' builds would
    // differ by where they are, whatever the storefront does.
    const { storefront: _sf, ...noStorefront } = benchConfig;
    await buildStaticSite(validateConfig(noStorefront, "test"), root, { outDir: join(root, "..", "wb-none"), pdVersion: "0.0.0-test", now: NOW });
    const a = await tree(join(root, "..", "wb-good"));
    const b = await tree(join(root, "..", "wb-none"));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    const differing = [...a].filter(([k, v]) => !v.bytes.equals(b.get(k)!.bytes)).map(([k]) => k);
    expect(differing).toEqual([]);
  }, 120_000);
});

describe("pd build — a storefront with problems writes nothing", () => {
  const breakPage = (root: string) => append(join(root, "pages", "about.md"), "\n```pattern components/nope\n```\n");
  const brokenHome = async (root: string) => {
    const file = join(root, "pages", "index.md");
    await save(file, (await readFile(file, "utf8")).replace("title: Storefront bench", "title: Storefront bench\nbogus: 1"));
  };

  it("fails, listing every problem, and leaves no output root behind", async () => {
    const root = await benchCopy();
    await breakPage(root);
    await brokenHome(root);
    const out = join(root, "..", "wb-fail");
    await expect(build(root, out)).rejects.toThrow(
      "pd build: the storefront has problems, so nothing was written:\n"
      + `  - /: index.md:4: "bogus" is not declared by layout "home"\n`
      + "  - /about/: about.md: pattern components/nope: there is no such component",
    );
    expect(await exists(out)).toBe(false);
    expect(await exists(join(root, ".out", "storefront"))).toBe(false);
  }, 120_000);

  it("leaves both roots of an earlier build untouched", async () => {
    const root = await benchCopy();
    const out = join(root, "..", "wb-kept");
    await build(root, out);
    const before = { wb: await tree(out), sf: await tree(join(root, ".out", "storefront")) };
    await breakPage(root);
    await expect(build(root, out)).rejects.toThrow("pd build: the storefront has problems, so nothing was written:");
    const after = { wb: await tree(out), sf: await tree(join(root, ".out", "storefront")) };
    for (const which of ["wb", "sf"] as const) {
      expect([...after[which].keys()].sort(), which).toEqual([...before[which].keys()].sort());
      for (const [k, v] of before[which]) {
        expect(after[which].get(k)!.bytes.equals(v.bytes), `${which} ${k}`).toBe(true);
        expect(after[which].get(k)!.mtimeMs, `${which} ${k}`).toBe(v.mtimeMs);
      }
    }
  }, 120_000);
});

describe("pd build — the storefront's settings", () => {
  it("needs storefront.workbenchUrl, and writes nothing without it", async () => {
    const root = await benchCopy();
    const { workbenchUrl: _w, ...rest } = benchConfig.storefront!;
    const out = join(root, "..", "wb-nourl");
    await expect(buildStaticSite(validateConfig({ ...benchConfig, storefront: rest }, "test"), root, { outDir: out, pdVersion: "x" }))
      .rejects.toThrow("pd build: storefront.workbenchUrl is required to build the storefront — its pages link into the workbench at that address");
    expect(await exists(out)).toBe(false);
  });

  it("keeps the storefront's output apart from the workbench's and from what PD reads", async () => {
    const root = await benchCopy();
    await expect(build(root, join(root, ".out", "storefront"))).rejects.toThrow(/and --out .* overlap — the storefront and the workbench each need a folder of their own/);
    await expect(build(root, join(root, "..", "wb-x"), config({ outDir: "./src/styles/out" }))).rejects.toThrow(/storefront\.outDir .* overlaps .*styles, which Pattern Dump reads/);
    // An output root that contains the project is already refused by the config (it holds the pages and the
    // patterns); the build refuses it too, for a config that never went through validation.
    expect(() => config({ outDir: "." })).toThrow(/"storefront\.pagesDir" \("\.\/pages"\) is inside "storefront\.outDir" \("\."\)/);
    const unvalidated = defineConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, outDir: "." } });
    await expect(build(root, join(root, "..", "wb-y"), unvalidated)).rejects.toThrow(/storefront\.outDir .* would contain the project itself/);
  });
});
