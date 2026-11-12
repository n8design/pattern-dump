// What the storefront crawler collects from a page (crawl.ts): every file it references, srcset candidates included.
import { describe, expect, it } from "vitest";
import { PD_ROUTES } from "@pattern-dump/contracts";
import { crawlStorefront } from "../src/storefront/crawl.js";

const page = `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_pd/base.css?v=0123456789"></head><body>
<img src="/_pd/images/images/harbour.0123456789.960.webp"
     srcset="/_pd/images/images/harbour.abcdefabcd.480.webp 480w, /_pd/images/images/harbour.0123456789.960.webp 960w"
     sizes="100vw" alt="">
<img srcset="https://cdn.example/x.webp 1x, /assets/images/logo@2x.png 2x" src="/assets/images/logo.png" alt="">
</body></html>`;

describe("the storefront crawler", () => {
  it("follows each srcset candidate to a file the site serves, besides href and src", async () => {
    const get = async (url: string): Promise<Response> => {
      if (url === PD_ROUTES.pages) return Response.json({ pages: [{ route: "/", title: "Home" }], nav: [] });
      if (url === "/") return new Response(page, { headers: { "content-type": "text/html" } });
      return new Response("x", { headers: { "content-type": "application/octet-stream" } });
    };
    const { urls, problems } = await crawlStorefront(get);
    expect(problems).toEqual([]);
    expect(urls.slice().sort()).toEqual([
      "/", "/_pd/base.css?v=0123456789",
      "/_pd/images/images/harbour.0123456789.960.webp", "/_pd/images/images/harbour.abcdefabcd.480.webp",
      "/assets/images/logo.png", "/assets/images/logo@2x.png",
    ]);
  });
});
