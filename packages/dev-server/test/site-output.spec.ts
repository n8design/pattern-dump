// The list of what the site's output holds (site-output.ts): every file and folder Pattern Dump writes, and the check
// that another file takes none of their places.
import { describe, expect, it } from "vitest";
import { claimsOf, collisionOf, describeClaim, unclaimed, type Claim } from "../src/storefront/site-output.js";

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
