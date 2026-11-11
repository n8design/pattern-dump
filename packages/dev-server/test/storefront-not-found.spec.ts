// The storefront's 404 page: 404.md when the site has one, else a built-in page through the default layout.
// It is not a page of the site (not in the pages list, the nav or the sitemap), it is served with status 404
// at /404.html and at every address with no page, it is never indexed and has no address of its own, and an
// edit to 404.md reloads every open page (any of them may be showing it).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS, PD_ROUTES } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-not-found-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

let n = 0;
/** A project of `files` (patterns and pages), assembled at `route` with the site's address set. */
async function assembled(files: Record<string, string>, route: string = PD_ROUTES.notFound) {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  const patterns = join(root, "patterns");
  await mkdir(patterns, { recursive: true });
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const a: PageAssembly = {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }), shown: p => p, site: undefined,
    workbenchUrl: "https://wb.test/", head: async () => "", image: async () => ({ ok: false, message: "none" }),
    siteUrl: "https://example.test/",
  };
  const model = await readPages(join(root, "pages"));
  return { model, page: await assemblePage(route, model, a) };
}
const LAYOUT = {
  "patterns/layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
  "patterns/layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
};
const PAGES = { "pages/index.md": "---\ntitle: Home\n---\n\nHi.\n", "pages/about.md": "---\ntitle: About\n---\n\nAbout.\n" };

describe("404.md", () => {
  it("is not a page of the site: not in the pages list, the pages by route, or the nav", async () => {
    const { model } = await assembled({ ...LAYOUT, ...PAGES, "pages/404.md": "---\ntitle: Lost\n---\n\nNothing here.\n" });
    expect(model.pages.map(p => p.route).sort()).toEqual(["/", "/about/"]);
    expect([...model.files.keys()].sort()).toEqual(["/", "/about/"]);
    expect(model.nav.map(i => i.route).sort()).toEqual(["/", "/about/"]);
    expect(model.notFound).toMatchObject({ route: "/404.html", path: "404.md" });
  });

  it("renders through its layout at /404.html with status 404, noindex, and nothing that needs an address", async () => {
    const { page } = await assembled({ ...LAYOUT, ...PAGES, "pages/404.md": "---\ntitle: Lost\n---\n\nNothing [here](/).\n" });
    expect(page.problems).toEqual([]);
    expect(page.status).toBe(404);
    expect(page.html).toContain("<h1>Lost</h1>");
    expect(page.html).toContain(`<meta name="robots" content="noindex">`);
    expect(page.html).not.toMatch(/rel="canonical"|property="og:|name="twitter:|application\/ld\+json/);
    expect(page.notes).toEqual([]);
  });

  it("can't have redirectFrom", async () => {
    const { page } = await assembled({ ...LAYOUT, ...PAGES, "pages/404.md": "---\ntitle: Lost\nredirectFrom: /old/\n---\n\nX.\n" });
    expect(page.problems).toEqual(["404.md:3: the 404 page can't have redirectFrom: it is served for every address that has no page"]);
  });

  it("fails on a relative URL anywhere in it, its body's or its layout's, since it is served at every depth", async () => {
    const { page } = await assembled({ ...LAYOUT, ...PAGES, "pages/404.md": "---\ntitle: Lost\n---\n\nGo [up](./x/), [about](../about/), [root](/), [out](https://example.test/) or [here](#top).\n" });
    // (A bare "about/" is no link at all: the markdown's link allowlist renders it as text.)
    const said = (u: string, instead: string) => `the 404 page (404.md): the URL "${u}" is relative, and the 404 page is served at every address, so it only works from the site's root: ${instead}`;
    expect(page.status).toBe(500);
    expect(page.problems).toEqual([said("./x/", `use "/x/" instead`), said("../about/", `write it from the site's root ("/…") instead`)]);
    const fromLayout = await assembled({
      "patterns/layouts/page/page.hbs": `<main><img src="images/logo.png" srcset="/a.png 1x, b.png 2x"><a href="#top">top</a>{{{body}}}</main>`, ...PAGES,
    });
    expect(fromLayout.page.problems).toEqual([
      `the 404 page (404.md (built in)): the URL "images/logo.png" is relative, and the 404 page is served at every address, so it only works from the site's root: write it from the site's root ("/…") instead`,
      `the 404 page (404.md (built in)): the URL "b.png" is relative, and the 404 page is served at every address, so it only works from the site's root: write it from the site's root ("/…") instead`,
    ]);
  });
});

