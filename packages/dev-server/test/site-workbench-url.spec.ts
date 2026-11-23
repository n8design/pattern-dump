// Templates get site.workbenchUrl: pd dev's own workbench (the same process, at its port) in pd dev, and the configured
// site.workbenchUrl in pd build (which a site needs). A site global of that name is a config problem,
// not a value silently replaced. On a copy of storefront-bench whose partials/base prints it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configProblems, validateConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let root = "";

beforeAll(async () => {
  root = join(await mkdtemp(join(tmpdir(), "pd-site-wb-")), "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  const base = join(root, "src/patterns/partials/base/base.hbs");
  await save(base, `${await readFile(base, "utf8")}<a id="to-workbench" href="{{site.workbenchUrl}}">Workbench</a>\n`);
}, 60_000);
afterAll(async () => { if (root) await rm(dirname(root), { recursive: true, force: true }); });

/** The href of the layout's link on the page `path`, from HTML. */
const hrefIn = (html: string): string | undefined => /id="to-workbench" href="([^"]*)"/.exec(html)?.[1];

describe("site.workbenchUrl in templates", () => {
  it("pd dev: this process's workbench", async () => {
    const server = await startDevServer(validateConfig(benchConfig, "storefront-bench"), root, { port: 0, wsPort: 0 });
    try {
      const html = await new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path: "/about/", headers: { host: `live.localhost:${server.port}` } }, res => {
          let body = ""; res.setEncoding("utf8").on("data", c => { body += c; }).on("end", () => resolve(body));
        });
        req.on("error", reject); req.end();
      });
      expect(hrefIn(html)).toBe(`http://pd.localhost:${server.port}/`);
    } finally { await server.close(); }
  });

  it("pd build: the configured site.workbenchUrl", async () => {
    await buildStaticSite(validateConfig(benchConfig, "storefront-bench"), root, { outDir: join(dirname(root), "out"), pdVersion: "0.0.0-test", audit: false });
    expect(hrefIn(await readFile(join(root, ".out/site/about/index.html"), "utf8"))).toBe("https://workbench.example.test/");
  }, 180_000);

  it("a site global of that name is a config problem", () => {
    const site = { ...benchConfig.site!, globals: { ...benchConfig.site!.globals, workbenchUrl: "/workbench/" } };
    expect(configProblems({ ...benchConfig, site })).toContainEqual(expect.stringContaining(`"site.globals.workbenchUrl": templates get site.workbenchUrl from Pattern Dump`));
  });
});
