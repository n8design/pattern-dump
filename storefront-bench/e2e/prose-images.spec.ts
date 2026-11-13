// Images in a page's markdown, as the browser renders them (the doc layout's x-pd-prose-images): a photo from the
// assets is written with its WebP variants in the layout's slot, lazy with sizes="auto, …", so the browser picks the
// candidate for the column it is actually laid out in; it loads, keeps the aspect ratio its width and height say, and
// stays inside the column. An SVG is one file at its own size. In pd dev and on the built site.
import { expect, test } from "./fixtures.js";

const PHOTO = `img[alt="Colourful cable cars hanging from their cables against a clear sky"]`;
const SVG = `img[alt="Blocks of colour, each with one rounded corner, stacked like the parts of a page"]`;

test("a page's prose photo has its variants in the layout's slot, and the browser picks the one for its column", async ({ page, request }) => {
  await page.goto("/guides/setup/");
  const photo = page.locator(`.doc ${PHOTO}`);
  await expect(photo).toHaveAttribute("sizes", "auto, (min-width: 62rem) 60rem, calc(100vw - 2rem)");
  await expect(photo).toHaveAttribute("loading", "lazy");
  const candidates = (await photo.getAttribute("srcset"))!.split(",").map(c => c.trim().split(/\s+/));
  expect(candidates.map(([url, w]) => [url!.replace(/\.[0-9a-f]{10}\./, ".<key>."), w])).toEqual([
    ["/_pd/images/images/cable-cars.<key>.480.webp", "480w"],
    ["/_pd/images/images/cable-cars.<key>.960.webp", "960w"],
    ["/_pd/images/images/cable-cars.<key>.1920.webp", "1920w"],
  ]);
  for (const [url] of candidates) {
    const res = await request.get(url!);
    expect([res.status(), res.headers()["content-type"]], url).toEqual([200, "image/webp"]);
  }
  expect([await photo.getAttribute("width"), await photo.getAttribute("height")]).toEqual(["1920", "1280"]);

  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Laid out in the column (60rem at this viewport), at one device pixel per CSS pixel: sizes="auto" picks 960w.
  const shown = await photo.evaluate(i => {
    const img = i as HTMLImageElement;
    const column = img.closest(".site-main")!.getBoundingClientRect();
    const box = img.getBoundingClientRect();
    return { src: img.currentSrc, width: box.width, height: box.height, column: column.width, dpr: devicePixelRatio };
  });
  expect(shown.dpr).toBe(1);
  expect(shown.column).toBe(960);
  expect(new URL(shown.src).pathname).toBe(candidates[1]![0]);
  expect(shown.width).toBeLessThanOrEqual(shown.column);
  expect(Math.abs(shown.height - shown.width * 1280 / 1920)).toBeLessThan(1);
});

test("a page's prose SVG is one file at its own size", async ({ page }) => {
  await page.goto("/about/");
  const svg = page.locator(`.doc ${SVG}`);
  expect(await svg.evaluate(i => [i.getAttribute("src")?.split("?")[0], i.getAttribute("width"), i.getAttribute("height"), i.hasAttribute("srcset")]))
    .toEqual(["/assets/images/bench-blocks.svg", "1600", "900", false]);
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.evaluate(i => { const r = i.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  expect(Math.abs(box.height - box.width * 900 / 1600)).toBeLessThan(1);
});
