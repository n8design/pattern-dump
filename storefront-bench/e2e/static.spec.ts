// The built storefront root on a plain static host: every page and every preview it embeds is a file the
// host serves, fetched past any cache; and every content stamp in it names the file it was written with.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";

/** The built root the static host serves (storefront.outDir in the bench's config). */
const ROOT = fileURLToPath(new URL("../.out/storefront/", import.meta.url));

const NO_CACHE = { "Cache-Control": "no-cache", Pragma: "no-cache" };

test.describe("the built storefront on a static host", () => {
  for (const path of ["/", "/about/", "/guides/", "/guides/setup/", "/preview/components/callout", "/preview/components/callout~warning"]) {
    test(`serves ${path}`, async ({ request }) => {
      const res = await request.get(path, { headers: NO_CACHE });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
      expect(await res.text()).not.toContain("data-pd-live");
    });
  }

  test("stamps each served file it references with the content hash of that file as written", async () => {
    const files = (await readdir(ROOT, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name));
    const stamps: Array<{ in: string; path: string; v: string }> = [];
    for (const f of files.filter(f => /\.(html|css)$/.test(f))) {
      for (const m of (await readFile(f, "utf8")).matchAll(/(\/(?:_pd|assets)\/[^"'()\s?#]+)\?v=([^"'()\s&#]+)/g)) {
        stamps.push({ in: relative(ROOT, f), path: m[1]!, v: m[2]! });
      }
    }
    // Pages, previews and the skin's CSS all carry stamps: base sheet, partials, the component, images.
    expect(stamps.map(s => s.path)).toEqual(expect.arrayContaining(["/_pd/base.css", "/_pd/components/partials/nav.css", "/assets/images/favicon.png"]));
    for (const s of stamps) {
      const written = await readFile(join(ROOT, s.path)).catch(() => null);
      expect(written, `${s.in}: ${s.path}`).not.toBeNull();
      expect(s.v, `${s.in}: ${s.path}`).toBe(createHash("sha256").update(written!).digest("hex").slice(0, 10));
    }
    // Nothing served is linked bare from a page.
    for (const f of files.filter(f => f.endsWith(".html"))) {
      expect(await readFile(f, "utf8"), relative(ROOT, f)).not.toMatch(/(?:href|src)="\/(?:_pd|assets)\/[^"?]+"/);
    }
  });

  test("has no page the pages folder does not define", async ({ request }) => {
    expect((await request.get("/nope/", { headers: NO_CACHE })).status()).toBe(404);
  });
});
