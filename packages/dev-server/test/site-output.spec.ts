// The list of what the site's output holds (site-output.ts): every file and folder Pattern Dump writes, and the check
// that another file takes none of their places. Then the guard: every file a build of the bench writes is on the
// list, and each kind of claim is needed for it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import type { StorefrontPagesResponse } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer } from "../src/index.js";
import { readPages } from "../src/storefront/pages.js";
import { claimsOf, collisionOf, describeClaim, forMounts, unclaimed, type Claim } from "../src/storefront/site-output.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const MODEL = {
  pages: [{ route: "/" }, { route: "/guide/", redirectFrom: ["/start/"] }, { route: "/tags/design/" }],
  images: ["guide/shot.png"],
} as unknown as Parameters<typeof claimsOf>[0];
const FEEDS = [{ address: "/articles/feed.xml", source: "articles/index.md" }];

describe("claimsOf", () => {
  it("lists the root files, the folders, each page's and forward's file, each image and each feed", () => {
    expect(claimsOf(MODEL, FEEDS).map(c => `${c.kind} ${c.path}`)).toEqual([
      "file /sitemap.xml", "file /robots.txt", "file /llms.txt", "file /404.html", "file /.nojekyll",
      "folder /_pd/", "folder /assets/", "folder /preview/", "folder /_pagefind/",
      "page /index.html", "page /guide/index.html", "page /tags/design/index.html",
      "forward /start/index.html",
      "image /guide/shot.png",
      "feed /articles/feed.xml",
    ]);
  });
});

describe("collisionOf", () => {
  const claims = claimsOf(MODEL, FEEDS);
  const hit = (path: string) => { const c = collisionOf(claims, path); return c && `${c.kind} ${c.path}`; };

  it("a file at a claimed file's path", () => {
    expect(hit("/sitemap.xml")).toBe("file /sitemap.xml");
    expect(hit("/guide/index.html")).toBe("page /guide/index.html");
    expect(hit("/start/index.html")).toBe("forward /start/index.html");
    expect(hit("/guide/shot.png")).toBe("image /guide/shot.png");
    expect(hit("/articles/feed.xml")).toBe("feed /articles/feed.xml");
    expect(hit("/.nojekyll")).toBe("file /.nojekyll");
  });

  it("a file under a claimed folder, and a file with a claimed folder's name", () => {
    expect(hit("/_pd/main.css")).toBe("folder /_pd/");
    expect(hit("/assets/a/b.png")).toBe("folder /assets/");
    expect(hit("/_pd")).toBe("folder /_pd/");
  });

  it("a file where a claimed file's folder is, and a file under a claimed file", () => {
    // A file /guide would be where the page's folder is.
    expect(hit("/guide")).toBe("page /guide/index.html");
    expect(hit("/tags")).toBe("page /tags/design/index.html");
    expect(hit("/sitemap.xml/index.html")).toBe("file /sitemap.xml");
  });

  it("nothing for a path that only starts like a claim", () => {
    for (const path of ["/_pdx.css", "/guides/index.html", "/guide-two/index.html", "/guide/other.png", "/assets.txt", "/htwoo/index.html"]) {
      expect(hit(path), path).toBeUndefined();
    }
  });

  it("names each kind in a message", () => {
    const by = (kind: Claim["kind"]) => describeClaim(claims.find(c => c.kind === kind)!);
    expect(by("page")).toBe("the page /");
    expect(by("forward")).toBe("the page /start/");
    expect(by("image")).toBe("the image /guide/shot.png");
    expect(by("feed")).toBe("articles/index.md's feed");
    expect(by("file")).toBe("the site's sitemap.xml");
    expect(by("folder")).toBe("in _pd/, which Pattern Dump writes");
  });
});

describe("unclaimed", () => {
  it("is each file no claim covers, once, in order", () => {
    const claims = claimsOf(MODEL, FEEDS);
    expect(unclaimed(claims, ["/index.html", "/x.txt", "/_pd/a.css", "/guide", "/x.txt", "/guide/other.png"]))
      .toEqual(["/x.txt", "/guide", "/guide/other.png"]);
  });
});