describe("the built-in 404 page", () => {
  it("without 404.md: the default layout, titled when it declares a title, linking home", async () => {
    const { page } = await assembled({ ...LAYOUT, ...PAGES });
    expect(page.status).toBe(404);
    expect(page.html).toContain("<title>Page not found</title>");
    expect(page.html).toContain("<h1>Page not found</h1>");
    expect(page.html).toContain(`There is no page at this address. Start again from the <a href="/">home page</a>.`);
    expect(page.html).toContain(`<meta name="robots" content="noindex">`);
  });

  it("with a default layout that declares no title: a heading in the body instead", async () => {
    const { page } = await assembled({ "patterns/layouts/page/page.hbs": "<main>{{{body}}}</main>", ...PAGES });
    expect(page.problems).toEqual([]);
    expect(page.html).toMatch(/<h1[^>]*>Page not found<\/h1>/);
  });

  it("without a default layout: a plain one of Pattern Dump's, with a note", async () => {
    const { page } = await assembled({ "patterns/layouts/other/other.hbs": "<main>{{{body}}}</main>", ...PAGES });
    expect(page.status).toBe(404);
    expect(page.html).toContain("<h1>Page not found</h1>");
    expect(page.notes).toEqual(["there is no 404.md and no layouts/page, so the 404 page is a plain one of Pattern Dump's"]);
  });
});

describe("pd dev's 404 page, on a copy of the storefront bench", () => {
  let b: Bench;
  beforeAll(async () => {
    const root = join(tmp, "bench");
    for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
      const to = join(root, file.slice("storefront-bench/".length));
      await mkdir(dirname(to), { recursive: true });
      await cp(join(repo, file), to);
    }
    b = new Bench(root, null);
    await b.start(validateConfig(benchConfig, "storefront-bench"));
  }, 120_000);

  const get = (path: string): Promise<{ status: number; body: string }> => {
    const url = new URL(b.origin);
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: url.port, path, headers: { host: `${PD_HOSTS.storefront}:${url.port}` } }, res => {
        let body = ""; res.setEncoding("utf8"); res.on("data", c => { body += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject); req.end();
    });
  };

  it("answers /404.html, an address with no page, and a missing file with the built-in page and 404", async () => {
    for (const path of ["/404.html", "/no-such-page/", "/no/such/deep/page/", "/missing.png"]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).toContain("There is no page at this address.");
    }
    expect((await get("/about/")).status).toBe(200);
  });

  it("an edit to 404.md reloads every page, and the 404 page shows it", async () => {
    const created = await b.step(() => save(b.at("pages/404.md"), "---\ntitle: Lost\n---\n\nFirst words.\n"));
    expect(created.messages.filter(m => m.startsWith(`{"type":"page-changed"`))).toEqual([`{"type":"page-changed","route":null}`]);
    expect((await get("/no-such-page/")).body).toContain("First words.");
    const edited = await b.step(() => save(b.at("pages/404.md"), "---\ntitle: Lost\n---\n\nSecond words.\n"));
    expect(edited.messages.filter(m => m.startsWith(`{"type":"page-changed"`))).toEqual([`{"type":"page-changed","route":null}`]);
    expect((await get("/no-such-page/")).body).toContain("Second words.");
    await b.step(() => unlink(b.at("pages/404.md")));
    expect((await get("/no-such-page/")).body).toContain("There is no page at this address.");
  }, 60_000);
});
