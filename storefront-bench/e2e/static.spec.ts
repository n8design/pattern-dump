// The built storefront root on a plain static host: every page and every preview it embeds is a file the
// host serves, fetched past any cache.
import { expect, test } from "@playwright/test";

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

  test("has no page the pages folder does not define", async ({ request }) => {
    expect((await request.get("/nope/", { headers: NO_CACHE })).status()).toBe(404);
  });
});