describe("every file a build of the bench writes is claimed", () => {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  let root = "", files: string[] = [], claims: Claim[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-output-"));
    for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
      const to = join(root, file.slice("storefront-bench/".length));
      await mkdir(dirname(to), { recursive: true });
      await cp(join(repo, file), to);
    }
    // An image beside a page, which the bench has none of: a square, written here.
    await save(join(root, "pages", "guides", "square.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n`);
    const setup = join(root, "pages", "guides", "setup.md");
    await save(setup, `${await readFile(setup, "utf8")}\n![A black square](./square.svg)\n`);

    const config: PatternDumpConfig = validateConfig(benchConfig, "test");
    await buildStaticSite(config, root, { outDir: join(root, ".out", "workbench"), pdVersion: "0.0.0-test", now: new Date("2027-01-02T03:04:05.000Z") });
    const site = join(root, ".out", "site");
    const walk = async (d: string): Promise<string[]> => (await Promise.all((await readdir(d, { withFileTypes: true }))
      .map(e => e.isDirectory() ? walk(join(d, e.name)) : [`/${relative(site, join(d, e.name)).split(sep).join("/")}`]))).flat();
    files = (await walk(site)).sort();

    // The pages as the build has them, from the server (the tag and category pages too), and the images beside them.
    const server = await startDevServer(config, root, { port: 0, wsPort: 0, live: false, today: "2027-01-02" });
    try {
      const served = await new Promise<StorefrontPagesResponse>((resolve, reject) => {
        request({ host: "127.0.0.1", port: server.port, path: "/api/pages", headers: { host: `live.localhost:${server.port}` } }, res => {
          let body = "";
          res.setEncoding("utf8").on("data", (c: string) => { body += c; });
          res.on("end", () => resolve(JSON.parse(body) as StorefrontPagesResponse));
        }).on("error", reject).end();
      });
      const { images } = await readPages(join(root, "pages"));
      claims = claimsOf({ pages: served.pages, images }, served.feeds ?? []);
    } finally { await server.close(); }
  }, 180_000);
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("has each kind of file in its output", () => {
    for (const path of ["/index.html", "/tags/design/index.html", "/start/index.html", "/guides/square.svg", "/feed.xml",
      "/sitemap.xml", "/.nojekyll", "/llms.txt", "/404.html"]) {
      expect(files, path).toContain(path);
    }
    expect(files.some(f => f.startsWith("/_pd/")), "/_pd/").toBe(true);
  });

  it("leaves no file unclaimed", () => {
    expect(unclaimed(claims, files)).toEqual([]);
  });

  it("needs each kind of claim: without it, its files are unclaimed", () => {
    for (const kind of ["file", "folder", "page", "forward", "image", "feed"] as const) {
      expect(unclaimed(claims.filter(c => c.kind !== kind), files).length, kind).toBeGreaterThan(0);
    }
  });
});

describe("the claims a mounted file is checked against (forMounts)", () => {
  const claims = forMounts(claimsOf(MODEL), [{ path: "/assets/css/site.css", file: "assets/css/site.css" }]);
  it("claims /assets/ file by file: a project asset's exact path, and nothing else under it", () => {
    expect(describeClaim(collisionOf(claims, "/assets/css/site.css")!)).toBe("the project asset assets/css/site.css");
    for (const free of ["/assets/css/x.css", "/assets/css/site.css.map", "/assets/x.js"]) expect(collisionOf(claims, free), free).toBeUndefined();
  });
  it("keeps the name /assets itself, and every other folder whole", () => {
    expect(describeClaim(collisionOf(claims, "/assets")!)).toBe("in assets/, which Pattern Dump writes");
    expect(describeClaim(collisionOf(claims, "/_pd/x.css")!)).toBe("in _pd/, which Pattern Dump writes");
    expect(describeClaim(collisionOf(claims, "/preview/x/index.html")!)).toBe("in preview/, which Pattern Dump writes");
  });
  it("leaves the site's own list as it is: everything under /assets/ is still Pattern Dump's for a feed", () => {
    expect(describeClaim(collisionOf(claimsOf(MODEL), "/assets/css/x.css")!)).toBe("in assets/, which Pattern Dump writes");
  });
});
