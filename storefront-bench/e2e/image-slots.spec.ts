// The slide places its image through its slot ({{pd-image}}, the slide schema's x-pd-image): a photo as WebP
// variants at the slot's widths, every one of which the site serves, loaded at the size its width and height say; an
// SVG as one file at its own size. In pd dev and on the built site.
import { expect, test } from "./fixtures.js";

test("a slide's photo is served as the variants its slot asks for, an SVG as one file", async ({ page, request }) => {
  await page.goto("/guides/");
  const photo = page.locator(`figure.slide img[alt="A harbour at dusk"]`);
  await expect(photo).toHaveAttribute("sizes", "(max-width: 40rem) 33vw, 19rem");
  const srcset = (await photo.getAttribute("srcset"))!;
  const candidates = srcset.split(",").map(c => c.trim().split(/\s+/));
  expect(candidates.map(([url, w]) => [url!.replace(/\.[0-9a-f]{10}\./, ".<key>."), w])).toEqual([
    ["/_pd/images/images/harbour.<key>.320.webp", "320w"], ["/_pd/images/images/harbour.<key>.640.webp", "640w"],
  ]);
  for (const [url] of candidates) {
    const res = await request.get(url!);
    expect([res.status(), res.headers()["content-type"]], url).toEqual([200, "image/webp"]);
  }
  await expect(photo).toHaveAttribute("src", candidates[1]![0]!);
  expect([await photo.getAttribute("width"), await photo.getAttribute("height")]).toEqual(["640", "427"]);
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const svg = page.locator(`figure.slide img[alt="Blocks of colour"]`);
  expect(await svg.evaluate(i => [i.getAttribute("src")?.split("?")[0], i.getAttribute("width"), i.getAttribute("height"), i.hasAttribute("srcset")]))
    .toEqual(["/assets/images/bench-blocks.svg", "1600", "900", false]);
});
