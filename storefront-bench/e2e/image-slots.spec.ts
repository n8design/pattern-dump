// The slide places its image through its slot ({{pd-image}}, the slide schema's x-pd-image): a photo as WebP
// variants at the slot's widths, every one of which the site serves, loaded at the size its width and height say; an
// SVG as one file at its own size. In pd dev and on the built site.
import { expect, test } from "./fixtures.js";

test("a slide's photo is served as the variants its slot asks for, an SVG as one file", async ({ page, request }) => {
  await page.goto("/guides/");
  const photo = page.locator(`figure.slide img[alt="Colourful cable cars hanging from their cables against a clear sky"]`);
  await expect(photo).toHaveAttribute("sizes", "(min-width: 62rem) calc((60rem - 2rem) / 3), calc((100vw - 4rem) / 3)");
  const srcset = (await photo.getAttribute("srcset"))!;
  const candidates = srcset.split(",").map(c => c.trim().split(/\s+/));
  expect(candidates.map(([url, w]) => [url!.replace(/\.[0-9a-f]{10}\./, ".<key>."), w])).toEqual([
    ["/_pd/images/images/cable-cars.<key>.320.webp", "320w"], ["/_pd/images/images/cable-cars.<key>.640.webp", "640w"],
    ["/_pd/images/images/cable-cars.<key>.1280.webp", "1280w"], ["/_pd/images/images/cable-cars.<key>.1600.webp", "1600w"],
    ["/_pd/images/images/cable-cars.<key>.2400.webp", "2400w"],
  ]);
  for (const [url] of candidates) {
    const res = await request.get(url!);
    expect([res.status(), res.headers()["content-type"]], url).toEqual([200, "image/webp"]);
  }
  // The photo is 2400 x 1600: the slot's widest width is the source's own, and src, width and height are that one's.
  await expect(photo).toHaveAttribute("src", candidates[4]![0]!);
  expect([await photo.getAttribute("width"), await photo.getAttribute("height")]).toEqual(["2400", "1600"]);
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const svg = page.locator(`figure.slide img[alt="Blocks of colour"]`);
  expect(await svg.evaluate(i => [i.getAttribute("src")?.split("?")[0], i.getAttribute("width"), i.getAttribute("height"), i.hasAttribute("srcset")]))
    .toEqual(["/assets/images/bench-blocks.svg", "1600", "900", false]);
});
